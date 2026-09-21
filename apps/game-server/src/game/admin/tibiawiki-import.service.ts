import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@aetheria/database';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatureRegistry } from './creature-registry.service';
import { loadItemCatalogFromDatabase } from '../engine/item-catalog';
import { analyzeCreatureCombat, type CreatureCombatAnalysis } from './creature-combat-analyzer';

const CHANCES = { COMMON: 50, UNCOMMON: 25, SEMI_RARE: 6, RARE: 1.5, VERY_RARE: 0.25 } as const;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const previews = new Map<string, { expiresAt: number; data: ImportPreview }>();

export interface ImportPreview {
  sourceUrl: string;
  creature: {
    name: string;
    slug: string;
    hp: number | null;
    experience: number | null;
    armor: number | null;
    charms: number | null;
    difficulty: string | null;
    gameLevel: number;
    gameAttack: number;
    combatAnalysis: CreatureCombatAnalysis;
    damageAffinities: Record<string, { modifier: number; immune: boolean }>;
    imageUrl: string | null;
    description: string | null;
  };
  loot: Array<{
    itemName: string;
    itemId: string | null;
    rarity: string;
    chance: number;
    minQuantity: number;
    maxQuantity: number;
    image: string | null;
    itemExists: boolean;
    type: string;
    category: string;
    slot: string | null;
    stackable: boolean;
    weight: number;
    attackPower: number;
    armor: number;
    defenseBase: number;
    defenseModifier: number;
    defense: number;
    weaponType: string | null;
    ammoType: string | null;
    damageType: string | null;
    sellValue: number;
  }>;
  newItems: Array<{ id: string; name: string; image: string | null }>;
  warnings: string[];
}

interface CatalogItem {
  id: string;
  name: string;
  type?: string;
  weight?: number;
  stackable?: boolean;
  attack?: number;
  defense?: number;
  image?: string | null;
  category?: string;
  slot?: string;
  sellValue?: number;
  armor?: number;
  weapon?: { weaponType?: string; damageType?: string } | null;
  ammo?: { ammoType?: string; damageType?: string } | null;
}

type PreviewItem = ImportPreview['loot'][number] & { itemUrl?: string };

@Injectable()
export class TibiaWikiImportService {
  constructor(private readonly prisma: PrismaService, private readonly registry: CreatureRegistry) {}

  async preview(sourceUrl: string): Promise<{ previewId: string; preview: ImportPreview }> {
    const url = this.validateUrl(sourceUrl);
    const response = await axios.get<string>(url, {
      headers: { 'User-Agent': 'Aetheria-Admin-Importer/1.0 (educational project)' },
      timeout: 20_000,
    });
    const preview = await this.parse(url, response.data);
    const previewId = randomUUID();
    previews.set(previewId, { expiresAt: Date.now() + PREVIEW_TTL_MS, data: preview });
    return { previewId, preview };
  }

  async import(previewId: string) {
    const stored = previews.get(previewId);
    if (!stored || stored.expiresAt < Date.now()) {
      previews.delete(previewId);
      throw new ConflictException('A prévia expirou. Consulte a URL novamente.');
    }
    const preview = stored.data;
    const result = await this.prisma.$transaction(async (tx) => {
      const slug = preview.creature.slug;
      const existing = await tx.creatureDefinition.findFirst({
        where: { OR: [{ source_url: preview.sourceUrl }, { slug }, { name: { equals: preview.creature.name, mode: 'insensitive' } }] },
      });
      const data = {
        name: preview.creature.name,
        slug: existing?.slug ?? slug,
        description: preview.creature.description ?? '',
        source_url: preview.sourceUrl,
        source_name: preview.creature.name,
        source_hp: preview.creature.hp,
        source_experience: preview.creature.experience,
        charms: preview.creature.charms,
        difficulty: preview.creature.difficulty,
        image_url: preview.creature.imageUrl,
        ...(preview.creature.hp !== null ? { game_max_health: preview.creature.hp } : {}),
        game_level: preview.creature.gameLevel,
        game_attack: preview.creature.gameAttack,
        ...(preview.creature.experience !== null ? { game_experience: preview.creature.experience } : {}),
        ...(preview.creature.armor !== null ? { game_defense: preview.creature.armor } : {}),
        damage_affinities: preview.creature.damageAffinities as unknown as Prisma.InputJsonValue,
      };
      const creature = existing
        ? await tx.creatureDefinition.update({ where: { id: existing.id }, data })
        : await tx.creatureDefinition.create({ data });

      const itemIds = new Map<string, string>();
      for (const item of preview.loot) {
        const id = item.itemId ?? slugify(item.itemName);
        const weapon = item.type === 'weapon' ? { itemId: id, weaponType: item.weaponType ?? 'sword', attackPower: item.attackPower, damageType: item.damageType ?? 'physical', range: 1 } : Prisma.JsonNull;
        const ammo = item.type === 'ammo' ? { itemId: id, ammoType: item.ammoType ?? 'arrow', attackPower: item.attackPower, damageType: item.damageType ?? 'physical' } : Prisma.JsonNull;
        const created = await tx.itemDefinition.upsert({
          where: { id },
          update: { name: item.itemName, type: item.type, slot: item.slot, imagePath: item.image ?? `${item.itemName.replace(/\s+/g, '_')}.gif`, stackable: item.stackable, weight: item.weight, category: item.category, sellValue: item.sellValue, attackPower: item.attackPower, armor: item.armor, defense: item.defense, weapon: weapon as Prisma.InputJsonValue, ammo: ammo as Prisma.InputJsonValue, enabled: true },
          create: { id, name: item.itemName, description: `Item de loot: ${item.itemName}.`, type: item.type, slot: item.slot, imagePath: item.image ?? `${item.itemName.replace(/\s+/g, '_')}.gif`, stackable: item.stackable, weight: item.weight, category: item.category, sellValue: item.sellValue, attackPower: item.attackPower, armor: item.armor, defense: item.defense, weapon: weapon as Prisma.InputJsonValue, ammo: ammo as Prisma.InputJsonValue, enabled: true },
        });
        itemIds.set(item.itemName.toLowerCase(), created.id);
      }

      await tx.creatureLoot.deleteMany({ where: { creature_id: creature.id } });
      await tx.creatureLoot.createMany({ data: preview.loot.map((item) => ({ creature_id: creature.id, item_id: itemIds.get(item.itemName.toLowerCase()) ?? item.itemId, item_name: item.itemName, item_slug: itemIds.get(item.itemName.toLowerCase()) ?? slugify(item.itemName), rarity: item.rarity, chance: item.chance, min_quantity: item.minQuantity, max_quantity: item.maxQuantity })) });
      return { creatureId: creature.creature_id, itemCount: preview.loot.length };
    });
    await loadItemCatalogFromDatabase(this.prisma);
    this.registry.invalidate(result.creatureId);
    await this.prisma.adminAuditLog.create({ data: { actor: 'admin', action: 'TIBIAWIKI_CREATURE_IMPORTED', entity_type: 'creature', entity_id: String(result.creatureId), before: Prisma.JsonNull, after: preview as unknown as Prisma.InputJsonValue } });
    previews.delete(previewId);
    return { ok: true, ...result };
  }

  updatePreview(previewId: string, input: ImportPreview): { previewId: string; preview: ImportPreview } {
    const stored = previews.get(previewId);
    if (!stored || stored.expiresAt < Date.now()) {
      previews.delete(previewId);
      throw new ConflictException('A prévia expirou. Consulte a URL novamente.');
    }
    const preview = normalizePreview(input, stored.data.sourceUrl);
    stored.data = preview;
    return { previewId, preview };
  }

  private validateUrl(value: string): string {
    let url: URL;
    try { url = new URL(value); } catch { throw new BadRequestException('URL inválida.'); }
    if (url.hostname !== 'www.tibiawiki.com.br' || !url.pathname.startsWith('/wiki/')) throw new BadRequestException('Informe uma URL de criatura da TibiaWiki brasileira.');
    return url.toString();
  }

  private async parse(sourceUrl: string, html: string): Promise<ImportPreview> {
    const $ = cheerio.load(html);
    const content = $('#mw-content-text').first();
    const text = content.text().replace(/\s+/g, ' ');
    const number = (re: RegExp): number | null => { const match = text.match(re); return match ? Number(match[1].replace(/[.]/g, '')) : null; };
    const name = ($('#firstHeading').first().text().trim() || decodeURIComponent(new URL(sourceUrl).pathname.split('/').pop() ?? '').replace(/_/g, ' ')).trim();
    const damageAffinities: Record<string, { modifier: number; immune: boolean }> = {};
    const typeNames: Record<string, string> = { Físico: 'physical', Terra: 'earth', Fogo: 'fire', Morte: 'death', Energia: 'energy', Sagrado: 'holy', Gelo: 'ice' };
    const affinityRe = /(\d+(?:[.,]\d+)?)\s*%\s*(?:[A-Za-zÀ-ÿ]+\s+)?(?:a\s+)?(Físico|Terra|Fogo|Morte|Energia|Sagrado|Gelo)/gi;
    for (const match of text.matchAll(affinityRe)) { const percentage = Number(match[1].replace(',', '.')); const type = typeNames[match[2]]; if (type) damageAffinities[type] = { modifier: (percentage - 100) / 100, immune: percentage === 0 }; }

    const loot: PreviewItem[] = [];
    let rarity = 'UNKNOWN';
    const rarityFrom = (value: string) => /muito raro|very rare|raríssimo|rarissimo/i.test(value) ? 'VERY_RARE' : /semi[- ]raro|semi[- ]rare/i.test(value) ? 'SEMI_RARE' : /incomum|uncommon/i.test(value) ? 'UNCOMMON' : /comum|common|always|sempre/i.test(value) ? 'COMMON' : /raro|rare/i.test(value) ? 'RARE' : 'UNKNOWN';
    const chance = (value: string) => value === 'COMMON' ? CHANCES.COMMON : value === 'UNCOMMON' ? CHANCES.UNCOMMON : value === 'SEMI_RARE' ? CHANCES.SEMI_RARE : value === 'RARE' ? CHANCES.RARE : value === 'VERY_RARE' ? CHANCES.VERY_RARE : 0.25;
    const lootRoot = this.findLootRoot($, content);
    lootRoot.find('tr').each((_, row) => {
      const rowText = $(row).text().replace(/\s+/g, ' ').trim();
      const detected = rarityFrom(rowText);
      if (/^(Comum|Incomum|Semi[- ]Raro|Raro|Muito Raro|Common|Uncommon|Semi[- ]Rare|Rare|Very Rare)/i.test(rowText)) { rarity = detected; return; }
      if (rarity === 'UNKNOWN') return;
      $(row).find('a[title]').each((__, link) => {
        const itemName = $(link).text().replace(/\s+/g, ' ').trim();
        if (!itemName || /arquivo|file|ficheiro/i.test(itemName)) return;
        const quantity = rowText.match(/(\d+)\s*(?:-|–|—|a|to)\s*(\d+)/i);
        const single = quantity ? null : rowText.match(/(?:^|\s)(\d+)(?:\s|$)/);
        const item = this.resolveCatalogItem(itemName);
        loot.push({
          itemName,
          itemId: item?.id ?? null,
          rarity,
          chance: chance(rarity),
          minQuantity: Math.max(1, Number(quantity?.[1] ?? single?.[1] ?? 1)),
          maxQuantity: Math.max(1, Number(quantity?.[2] ?? single?.[1] ?? 1)),
          image: item?.image ?? `${itemName.replace(/\s+/g, '_')}.gif`,
          itemExists: !!item,
          type: item?.type ?? 'loot',
          category: item?.category ?? 'Loot',
          slot: item?.slot ?? null,
          stackable: item?.stackable ?? false,
          weight: item?.weight ?? 0,
           attackPower: allowsAttack(item?.type) ? (item?.attack ?? 0) : 0,
           armor: 0,
           defenseBase: item?.defense ?? 0,
           defenseModifier: 0,
           defense: item?.defense ?? 0,
           weaponType: null,
           ammoType: null,
           damageType: allowsAttack(item?.type) ? 'physical' : null,
          sellValue: item?.sellValue ?? 1,
          itemUrl: this.itemUrl($(link).attr('href'), sourceUrl, itemName),
        });
      });
    });
    const unique = [...new Map(loot.map((item) => [item.itemName.toLowerCase(), item])).values()];
    const enriched = await this.enrichItems(unique);
    const ids = enriched.map((item) => item.itemId).filter((id): id is string => !!id);
    const names = enriched.map((item) => item.itemName);
    const existingRows = await this.prisma.itemDefinition.findMany({ where: { OR: [{ id: { in: ids } }, { name: { in: names } }] }, select: { id: true, name: true, type: true, slot: true, imagePath: true, stackable: true, weight: true, category: true, sellValue: true, attackPower: true, armor: true, defense: true, weapon: true, ammo: true } });
    const existingByKey = new Map(existingRows.flatMap((item) => [[item.id, item], [item.name.toLowerCase(), item]]));
    const resolved = enriched.map(({ itemUrl: _itemUrl, ...item }) => {
      const local = existingByKey.get(item.itemId ?? '') ?? existingByKey.get(item.itemName.toLowerCase());
      if (!local) return { ...item, itemExists: false };
      const weapon = isObject(local.weapon) ? local.weapon : null;
      const ammo = isObject(local.ammo) ? local.ammo : null;
      return {
        ...item,
        itemId: local.id,
        itemExists: true,
        type: local.type,
        category: local.category,
        slot: local.slot,
        image: local.imagePath ?? item.image,
        stackable: local.stackable,
        weight: local.weight,
        attackPower: local.attackPower,
        armor: local.armor,
        defenseBase: local.defense,
        defenseModifier: 0,
        defense: local.defense,
        weaponType: typeof weapon?.weaponType === 'string' ? weapon.weaponType : null,
        ammoType: typeof ammo?.ammoType === 'string' ? ammo.ammoType : null,
        damageType: typeof weapon?.damageType === 'string' ? weapon.damageType : typeof ammo?.damageType === 'string' ? ammo.damageType : null,
        sellValue: local.sellValue,
      };
    });
    const combatAnalysis = analyzeCreatureCombat(html, number(/(\d[\d.]*)\s*(?:\[?\s*HP\s*\]?)/i), number(/(\d[\d.]*)\s*(?:\[?\s*XP\s*\]?)/i));
    return {
      sourceUrl,
       creature: { name, slug: slugify(name), hp: number(/(\d[\d.]*)\s*(?:\[?\s*HP\s*\]?)/i), experience: number(/(\d[\d.]*)\s*(?:\[?\s*XP\s*\]?)/i), armor: number(/(\d[\d.]*)\s+de\s+Armadura/i), charms: number(/(\d[\d.]*)\s*(?:\[?\s*Charms?\s*\]?)/i), difficulty: text.match(/(?:Médio|Medio|Fácil|Facil|Difícil|Dificil|Muito difícil|Muito dificil)/i)?.[0] ?? null, gameLevel: combatAnalysis.suggestedLevel, gameAttack: combatAnalysis.suggestedAttack, combatAnalysis, damageAffinities, imageUrl: content.find('img').first().attr('src') ?? null, description: content.find('p').first().text().trim() || null },
      loot: resolved,
      newItems: resolved.filter((item) => !item.itemExists).map((item) => ({ id: item.itemId ?? slugify(item.itemName), name: item.itemName, image: item.image })),
       warnings: [
         ...resolved.filter((item) => !item.itemId).map((item) => `Item não encontrado no catálogo local: ${item.itemName}`),
         ...(combatAnalysis.abilities.length === 0 ? ['Nenhuma habilidade foi detectada automaticamente.'] : []),
       ],
    };
  }

  private findLootRoot($: cheerio.CheerioAPI, content: cheerio.Cheerio<any>): cheerio.Cheerio<any> {
    const heading = content.find('h2, h3').filter((_, element) => /^loot$/i.test($(element).text().replace(/\[editar\]|\[edit\]/gi, '').trim())).first();
    if (heading.length) {
      const container = $('<div></div>');
      let sibling = heading.next();
      while (sibling.length) {
        const tag = String(sibling.prop('tagName') ?? '');
        if (tag === 'H2' || tag === 'H3') break;
        container.append(sibling.clone());
        sibling = sibling.next();
      }
      return container;
    }
    const label = content.find('b').filter((_, element) => /^loot:?$/i.test($(element).text().trim())).first();
    if (label.length) {
      const row = label.closest('tr');
      const nested = row.find('table').first();
      if (nested.length) return nested;
      return row.parent();
    }
    return content;
  }

  private itemUrl(href: string | undefined, sourceUrl: string, itemName: string): string {
    try {
      const url = new URL(href ?? '', sourceUrl);
      if (url.hostname === 'www.tibiawiki.com.br' && url.pathname.startsWith('/wiki/')) return url.toString();
    } catch { /* use the item name fallback */ }
    return `https://www.tibiawiki.com.br/wiki/${slugify(itemName)}`;
  }

  private async enrichItems(items: PreviewItem[]): Promise<PreviewItem[]> {
    return Promise.all(items.map(async (item) => {
      if (!item.itemUrl) return item;
      try {
        const response = await axios.get<string>(item.itemUrl, {
          headers: { 'User-Agent': 'Aetheria-Admin-Importer/1.0 (educational project)' },
          timeout: 15_000,
        });
        return { ...item, ...this.parseItemPage(response.data, item) };
      } catch {
        return item;
      }
    }));
  }

  private parseItemPage(html: string, fallback: PreviewItem): Partial<PreviewItem> {
    const $ = cheerio.load(html);
    const text = $('#mw-content-text').text().replace(/\s+/g, ' ');
    const combat = text.match(/\(\s*Atk\s*:\s*(\d+)\s*,\s*Def\s*:\s*(\d+)(?:\s*([+-]\d+))?\s*\)/i);
    const armor = text.match(/\bArm\s*:\s*(\d+)/i);
    const weight = text.match(/(?:weighs|pesa)\s+([\d.,]+)\s*(?:oz|onças?)/i);
    const sellHeading = $('b').filter((_, element) => /^Vende\s+para:?$/i.test($(element).text().trim())).first();
    const sellTable = sellHeading.closest('tr').next('tr').find('td').eq(1).find('table').first();
    const valueTable = sellTable.length ? sellTable : ($('table#TabelaValores').eq(1).length ? $('table#TabelaValores').eq(1) : $('table#TabelaValores').first());
    const sellText = valueTable.find('td.npcvalue, td.exception').first().text();
    const sell = sellText.match(/(\d[\d.]*)\s*(?:gp|gold)?/i);
    const itemLabel = `${fallback.itemName} ${text}`;
    const helmet = /helmet|capacete|galea|tiara|hood|hat|mask/i.test(itemLabel);
    const bodyArmor = /\barmor\b|armadura|cuirass|robe/i.test(itemLabel);
    const legs = /\blegs?\b|calças|calcas|greaves/i.test(itemLabel);
    const boots = /boots?|botas/i.test(itemLabel);
    const shield = /shield|escudo/i.test(itemLabel);
    const ring = /ring|anel/i.test(itemLabel);
    const amulet = /amulet|amuleto|talisman|talismã|talisma/i.test(itemLabel);
    const isWeapon = /\bArma\b/i.test(text) && !helmet && !bodyArmor && !legs && !boots && !shield;
    const isAmmo = /\b(munição|municao|arrow|bolt|ammunition|aljava|quiver)\b/i.test(text);
    const type = helmet ? 'helmet' : bodyArmor ? 'armor' : legs ? 'legs' : boots ? 'boots' : shield ? 'offhand' : ring ? 'ring' : amulet ? 'amulet' : isWeapon ? 'weapon' : isAmmo ? 'ammo' : fallback.type;
    const slot = helmet ? 'helmet' : bodyArmor ? 'armor' : legs ? 'legs' : boots ? 'boots' : shield ? 'offhand' : ring ? 'ring' : amulet ? 'amulet' : type === 'ammo' ? 'ammo' : type === 'weapon' ? 'weapon' : fallback.slot;
    const image = $('table.infobox img, #mw-content-text img').first().attr('src');
    const weaponType = type === 'weapon' ? detectWeaponType(itemLabel) : null;
    const ammoType = type === 'ammo' ? (/\bbolt|besta|crossbow/i.test(itemLabel) ? 'bolt' : 'arrow') : null;
    const damageType = allowsAttack(type) ? detectDamageType(text) : null;
    const defenseBase = combat ? Number(combat[2]) : fallback.defenseBase;
    const defenseModifier = combat?.[3] ? Number(combat[3]) : fallback.defenseModifier;
    return {
      type,
      category: helmet ? 'Capacetes' : bodyArmor ? 'Armaduras' : legs ? 'Calças' : boots ? 'Botas' : shield ? 'Escudos' : isWeapon ? 'Armas' : fallback.category,
      slot,
      image: image ? decodeURIComponent(image.split('/').pop()?.replace(/\?.*$/, '') ?? '') : fallback.image,
      weight: weight ? Number(weight[1].replace(',', '.')) : fallback.weight,
      attackPower: combat && allowsAttack(type) ? Number(combat[1]) : 0,
      defenseBase,
      defenseModifier,
      defense: defenseBase + defenseModifier,
      armor: armor ? Number(armor[1]) : fallback.armor,
      weaponType,
      ammoType,
      damageType,
      stackable: type === 'ammo' || type === 'consumable' || (type === 'loot' && fallback.itemId === 'gold') ? true : false,
      sellValue: sell ? Number(sell[1].replace('.', '')) : 1,
    };
  }

  private resolveCatalogItem(name: string): CatalogItem | null {
    try {
      const file = [
        path.resolve(process.cwd(), 'apps/game-server/data/items.json'),
        path.resolve(process.cwd(), 'data/items.json'),
        path.resolve(__dirname, '../../../data/items.json'),
        path.resolve(__dirname, '../../../../data/items.json'),
      ].find((candidate) => existsSync(candidate));
      if (!file) return null;
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { items: CatalogItem[] };
      const normalized = name.toLowerCase().replace(/s$/, '');
      const local = parsed.items.find((item) => item.name.toLowerCase().replace(/s$/, '') === normalized || item.id === slugify(name)) ?? null;
      if (local && /gold coins?/i.test(name)) return { ...local, id: 'gold' };
      return local;
    } catch { return null; }
  }
}

function normalizePreview(input: ImportPreview, sourceUrl: string): ImportPreview {
  const numeric = (value: unknown, fallback: number | null = null): number | null => {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const creature = input.creature;
  const loot = (input.loot ?? []).map((item) => ({
    ...item,
    itemName: String(item.itemName ?? '').trim(),
    itemId: item.itemId ? String(item.itemId) : null,
    rarity: String(item.rarity ?? 'COMMON'),
    chance: Math.max(0, numeric(item.chance, 0) ?? 0),
    minQuantity: Math.max(1, Math.floor(numeric(item.minQuantity, 1) ?? 1)),
    maxQuantity: Math.max(1, Math.floor(numeric(item.maxQuantity, 1) ?? 1)),
    type: String(item.type ?? 'loot'),
    category: String(item.category ?? 'Loot'),
    slot: item.slot ? String(item.slot) : null,
    stackable: Boolean(item.stackable),
    weight: Math.max(0, numeric(item.weight, 0) ?? 0),
    attackPower: allowsAttack(String(item.type ?? 'loot')) ? Math.max(0, Math.floor(numeric(item.attackPower, 0) ?? 0)) : 0,
    armor: Math.max(0, Math.floor(numeric(item.armor, 0) ?? 0)),
    defenseBase: Math.max(0, Math.floor(numeric(item.defenseBase, item.defense) ?? 0)),
    defenseModifier: Math.floor(numeric(item.defenseModifier, 0) ?? 0),
    defense: Math.max(0, Math.floor(numeric(item.defense, 0) ?? 0)),
    weaponType: item.weaponType ? String(item.weaponType) : null,
    ammoType: item.ammoType ? String(item.ammoType) : null,
    damageType: item.damageType ? String(item.damageType) : null,
    sellValue: Math.max(1, Math.floor(numeric(item.sellValue, 1) ?? 1)),
  }));
  for (const item of loot) {
    if (item.maxQuantity < item.minQuantity) item.maxQuantity = item.minQuantity;
  }
  return {
    sourceUrl,
    creature: {
      ...creature,
      name: String(creature.name ?? '').trim(),
      slug: slugify(String(creature.slug ?? creature.name ?? '')),
      hp: numeric(creature.hp),
      experience: numeric(creature.experience),
      armor: numeric(creature.armor),
      charms: numeric(creature.charms),
      difficulty: creature.difficulty ? String(creature.difficulty) : null,
      damageAffinities: creature.damageAffinities ?? {},
      gameLevel: Math.max(1, Math.floor(numeric(creature.gameLevel, 1) ?? 1)),
      gameAttack: Math.max(0, Math.floor(numeric(creature.gameAttack, 1) ?? 1)),
    },
    loot,
    newItems: loot.filter((item) => !item.itemExists).map((item) => ({ id: item.itemId ?? slugify(item.itemName), name: item.itemName, image: item.image })),
    warnings: loot.filter((item) => !item.itemId).map((item) => `Item não encontrado no catálogo local: ${item.itemName}`),
  };
}

function allowsAttack(type: string | undefined): boolean {
  return type === 'weapon' || type === 'ammo';
}

function detectWeaponType(value: string): string {
  if (/crossbow|besta/i.test(value)) return 'crossbow';
  if (/bow|arco/i.test(value)) return 'bow';
  if (/axe|machado/i.test(value)) return 'axe';
  if (/club|clava|mace|maça|maca/i.test(value)) return 'club';
  if (/staff|cajado/i.test(value)) return 'staff';
  if (/wand|varinha/i.test(value)) return 'wand';
  if (/rod|bastão|bastao/i.test(value)) return 'rod';
  return 'sword';
}

function detectDamageType(value: string): string {
  if (/\b(fire|fogo)\b/i.test(value)) return 'fire';
  if (/\b(earth|terra)\b/i.test(value)) return 'earth';
  if (/\b(ice|gelo)\b/i.test(value)) return 'ice';
  if (/\b(energy|energia)\b/i.test(value)) return 'energy';
  if (/\b(death|morte)\b/i.test(value)) return 'death';
  if (/\b(holy|sagrado)\b/i.test(value)) return 'holy';
  if (/\b(arcane|arcano)\b/i.test(value)) return 'arcane';
  return 'physical';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slugify(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

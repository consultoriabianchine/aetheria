/**
 * Gera o catálogo de itens (items.json) a partir dos snapshots locais da
 * TibiaWiki (data/wiki-items-raw/*.json, obtidos via API com browser).
 *
 * Saída: apps/game-server/data/items.json + apps/web/src/assets/items.json.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Logger } from '../utils/logger';
import { parseWikiItemPage, type WikiItemPage } from './wiki-item.parser';

type ItemType =
  | 'helmet'
  | 'armor'
  | 'legs'
  | 'boots'
  | 'weapon'
  | 'shield'
  | 'ring'
  | 'amulet'
  | 'consumable'
  | 'loot'
  | 'other';

type EquipmentSlot = 'head' | 'armor' | 'legs' | 'boots' | 'weapon' | 'shield' | 'ring' | 'amulet';

export interface CatalogEntry {
  id: string;
  name: string;
  type: ItemType;
  weight: number;
  stackable: boolean;
  attack: number;
  defense: number;
  image: string | null;
  category: string;
  slot?: EquipmentSlot;
}

/** Mapa categoria da wiki -> [tipo, slot]. Itens fora do mapa caem em 'loot'. */
const CATEGORY_TYPE: Record<string, [ItemType, EquipmentSlot?]> = {
  Capacetes: ['helmet', 'head'],
  Armaduras: ['armor', 'armor'],
  Escudos: ['shield', 'shield'],
  Calças: ['legs', 'legs'],
  Botas: ['boots', 'boots'],
  'Amuletos e Colares': ['amulet', 'amulet'],
  Anéis: ['ring', 'ring'],
  Machados: ['weapon', 'weapon'],
  Clavas: ['weapon', 'weapon'],
  Espadas: ['weapon', 'weapon'],
  Rods: ['weapon', 'weapon'],
  Wands: ['weapon', 'weapon'],
  'Antigas Wands e Rods': ['weapon', 'weapon'],
  Distância: ['weapon', 'weapon'],
  Punhos: ['weapon', 'weapon'],
  Punho: ['weapon', 'weapon'],
  'Armas Obsoletas': ['weapon', 'weapon'],
  'Armas de Arremesso': ['weapon', 'weapon'],
  Munição: ['consumable'],
  Comidas: ['consumable'],
  Líquidos: ['consumable'],
  Cristais: ['consumable'],
  'Cristais (Itens)': ['consumable'],
  Runas: ['consumable'],
  Spellbooks: ['other'],
};

function num(value: string | undefined): number {
  if (!value) return 0;
  const m = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

function catalogId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-{2,}/g, '-');
}

function imageFor(title: string): string {
  return `${title.replace(/\s+/g, '_')}.gif`;
}

/** Mapa title -> nome do arquivo de imagem (ou null), gerado por fetch-wiki-items.cjs. */
function loadImageMap(snapshotDir: string): Record<string, string | null> {
  const file = path.join(snapshotDir, 'image-map.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string | null>;
  } catch {
    return {};
  }
}

/** Lê os snapshots raw da API e devolve um mapa title -> WikiItemPage (deduplicado). */
export function readWikiItemSnapshots(snapshotDir: string, logger: Logger): Map<string, WikiItemPage> {
  if (!readdirSync(snapshotDir, { withFileTypes: true }).some((e) => e.isFile() && e.name.endsWith('.json'))) {
    throw new Error(
      `Nenhum snapshot de itens em ${snapshotDir}. Execute: npm run importer:items:fetch`,
    );
  }
  const byTitle = new Map<string, WikiItemPage>();
  const files = readdirSync(snapshotDir).filter((f) => f.endsWith('.json')).sort();
  for (const file of files) {
    const raw = JSON.parse(readFileSync(path.join(snapshotDir, file), 'utf8')) as {
      query?: { pages?: Array<{ pageid?: number; title?: string; revisions?: Array<{ slots?: { main?: { content?: string } } }> }> };
    };
    const pages = raw.query?.pages ?? [];
    for (const page of pages) {
      if (!page.title) continue;
      const content = page.revisions?.[0]?.slots?.main?.content;
      if (!content || byTitle.has(page.title)) continue;
      const parsed = parseWikiItemPage(page.title, page.pageid ?? 0, content);
      if (parsed) byTitle.set(page.title, parsed);
      else logger.warn('items', `Sem Infobox_Item: ${page.title}`);
    }
  }
  return byTitle;
}

/** Converte uma página de item em entrada do catálogo. */
export function toCatalogEntry(page: WikiItemPage, imageMap: Record<string, string | null> = {}): CatalogEntry {
  const f = page.fields;
  const primary = f.primarytype ?? '';
  const secondary = f.secondarytype ?? '';
  const resolved = resolveType(page);
  return {
    id: catalogId(page.title),
    name: f.name ?? page.title,
    type: resolved.type,
    weight: num(f.weight),
    stackable: f.stackable === 'sim',
    attack: num(f.armor) + num(f.attack),
    defense: num(f.defense),
    image: page.title in imageMap ? imageMap[page.title] : imageFor(page.title),
    category: resolved.source,
    slot: resolved.slot,
  };
}

/**
 * Resolve tipo/slot de um item. Prioridade: primarytype -> secondarytype ->
 * itemclass -> categorias explícitas da página (o itemclass e as categorias
 * capturam itens cujo infobox não preenche primarytype, ex. máscaras).
 */
function resolveType(page: WikiItemPage): { type: ItemType; slot?: EquipmentSlot; source: string } {
  if (page.template === 'runas') return { type: 'consumable', slot: undefined, source: 'Runas' };
  const f = page.fields;
  const candidates: string[] = [];
  const push = (v: string | undefined) => {
    const t = v?.trim();
    if (t && !candidates.includes(t)) candidates.push(t);
  };
  push(f.primarytype);
  push(f.secondarytype);
  push(f.itemclass);
  for (const c of page.categories) push(c);
  for (const name of candidates) {
    const hit = CATEGORY_TYPE[name];
    if (hit) {
      const source = name === 'Armas de Arremesso' ? 'Distância' : name;
      return { type: hit[0], slot: hit[1], source };
    }
  }
  return { type: 'loot', slot: undefined, source: candidates[0] ?? 'Outros' };
}

export function generateItemsCatalog(logger: Logger): { total: number; outputs: string[] } {
  const appRoot = path.resolve(__dirname, '..', '..');
  const snapshotDir = path.join(appRoot, 'data', 'wiki-items-raw');
  const outServer = path.resolve(appRoot, '..', 'game-server', 'data', 'items.json');
  const outWeb = path.resolve(appRoot, '..', 'web', 'src', 'assets', 'items.json');

  const pages = readWikiItemSnapshots(snapshotDir, logger);
  const imageMap = loadImageMap(snapshotDir);
  const items: CatalogEntry[] = [...pages.values()]
    .map((p) => toCatalogEntry(p, imageMap))
    .sort((a, b) => a.id.localeCompare(b.id));

  items.push(
    {
      id: 'gold',
      name: 'Moedas de Ouro',
      type: 'loot',
      weight: 0.1,
      stackable: true,
      attack: 0,
      defense: 0,
      image: null,
      category: 'Moeda',
    },
    {
      id: 'i-tear-of-forest',
      name: 'Lágrima da Floresta',
      type: 'loot',
      weight: 0.5,
      stackable: true,
      attack: 0,
      defense: 0,
      image: null,
      category: 'Troféu',
    },
    {
      id: 'i-wolf-pelt',
      name: 'Pele de Lobo',
      type: 'loot',
      weight: 1.2,
      stackable: true,
      attack: 0,
      defense: 0,
      image: null,
      category: 'Troféu',
    },
  );

  const payload = JSON.stringify(
    {
      source: 'tibia-wiki-itens',
      generatedAt: new Date().toISOString(),
      total: items.length,
      items,
    },
    null,
    1,
  );

  for (const out of [outServer, outWeb]) {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, payload);
  }

  logger.info('items', `Catálogo gerado: ${items.length} itens (${pages.size} páginas wiki) -> ${outServer}`);
  return { total: items.length, outputs: [outServer, outWeb] };
}

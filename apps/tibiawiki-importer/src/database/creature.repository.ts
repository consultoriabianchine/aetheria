import { PrismaClient } from '@aetheria/database';
import type { AssetPaths, NormalizedCreature } from '../types/scraper.types';
import { slugify } from '../utils/slugify';

export type UpsertResult = 'inserted' | 'updated';

/**
 * Persistência de criaturas importadas. Upserts idempotentes por source_url
 * (ou slug, para mesclar com criaturas seedadas pelo jogo). Nunca altera as
 * colunas game_* — só preenche dados de origem (source_*).
 */
export class CreatureRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertCreature(n: NormalizedCreature, paths: AssetPaths, itemIds = new Map<string, string>()): Promise<UpsertResult> {
    let existing = await this.prisma.creatureDefinition.findUnique({
      where: { source_url: n.sourceUrl },
    });
    const bySlug = existing ? null : await this.prisma.creatureDefinition.findUnique({ where: { slug: n.slug } });
    const byName = existing || bySlug
      ? null
      : await this.prisma.creatureDefinition.findFirst({ where: { name: { equals: n.name, mode: 'insensitive' } } });
    existing = existing ?? bySlug ?? byName;

    const data = {
      name: n.name,
      slug: n.slug,
      description: n.description ?? '',
      source_url: n.sourceUrl,
      source_name: n.name,
      source_hp: n.hp,
      source_experience: n.experience,
      ...(n.hp !== null ? { game_max_health: n.hp } : {}),
      ...(n.armor !== null ? { game_defense: n.armor } : {}),
      ...(n.experience !== null ? { game_experience: n.experience } : {}),
      ...(Object.keys(n.damageAffinities).length > 0 ? { damage_affinities: n.damageAffinities } : {}),
      charms: n.charms,
      difficulty: n.difficulty,
      difficulty_raw: n.difficultyRaw,
      category: n.category,
      image_url: n.imageUrl,
      image_path: paths.imagePath,
      gif_url: n.gifUrl,
      gif_path: paths.gifPath,
    };

    const creature = existing
      ? await this.prisma.creatureDefinition.update({ where: { id: existing.id }, data })
      : await this.prisma.creatureDefinition.create({ data });

    await this.syncLoot(creature.id, n, itemIds);
    await this.upsertSource(creature.id, n);

    return existing ? 'updated' : 'inserted';
  }

  private async syncLoot(creatureId: string, n: NormalizedCreature, itemIds: Map<string, string>) {
    const names = n.loot.map((loot) => loot.itemName);
    await this.prisma.creatureLoot.deleteMany({ where: { creature_id: creatureId, item_name: { notIn: names } } });
    for (const l of n.loot) {
      await this.prisma.creatureLoot.upsert({
        where: { creature_id_item_name: { creature_id: creatureId, item_name: l.itemName } },
        update: {
          item_id: itemIds.get(l.itemName.toLowerCase()) ?? null,
          item_slug: slugify(l.itemName),
          item_url: l.itemUrl,
          rarity: l.rarity,
          min_quantity: l.minQuantity,
          max_quantity: l.maxQuantity,
          chance: l.chance,
          raw_text: l.rawText,
        },
        create: {
          creature_id: creatureId,
          item_id: itemIds.get(l.itemName.toLowerCase()) ?? null,
          item_name: l.itemName,
          item_slug: slugify(l.itemName),
          item_url: l.itemUrl,
          rarity: l.rarity,
          min_quantity: l.minQuantity,
          max_quantity: l.maxQuantity,
          chance: l.chance,
          raw_text: l.rawText,
        },
      });
    }
  }

  private async upsertSource(creatureId: string, n: NormalizedCreature) {
    await this.prisma.creatureSource.upsert({
      where: {
        creature_id_source_url: { creature_id: creatureId, source_url: n.sourceUrl },
      },
      update: {
        source_hash: n.sourceHash,
        source_name: n.name,
        last_scraped_at: new Date(),
      },
      create: {
        creature_id: creatureId,
        source_name: n.name,
        source_url: n.sourceUrl,
        source_hash: n.sourceHash,
      },
    });
  }
}

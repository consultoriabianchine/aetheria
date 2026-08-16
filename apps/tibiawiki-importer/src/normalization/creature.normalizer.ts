import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { NormalizedCreature, RawCreatureData } from '../types/scraper.types';
import { slugify } from '../utils/slugify';

export const RaritySchema = z.enum(['COMMON', 'UNCOMMON', 'SEMI_RARE', 'RARE', 'UNKNOWN']);
export const DifficultySchema = z.enum(['EASY', 'MEDIUM', 'HARD', 'VERY_HARD', 'UNKNOWN']);

export const LootSchema = z.object({
  itemName: z.string().min(1),
  itemUrl: z.string().url().nullable(),
  rarity: RaritySchema,
  rarityRaw: z.string().nullable(),
  minQuantity: z.number().int().nullable(),
  maxQuantity: z.number().int().nullable(),
  quantityRaw: z.string().nullable(),
  chance: z.number().nullable(),
  rawText: z.string(),
});

/** Validação (Zod) dos dados de uma criatura antes da persistência. */
export const CreatureSchema = z.object({
  name: z.string().min(1).max(120),
  sourceUrl: z.string().url(),
  imageUrl: z.string().url().nullable(),
  gifUrl: z.string().url().nullable(),
  hp: z.number().int().nonnegative().nullable(),
  experience: z.number().int().nonnegative().nullable(),
  charms: z.number().int().nonnegative().nullable(),
  difficulty: DifficultySchema.nullable(),
  difficultyRaw: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  loot: z.array(LootSchema),
});

export const NormalizedCreatureSchema = CreatureSchema.extend({
  slug: z.string().min(1),
  sourceHash: z.string().min(1),
});

/** Garante que uma URL é http(s) e válida; caso contrário retorna null. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Normaliza os dados brutos: sanitiza URLs, gera slug, calcula o source_hash
 * (SHA256 do conteúdo normalizado) e valida com Zod.
 */
export class CreatureNormalizer {
  normalize(raw: RawCreatureData): NormalizedCreature {
    const canonical = JSON.stringify({
      name: raw.name,
      hp: raw.hp,
      experience: raw.experience,
      charms: raw.charms,
      difficulty: raw.difficulty,
      imageUrl: safeUrl(raw.imageUrl),
      loot: raw.loot.map((l) => [l.itemName, l.rarity, l.minQuantity, l.maxQuantity]),
    });

    const data: RawCreatureData & { slug: string; sourceHash: string } = {
      ...raw,
      imageUrl: safeUrl(raw.imageUrl),
      gifUrl: safeUrl(raw.gifUrl),
      loot: raw.loot.map((l) => ({ ...l, itemUrl: safeUrl(l.itemUrl) })),
      slug: slugify(raw.name),
      sourceHash: createHash('sha256').update(canonical).digest('hex'),
    };

    return NormalizedCreatureSchema.parse(data);
  }
}
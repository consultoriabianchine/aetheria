export type Rarity = 'COMMON' | 'UNCOMMON' | 'SEMI_RARE' | 'RARE' | 'UNKNOWN';

export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'VERY_HARD' | 'UNKNOWN';

/** Link para a página de uma criatura, descoberto na página da categoria. */
export interface CreatureLink {
  name: string;
  url: string;
}

/** Entrada de loot extraída da página da criatura. */
export interface LootEntry {
  itemName: string;
  itemUrl: string | null;
  rarity: Rarity;
  rarityRaw: string | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  quantityRaw: string | null;
  chance: number | null;
  rawText: string;
}

/** Dados brutos extraídos de uma página de criatura (antes da normalização). */
export interface RawCreatureData {
  name: string;
  sourceUrl: string;
  imageUrl: string | null;
  gifUrl: string | null;
  hp: number | null;
  experience: number | null;
  charms: number | null;
  difficulty: Difficulty | null;
  difficultyRaw: string | null;
  category: string | null;
  description: string | null;
  loot: LootEntry[];
}

/** Dados normalizados e validados (Zod) — prontos para persistência. */
export interface NormalizedCreature {
  name: string;
  slug: string;
  sourceUrl: string;
  imageUrl: string | null;
  gifUrl: string | null;
  hp: number | null;
  experience: number | null;
  charms: number | null;
  difficulty: Difficulty | null;
  difficultyRaw: string | null;
  category: string | null;
  description: string | null;
  loot: LootEntry[];
  sourceHash: string;
}

export interface AssetPaths {
  imagePath: string | null;
  gifPath: string | null;
}

export interface CliOptions {
  categoryUrl?: string;
  limit?: number;
  dryRun: boolean;
  force: boolean;
  downloadAssets: boolean;
  update: boolean;
  verbose: boolean;
  inspect: boolean;
  slug?: string;
  help: boolean;
}

export interface ImportSummary {
  found: number;
  processed: number;
  inserted: number;
  updated: number;
  failed: number;
  skipped: number;
}

export type ImportOutcome = 'inserted' | 'updated' | 'skipped' | 'failed';
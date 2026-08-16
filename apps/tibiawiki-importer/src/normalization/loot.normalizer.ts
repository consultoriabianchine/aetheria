import { parseChance, parseQuantity, type QuantityRange } from '../parser/stats.parser';
import type { LootEntry, Rarity } from '../types/scraper.types';
import { normalizeKey, normalizeWhitespace } from './text.normalizer';

const RARITY_PATTERNS: Array<{ rarity: Rarity; re: RegExp }> = [
  {
    rarity: 'COMMON',
    re: /(^|[\s(])comum($|[\s)])|(^|[\s(])common($|[\s)])|(^|[\s(])always($|[\s)])/i,
  },
  {
    rarity: 'UNCOMMON',
    re: /(^|[\s(])incomum($|[\s)])|(^|[\s(])uncommon($|[\s)])/i,
  },
  { rarity: 'SEMI_RARE', re: /semi[- ]raro|semi[- ]rare/i },
  { rarity: 'RARE', re: /(^|[\s(])raro($|[\s)])|(^|[\s(])rare($|[\s)])/i },
  { rarity: 'UNKNOWN', re: /desconhecid|unknown/i },
];

/**
 * Normaliza o texto de raridade da Wiki para COMMON/UNCOMMON/SEMI_RARE/RARE/
 * UNKNOWN. Preserva o texto original em rarityRaw.
 */
export function normalizeRarity(text: string | null | undefined): { rarity: Rarity; rarityRaw: string | null } {
  const raw = text ? normalizeWhitespace(text) : null;
  const key = normalizeKey(text);
  if (!key) return { rarity: 'UNKNOWN', rarityRaw: raw };
  for (const p of RARITY_PATTERNS) {
    if (p.re.test(key)) return { rarity: p.rarity, rarityRaw: raw };
  }
  return { rarity: 'UNKNOWN', rarityRaw: raw };
}

/**
 * Normaliza o texto de quantidade da Wiki para min/max.
 * "0-21" -> 0/21 · "1" -> 1/1 · vazio -> null.
 */
export function normalizeQuantity(text: string | null | undefined): {
  min: number | null;
  max: number | null;
  quantityRaw: string | null;
} {
  const raw = text ? normalizeWhitespace(text) : null;
  const range: QuantityRange = parseQuantity(text);
  return { min: range.min, max: range.max, quantityRaw: raw };
}

/** Detecta se um texto de célula contém raridade (retorna true/false). */
export function looksLikeRarity(text: string): boolean {
  return normalizeRarity(text).rarity !== 'UNKNOWN';
}

/** Detecta se um texto de célula contém um padrão de quantidade. */
export function looksLikeQuantity(text: string): boolean {
  const cleaned = normalizeWhitespace(text).replace(/\./g, '').replace(/,/g, '');
  return /-?\d+\s*(?:-|–|—|a|to)\s*-?\d+/i.test(cleaned) || /^-?\d+$/.test(cleaned.trim());
}

/** Interpreta uma célula de loot: extrai raridade, quantidade e chance. */
export function interpretLootCell(
  text: string,
): { rarity: Rarity; rarityRaw: string | null; min: number | null; max: number | null; chance: number | null } {
  const { rarity, rarityRaw } = normalizeRarity(text);
  const q = normalizeQuantity(text);
  const chance = parseChance(text);
  return { rarity, rarityRaw, min: q.min, max: q.max, chance };
}

/** Monta um LootEntry normalizado a partir dos dados interpretados de uma linha. */
export function buildLootEntry(args: {
  itemName: string;
  itemUrl: string | null;
  rarity: Rarity;
  rarityRaw: string | null;
  min: number | null;
  max: number | null;
  quantityRaw: string | null;
  chance: number | null;
  rawText: string;
}): LootEntry {
  return {
    itemName: normalizeWhitespace(args.itemName) || 'Desconhecido',
    itemUrl: args.itemUrl,
    rarity: args.rarity,
    rarityRaw: args.rarityRaw,
    minQuantity: args.min,
    maxQuantity: args.max,
    quantityRaw: args.quantityRaw,
    chance: args.chance,
    rawText: args.rawText,
  };
}
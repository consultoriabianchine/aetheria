import { calculatePackSize } from '@aetheria/config';
import type { HuntDefinition, HuntMonsterEntry } from '@aetheria/types';

/** Fonte de aleatoriedade injetável (mulberry32 com seed para determinismo). */
export interface RandomSource {
  next(): number;
}

/** Seleção final de monstros de um pack de wave. */
export interface PackSelection {
  monsterIds: string[];
}

/** Normaliza pesos para soma 1. */
export function normalizeWeights(entries: HuntMonsterEntry[]): HuntMonsterEntry[] {
  const total = entries.reduce((sum, e) => sum + Math.max(0, e.weight), 0);
  if (total <= 0) return entries.map((e) => ({ ...e, weight: 0 }));
  return entries.map((e) => ({ ...e, weight: Math.max(0, e.weight) / total }));
}

/** Seleciona um monsterId do pool usando pesos (RNG injetável). */
export function pickMonster(entries: HuntMonsterEntry[], rnd: RandomSource): string {
  const normalized = normalizeWeights(entries);
  const roll = rnd.next();
  let acc = 0;
  for (const e of normalized) {
    acc += e.weight;
    if (roll <= acc) return e.monsterId;
  }
  return normalized[normalized.length - 1]?.monsterId ?? '';
}

/**
 * Gera o pack de uma wave (1–9): o tamanho segue a fórmula do HUNT_CONFIG e
 * cada monstro é sorteado do pool ponderado. Determinístico para mesma seed.
 */
export function generatePack(hunt: HuntDefinition, wave: number, rnd: RandomSource): PackSelection {
  const size = calculatePackSize(hunt.basePackSize, hunt.maxPackSize, wave);
  const monsterIds: string[] = [];
  for (let i = 0; i < size; i++) {
    const id = pickMonster(hunt.monsters, rnd);
    if (id) monsterIds.push(id);
  }
  return { monsterIds };
}
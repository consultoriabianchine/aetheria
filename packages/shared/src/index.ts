import type { Direction, Position } from '@aetheria/types';

/** Gera um id único curto. */
export function uid(prefix = 'e'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Deslocamento em tiles de cada direção. */
export const DIRECTION_DELTAS: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 },
  northeast: { dx: 1, dy: -1 },
  east: { dx: 1, dy: 0 },
  southeast: { dx: 1, dy: 1 },
  south: { dx: 0, dy: 1 },
  southwest: { dx: -1, dy: 1 },
  west: { dx: -1, dy: 0 },
  northwest: { dx: -1, dy: -1 },
};

export function positionKey(p: Position): string {
  return `${p.x},${p.y},${p.z}`;
}

export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Distância em tiles (Chebyshev — adequada para movimento em 8 direções). */
export function tileDistance(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Distância euclidiana em tiles. */
export function euclideanDistance(a: Position, b: Position): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** PRNG determinístico (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** Converte tile em chave usada no mapa. */
export function tileKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}
import { DIRECTION_DELTAS as SHARED_DELTAS } from '@aetheria/shared';

/**
 * Direções de movimento (8 sentidos em grade de tiles).
 * Objeto const + tipo: os valores são strings literais, compatíveis com o
 * tipo `Direction` de @aetheria/types (mesma união).
 */
export const Direction = {
  NORTH: 'north',
  NORTH_EAST: 'northeast',
  EAST: 'east',
  SOUTH_EAST: 'southeast',
  SOUTH: 'south',
  SOUTH_WEST: 'southwest',
  WEST: 'west',
  NORTH_WEST: 'northwest',
} as const;

export type Direction = (typeof Direction)[keyof typeof Direction];

export interface Vector2 {
  dx: number;
  dy: number;
}

export const DIRECTION_DELTAS: Record<Direction, Vector2> = SHARED_DELTAS as Record<Direction, Vector2>;

/** Direção a partir do vetor unitário (dx, dy), ou null se parado. */
export function directionFromDelta(dx: number, dy: number): Direction | null {
  if (dx === 0 && dy === 0) return null;
  if (dx === 1 && dy === 0) return Direction.EAST;
  if (dx === -1 && dy === 0) return Direction.WEST;
  if (dx === 0 && dy === 1) return Direction.SOUTH;
  if (dx === 0 && dy === -1) return Direction.NORTH;
  if (dx === 1 && dy === -1) return Direction.NORTH_EAST;
  if (dx === 1 && dy === 1) return Direction.SOUTH_EAST;
  if (dx === -1 && dy === 1) return Direction.SOUTH_WEST;
  if (dx === -1 && dy === -1) return Direction.NORTH_WEST;
  return null;
}

export const CARDINAL_DIRECTIONS: Direction[] = [
  Direction.NORTH,
  Direction.EAST,
  Direction.SOUTH,
  Direction.WEST,
];

export const ALL_DIRECTIONS: Direction[] = [
  Direction.NORTH,
  Direction.NORTH_EAST,
  Direction.EAST,
  Direction.SOUTH_EAST,
  Direction.SOUTH,
  Direction.SOUTH_WEST,
  Direction.WEST,
  Direction.NORTH_WEST,
];
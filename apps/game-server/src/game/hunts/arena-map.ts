import { TILE } from '@aetheria/config';
import { tileKey } from '@aetheria/shared';
import type { ArenaDefinition, MapTile } from '@aetheria/types';
import type { WorldMapData } from '../engine/world-map';

/**
 * Gera o grid de uma arena (retângulo com borda de parede e interior
 * caminhável). Determinístico para uma definição de arena. A escada de saída
 * (visual) fica no lado do spawn da party.
 */
export function generateArenaMap(arena: ArenaDefinition, z: number): WorldMapData {
  const w = arena.width;
  const h = arena.height;
  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(TILE.GRASS));

  for (let x = 0; x < w; x++) {
    grid[0][x] = TILE.WALL;
    grid[h - 1][x] = TILE.WALL;
  }
  for (let y = 0; y < h; y++) {
    grid[y][0] = TILE.WALL;
    grid[y][w - 1] = TILE.WALL;
  }

  const sx = arena.partySpawnSide === 'left' ? 1 : w - 2;
  for (let dy = -2; dy <= 2; dy++) {
    const y = Math.floor(h / 2) + dy;
    if (y > 0 && y < h - 1) grid[y][sx] = TILE.PATH;
  }

  const tiles: MapTile[] = [];
  const byKey = new Map<string, MapTile>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const type = grid[y][x];
      const walkable = type === TILE.GRASS || type === TILE.PATH;
      const tile: MapTile = { x, y, z, type, walkable, blocksVision: false };
      tiles.push(tile);
      byKey.set(tileKey(x, y, z), tile);
    }
  }

  return { tiles, width: w, height: h, z, byKey };
}

/** Posição de spawn do jogador na arena. */
export function partySpawnPosition(arena: ArenaDefinition, z: number): { x: number; y: number; z: number } {
  const x = arena.partySpawnSide === 'left' ? 1 : arena.width - 2;
  return { x, y: Math.floor(arena.height / 2), z };
}

/** Gera posições de spawn dos monstros do pack (lado oposto, espaçados). */
export function monsterSpawnPositions(arena: ArenaDefinition, z: number, count: number): { x: number; y: number; z: number }[] {
  const x = arena.monsterSpawnSide === 'right' ? arena.width - 2 : 1;
  const mid = Math.floor(arena.height / 2);
  const positions: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i < count; i++) {
    const offset = i - Math.floor((count - 1) / 2);
    let y = mid + offset * 2;
    if (y < 1) y = 1;
    if (y > arena.height - 2) y = arena.height - 2;
    positions.push({ x, y, z });
  }
  return positions;
}
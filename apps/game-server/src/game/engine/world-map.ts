import { MAP_HEIGHT, MAP_SEED, MAP_WIDTH, MAP_Z, TILE } from '@aetheria/config';
import { mulberry32, tileKey } from '@aetheria/shared';
import type { MapTile } from '@aetheria/types';

export interface WorldMapData {
  tiles: MapTile[];
  width: number;
  height: number;
  z: number;
  byKey: Map<string, MapTile>;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function set(grid: number[][], x: number, y: number, type: number, w: number, h: number) {
  if (x > 0 && y > 0 && x < w - 1 && y < h - 1) grid[y][x] = type;
}

function paint(grid: number[][], x: number, y: number, type: number, radius: number, w: number, h: number) {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) set(grid, x + dx, y + dy, type, w, h);
    }
  }
}

/** Gera o mapa proceduralmente (determinístico pela seed). Não usa assets externos. */
export function generateWorldMap(seed = MAP_SEED): WorldMapData {
  const rnd = mulberry32(seed);
  const w = MAP_WIDTH;
  const h = MAP_HEIGHT;
  const z = MAP_Z;
  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(TILE.GRASS));

  for (let x = 0; x < w; x++) {
    grid[0][x] = TILE.WALL;
    grid[h - 1][x] = TILE.WALL;
  }
  for (let y = 0; y < h; y++) {
    grid[y][0] = TILE.WALL;
    grid[y][w - 1] = TILE.WALL;
  }

  for (let l = 0; l < 6; l++) {
    let x = 5 + Math.floor(rnd() * (w - 10));
    let y = 5 + Math.floor(rnd() * (h - 10));
    const steps = 14 + Math.floor(rnd() * 10);
    for (let s = 0; s < steps; s++) {
      paint(grid, x, y, TILE.WATER, 1 + Math.floor(rnd() * 2), w, h);
      x = clamp(x + Math.floor(rnd() * 3) - 1, 2, w - 3);
      y = clamp(y + Math.floor(rnd() * 3) - 1, 2, h - 3);
    }
  }

  for (let f = 0; f < 9; f++) {
    const cx = 4 + Math.floor(rnd() * (w - 8));
    const cy = 4 + Math.floor(rnd() * (h - 8));
    const r = 3 + Math.floor(rnd() * 4);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy <= r * r && rnd() > 0.45) set(grid, cx + dx, cy + dy, TILE.TREE, w, h);
      }
    }
  }

  for (let r = 0; r < 12; r++) {
    const cx = 3 + Math.floor(rnd() * (w - 6));
    const cy = 3 + Math.floor(rnd() * (h - 6));
    const rad = 1 + Math.floor(rnd() * 2);
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (rnd() > 0.5) set(grid, cx + dx, cy + dy, TILE.ROCK, w, h);
      }
    }
  }

  for (let p = 0; p < 20; p++) {
    let x = 1 + Math.floor(rnd() * (w - 2));
    let y = 1 + Math.floor(rnd() * (h - 2));
    for (let s = 0; s < 8; s++) {
      set(grid, x, y, TILE.PATH, w, h);
      x = clamp(x + Math.floor(rnd() * 3) - 1, 1, w - 2);
      y = clamp(y + Math.floor(rnd() * 3) - 1, 1, h - 2);
    }
  }

  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) set(grid, 32 + dx, 32 + dy, TILE.GRASS, w, h);
  }

  const tiles: MapTile[] = [];
  const byKey = new Map<string, MapTile>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const type = grid[y][x];
      const walkable = type === TILE.GRASS || type === TILE.PATH;
      const blocksVision = type === TILE.TREE || type === TILE.ROCK || type === TILE.WALL;
      const tile: MapTile = { x, y, z, type, walkable, blocksVision };
      tiles.push(tile);
      byKey.set(tileKey(x, y, z), tile);
    }
  }

  return { tiles, width: w, height: h, z, byKey };
}
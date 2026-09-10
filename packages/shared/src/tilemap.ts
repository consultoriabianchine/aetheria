import type { MapLayerId } from '@aetheria/types';

/** Índice linear (row-major) de uma célula em uma camada de mapa. */
export function tileIndex(x: number, y: number, width: number): number {
  return y * width + x;
}

/** Cria uma camada vazia (arrays de tileId | null). */
export function createTileLayer(width: number, height: number, fill: number | null = null): (number | null)[] {
  return new Array(width * height).fill(fill);
}

/** Cria o conjunto de camadas vazio para um mapa. */
export function createMapLayers(
  width: number,
  height: number,
): Record<MapLayerId, (number | null)[]> {
  return {
    ground: createTileLayer(width, height),
    groundDetail: createTileLayer(width, height),
    objects: createTileLayer(width, height),
    objectsAbove: createTileLayer(width, height),
  };
}

/** Redimensiona uma camada preservando as células sobrepostas (células novas = null). */
export function resizeTileLayer(
  layer: (number | null)[],
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
): (number | null)[] {
  const next = createTileLayer(newWidth, newHeight);
  const copyW = Math.min(oldWidth, newWidth);
  const copyH = Math.min(oldHeight, newHeight);
  for (let y = 0; y < copyH; y++) {
    for (let x = 0; x < copyW; x++) {
      next[tileIndex(x, y, newWidth)] = layer[tileIndex(x, y, oldWidth)];
    }
  }
  return next;
}

/**
 * Tilemap editor data-driven (Central de Comando).
 *
 * Separação de responsabilidades:
 *   Tileset PNG → SpriteAsset → Tileset → TileDefinition (tileId global)
 *   → Map.layers (arrays de tileId) → MapTile (projeção runtime)
 *   → renderer (sourceRect) + collision/pathfinding.
 */

/** Categoria semântica de um tile (filtro e presets no editor). */
export type TileCategory =
  | 'ground'
  | 'path'
  | 'water'
  | 'wall'
  | 'rock'
  | 'vegetation'
  | 'decoration'
  | 'structure'
  | 'stairs'
  | 'portal'
  | 'other';

/** Camada visual/semântica à qual o tile pertence por padrão. */
export type TileLayerType =
  | 'ground'
  | 'ground_detail'
  | 'object'
  | 'object_above'
  | 'collision'
  | 'effect';

/** Propriedades físicas de um tile (autoritativas para colisão/pathfinding). */
export interface TilePhysicsProperties {
  walkable: boolean;
  blocksMovement: boolean;
  blocksProjectiles: boolean;
  blocksVision: boolean;
  /** Custo de movimento (default 1; ex.: swamp 1.5, ice 1.2). */
  movementCost: number;
}

/** Animação de um tile (ex.: água, lava, tocha). */
export interface TileAnimationSet {
  /** tileIds (globais) usados como frames, na ordem. */
  frames: number[];
  durationMs: number;
}

/** Definição de um tile recortado de um tileset (referenciada por TileID). */
export interface TileDefinition {
  tileId: number;
  tilesetId: number;
  index: number;
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
  name?: string;
  category: TileCategory;
  layerType: TileLayerType;
  physics: TilePhysicsProperties;
  tags: string[];
  isWater: boolean;
  isHazard: boolean;
  isStairs: boolean;
  isPortal: boolean;
  animation?: TileAnimationSet | null;
  enabled: boolean;
}

/** Tileset (uma spritesheet importada, recortada em grid de tiles). */
export interface TilesetDefinition {
  tilesetId: number;
  name: string;
  slug: string;
  assetId: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  enabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Identificadores das camadas de um mapa (ordem de render). */
export type MapLayerId = 'ground' | 'groundDetail' | 'objects' | 'objectsAbove';

export const MAP_LAYERS: readonly MapLayerId[] = ['ground', 'groundDetail', 'objects', 'objectsAbove'] as const;

/** Tipo de entidade/marker posicionado no mapa (não é tile). */
export type MapEntityType =
  | 'player_spawn'
  | 'monster_spawn'
  | 'boss_spawn'
  | 'stairs_up'
  | 'stairs_down'
  | 'portal'
  | 'chest'
  | 'npc';

export interface MapEntity {
  id: string;
  type: MapEntityType;
  x: number;
  y: number;
  config?: Record<string, unknown>;
}

export type MapStatus = 'draft' | 'published' | 'disabled';

/** Estado completo de um mapa (editor). Layers usam arrays indexados por y*width+x. */
export interface MapData {
  id?: string;
  name: string;
  width: number;
  height: number;
  status: MapStatus;
  layers: Record<MapLayerId, (number | null)[]>;
  entities: MapEntity[];
}

/** Referência compacta de um tileset enviada ao cliente para renderizar o mapa. */
export interface TilesetRenderRef {
  tilesetId: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  imageUrl: string;
}

/** Referência compacta de um tile enviada ao cliente (sourceRect no atlas). */
export interface TileRenderDef {
  tileId: number;
  tilesetId: number;
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
}

/** Dados de render de um mapa enviados ao cliente (para desenhar tilesets). */
export interface MapRenderData {
  layers: Record<MapLayerId, (number | null)[]>;
  tilesets: TilesetRenderRef[];
  tiles: TileRenderDef[];
}

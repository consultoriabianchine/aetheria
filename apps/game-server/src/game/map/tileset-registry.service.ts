import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { MapLayerId, TileDefinition, TileRenderDef, TilesetDefinition, TilesetRenderRef } from '@aetheria/types';
import { MAP_LAYERS } from '@aetheria/types';
import { PrismaService } from '../../prisma/prisma.service';

export interface StoredTilesetAsset {
  mimeType: string;
  data: Buffer;
  checksum: string;
  width: number;
  height: number;
}

/**
 * Cache em memória de tilesets + tile definitions (Central de Comando). É a
 * fonte de verdade para o asset controller público e para o runtime do jogo
 * (resolver TileID → física/atlas).
 */
@Injectable()
export class TilesetRegistry implements OnModuleInit {
  private readonly logger = new Logger(TilesetRegistry.name);
  private tilesets = new Map<number, TilesetDefinition>();
  private tiles = new Map<number, TileDefinition>();
  private assets = new Map<number, StoredTilesetAsset>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.warm();
  }

  async warm() {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const [sets, defs, assets] = await Promise.all([
          this.prisma.tileset.findMany({ orderBy: { tileset_id: 'asc' } }),
          this.prisma.tileDefinition.findMany({ orderBy: { tile_id: 'asc' } }),
          this.prisma.spriteAsset.findMany(),
        ]);
        this.tilesets.clear();
        for (const s of sets) {
          this.tilesets.set(s.tileset_id, {
            tilesetId: s.tileset_id,
            name: s.name,
            slug: s.slug,
            assetId: s.sprite_asset_id,
            tileWidth: s.tile_width,
            tileHeight: s.tile_height,
            columns: s.columns,
            rows: s.rows,
            enabled: s.enabled,
            version: s.version,
            createdAt: s.created_at,
            updatedAt: s.updated_at,
          });
        }
        this.assets.clear();
        for (const a of assets) {
          if (a.data) {
            this.assets.set(a.sprite_asset_id, { mimeType: a.mime_type, data: Buffer.from(a.data), checksum: a.checksum, width: a.image_width, height: a.image_height });
          }
        }
        this.tiles.clear();
        for (const d of defs) {
          this.tiles.set(d.tile_id, this.toTile(d));
        }
        this.logger.log(`TilesetRegistry carregado: ${this.tilesets.size} tileset(s), ${this.tiles.size} tile(s).`);
        return;
      } catch (err) {
        if (attempt < 5) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        this.logger.warn(`Tilesets indisponíveis (${(err as Error).message}).`);
      }
    }
  }

  async invalidate() {
    await this.warm();
  }

  getTileset(tilesetId: number): TilesetDefinition | null {
    return this.tilesets.get(tilesetId) ?? null;
  }

  getTile(tileId: number): TileDefinition | null {
    return this.tiles.get(tileId) ?? null;
  }

  getTilesetAsset(tilesetId: number): StoredTilesetAsset | null {
    const tileset = this.tilesets.get(tilesetId);
    if (!tileset) return null;
    return this.assets.get(tileset.assetId) ?? null;
  }

  listTilesets(): TilesetDefinition[] {
    return [...this.tilesets.values()];
  }

  listTiles(tilesetId: number): TileDefinition[] {
    return [...this.tiles.values()].filter((t) => t.tilesetId === tilesetId).sort((a, b) => a.index - b.index);
  }

  /** Física efetiva de um TileID (fallback padrão se não existir). */
  tilePhysics(tileId: number | null | undefined): { walkable: boolean; blocksMovement: boolean; blocksProjectiles: boolean; blocksVision: boolean; movementCost: number } {
    if (tileId == null) return { walkable: true, blocksMovement: false, blocksProjectiles: false, blocksVision: false, movementCost: 1 };
    const tile = this.tiles.get(tileId);
    if (!tile) return { walkable: true, blocksMovement: false, blocksProjectiles: false, blocksVision: false, movementCost: 1 };
    return tile.physics;
  }

  /** Catálogo compacto de tilesets/tiles usado por um mapa (para o cliente renderizar). */
  renderCatalog(tileIds: Iterable<number>): { tilesets: TilesetRenderRef[]; tiles: TileRenderDef[] } {
    const tilesetIds = new Set<number>();
    const tileDefs: TileRenderDef[] = [];
    for (const tileId of tileIds) {
      const tile = this.tiles.get(tileId);
      if (!tile) continue;
      tilesetIds.add(tile.tilesetId);
      tileDefs.push({ tileId: tile.tileId, tilesetId: tile.tilesetId, sourceX: tile.sourceX, sourceY: tile.sourceY, width: tile.width, height: tile.height });
    }
    const tilesets: TilesetRenderRef[] = [];
    for (const tilesetId of tilesetIds) {
      const t = this.tilesets.get(tilesetId);
      if (!t) continue;
      tilesets.push({ tilesetId: t.tilesetId, tileWidth: t.tileWidth, tileHeight: t.tileHeight, columns: t.columns, rows: t.rows, imageUrl: `/assets/tilesets/${t.tilesetId}` });
    }
    return { tilesets, tiles: tileDefs };
  }

  /** Coleciona todos os tileIds usados nas camadas de um mapa. */
  collectTileIds(layers: Record<MapLayerId, (number | null)[]>): Set<number> {
    const ids = new Set<number>();
    if (!layers) return ids;
    for (const layer of MAP_LAYERS) {
      const arr = layers[layer];
      if (!Array.isArray(arr)) continue;
      for (const id of arr) if (id != null) ids.add(id);
    }
    return ids;
  }

  private toTile(d: {
    tile_id: number;
    tileset_id: number;
    index: number;
    source_x: number;
    source_y: number;
    width: number;
    height: number;
    name: string | null;
    category: string;
    layer_type: string;
    walkable: boolean;
    blocks_movement: boolean;
    blocks_projectiles: boolean;
    blocks_vision: boolean;
    movement_cost: number;
    tags: unknown;
    is_water: boolean;
    is_hazard: boolean;
    is_stairs: boolean;
    is_portal: boolean;
    animation: unknown;
    enabled: boolean;
  }): TileDefinition {
    return {
      tileId: d.tile_id,
      tilesetId: d.tileset_id,
      index: d.index,
      sourceX: d.source_x,
      sourceY: d.source_y,
      width: d.width,
      height: d.height,
      name: d.name ?? undefined,
      category: d.category as TileDefinition['category'],
      layerType: d.layer_type as TileDefinition['layerType'],
      physics: {
        walkable: d.walkable,
        blocksMovement: d.blocks_movement,
        blocksProjectiles: d.blocks_projectiles,
        blocksVision: d.blocks_vision,
        movementCost: d.movement_cost,
      },
      tags: (d.tags as string[]) ?? [],
      isWater: d.is_water,
      isHazard: d.is_hazard,
      isStairs: d.is_stairs,
      isPortal: d.is_portal,
      animation: (d.animation as TileDefinition['animation']) ?? null,
      enabled: d.enabled,
    };
  }
}

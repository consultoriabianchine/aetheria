import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { MapEntity, MapLayerId, MapRenderData, MapTile } from '@aetheria/types';
import { MAP_LAYERS } from '@aetheria/types';
import { PrismaService } from '../../prisma/prisma.service';
import { TilesetRegistry } from './tileset-registry.service';

export interface StoredMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: MapTile[];
  layers?: Record<MapLayerId, (number | null)[]>;
  entities?: MapEntity[];
}

/**
 * Cache em memória dos mapas custom (criados na Central de Comando). É usado
 * pelo motor de hunts para substituir a arena procedural quando a hunt define
 * `mapId`, e invalidado quando o admin salva um mapa.
 */
@Injectable()
export class MapRegistry implements OnModuleInit {
  private readonly logger = new Logger(MapRegistry.name);
  private readonly maps = new Map<string, StoredMap>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tilesets: TilesetRegistry,
  ) {}

  async onModuleInit() {
    await this.warm();
  }

  async warm() {
    try {
      const rows = await this.prisma.map.findMany({ include: { tiles: true } });
      for (const m of rows) {
        this.maps.set(m.id, this.toStored(m));
      }
      this.logger.log(`MapRegistry carregado: ${this.maps.size} mapa(s).`);
    } catch (err) {
      this.logger.warn(`Mapas indisponíveis (${(err as Error).message}) — hunts usarão arena procedural.`);
    }
  }

  getMap(id: string): StoredMap | null {
    return this.maps.get(id) ?? null;
  }

  /** Catálogo de render (layers + tilesets + tiles) de um mapa custom. */
  getMapRender(id: string): MapRenderData | null {
    const map = this.maps.get(id);
    if (!map?.layers) return null;
    const ids = new Set<number>();
    for (const layer of MAP_LAYERS) {
      const arr = map.layers[layer];
      if (!Array.isArray(arr)) continue;
      for (const tileId of arr) if (tileId != null) ids.add(tileId);
    }
    const { tilesets: renderTilesets, tiles: renderTiles } = this.tilesets.renderCatalog(ids);
    return { layers: map.layers, tilesets: renderTilesets, tiles: renderTiles };
  }

  list(): { id: string; name: string; width: number; height: number }[] {
    return [...this.maps.values()].map((m) => ({ id: m.id, name: m.name, width: m.width, height: m.height }));
  }

  async invalidate(id: string) {
    const row = await this.prisma.map.findUnique({ where: { id }, include: { tiles: true } });
    if (row) {
      this.maps.set(id, this.toStored(row));
    } else {
      this.maps.delete(id);
    }
  }

  private toStored(m: {
    id: string;
    name: string;
    width: number;
    height: number;
    layers: unknown;
    entities: unknown;
    tiles: { x: number; y: number; z: number; type: number; walkable: boolean; blocksVision: boolean }[];
  }): StoredMap {
    const layers = (m.layers ?? {}) as Record<MapLayerId, (number | null)[]>;
    const entities = (m.entities ?? []) as MapEntity[];
    return {
      id: m.id,
      name: m.name,
      width: m.width,
      height: m.height,
      tiles: m.tiles.map((t) => ({ x: t.x, y: t.y, z: t.z, type: t.type, walkable: t.walkable, blocksVision: t.blocksVision })),
      layers,
      entities,
    };
  }
}

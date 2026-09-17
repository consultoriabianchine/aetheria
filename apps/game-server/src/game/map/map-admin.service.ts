import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TILE } from '@aetheria/config';
import { createMapLayers, tileIndex } from '@aetheria/shared';
import type { MapEntity, MapLayerId } from '@aetheria/types';
import { MAP_LAYERS } from '@aetheria/types';
import type { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';
import { MapRegistry } from './map-registry.service';
import { TilesetRegistry } from './tileset-registry.service';

export interface MapTileInput {
  x: number;
  y: number;
  type: number;
}

interface ResolvedTile {
  x: number;
  y: number;
  type: number;
  walkable: boolean;
  blocksVision: boolean;
}

export interface MapSaveInput {
  id?: string;
  name: string;
  width: number;
  height: number;
  status?: string;
  layers?: Record<MapLayerId, (number | null)[]>;
  entities?: MapEntity[];
  tiles?: MapTileInput[];
}

function tileProps(type: number): { walkable: boolean; blocksVision: boolean } {
  const walkable = type === TILE.GRASS || type === TILE.PATH;
  const blocksVision = type === TILE.TREE || type === TILE.ROCK || type === TILE.WALL;
  return { walkable, blocksVision };
}

function normalizeLayers(input: Record<MapLayerId, (number | null)[]> | undefined): Record<MapLayerId, (number | null)[]> {
  const base = createMapLayers(0, 0);
  if (!input) return base;
  for (const layer of MAP_LAYERS) {
    const arr = input[layer];
    base[layer] = Array.isArray(arr) ? arr : [];
  }
  return base;
}

/** Persistência de mapas custom (Map + MapTile + layers/entities JSONB). */
@Injectable()
export class MapAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: MapRegistry,
    private readonly tilesets: TilesetRegistry,
  ) {}

  async save(input: MapSaveInput) {
    if (!input.name?.trim()) throw new BadRequestException('Nome do mapa é obrigatório');
    if (input.width < 4 || input.width > 256 || input.height < 4 || input.height > 256) {
      throw new BadRequestException('Dimensões fora do intervalo (4–256)');
    }

    const id = input.id ?? `map_${Date.now().toString(36)}`;
    const isLayered = !!input.layers;
    const layers = normalizeLayers(input.layers);
    const entities = this.validateEntities(input.entities, input.width, input.height);

    if (isLayered) {
      const expected = input.width * input.height;
      for (const layer of MAP_LAYERS) {
        if (layers[layer].length !== expected) {
          throw new BadRequestException(`Layer "${layer}" deve ter ${expected} células (recebido ${layers[layer].length})`);
        }
      }
      this.normalizeLayerTiles(layers);
    } else {
      if (!input.tiles || input.tiles.length !== input.width * input.height) {
        throw new BadRequestException(`São esperados ${input.width * input.height} tiles, recebidos ${input.tiles?.length ?? 0}`);
      }
    }

    const map = await this.prisma.map.upsert({
      where: { id },
      update: {
        name: input.name,
        width: input.width,
        height: input.height,
        status: input.status ?? 'draft',
        layers: isLayered ? (layers as unknown as Prisma.InputJsonValue) : undefined,
        entities: isLayered ? (entities as unknown as Prisma.InputJsonValue) : undefined,
        version: { increment: 1 },
      },
      create: {
        id,
        name: input.name,
        width: input.width,
        height: input.height,
        status: input.status ?? 'draft',
        layers: isLayered ? (layers as unknown as Prisma.InputJsonValue) : {},
        entities: isLayered ? (entities as unknown as Prisma.InputJsonValue) : [],
      },
    });

    await this.prisma.mapTile.deleteMany({ where: { mapId: id } });
    const tiles = isLayered ? this.buildTilesFromLayers(layers, input.width, input.height) : this.buildTilesFromLegacy(input.tiles ?? []);
    await this.prisma.mapTile.createMany({
      data: tiles.map((t) => ({ mapId: id, x: t.x, y: t.y, z: 0, type: t.type, walkable: t.walkable, blocksVision: t.blocksVision })),
    });

    await this.registry.invalidate(id);
    return { id: map.id, name: map.name, width: map.width, height: map.height };
  }

  async remove(id: string) {
    const existing = await this.prisma.map.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Mapa não encontrado');
    await this.prisma.map.delete({ where: { id } });
    await this.registry.invalidate(id);
    return { ok: true };
  }

  private buildTilesFromLayers(layers: Record<MapLayerId, (number | null)[]>, width: number, height: number): ResolvedTile[] {
    const out: ResolvedTile[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = tileIndex(x, y, width);
        const ground = this.tilesets.tilePhysics(layers.ground[i]);
        const object = this.tilesets.tilePhysics(layers.objects[i]);
        const objectAbove = this.tilesets.tilePhysics(layers.objectsAbove[i]);
        const groundDetail = this.tilesets.tilePhysics(layers.groundDetail[i]);
        const walkable = ground.walkable && !object.blocksMovement;
        const blocksVision = ground.blocksVision || groundDetail.blocksVision || object.blocksVision || objectAbove.blocksVision;
        out.push({ x, y, type: layers.ground[i] ?? 0, walkable, blocksVision });
      }
    }
    return out;
  }

  private normalizeLayerTiles(layers: Record<MapLayerId, (number | null)[]>) {
    const expectedLayer: Record<MapLayerId, string> = {
      ground: 'ground',
      groundDetail: 'ground_detail',
      objects: 'object',
      objectsAbove: 'object_above',
    };
    for (const layer of MAP_LAYERS) {
      for (const tileId of layers[layer]) {
        if (tileId == null) continue;
        const tile = this.tilesets.getTile(tileId);
        if (!tile) throw new BadRequestException(`Tile #${tileId} não existe no cadastro de tilesets`);
        if (tile.layerType === expectedLayer[layer]) continue;
        const targetLayer = (Object.keys(expectedLayer) as MapLayerId[]).find((candidate) => expectedLayer[candidate] === tile.layerType);
        if (!targetLayer) throw new BadRequestException(`Tile #${tileId} possui layer cadastrada inválida: "${tile.layerType}"`);
        const index = layers[layer].indexOf(tileId);
        layers[layer][index] = null;
        layers[targetLayer][index] = tileId;
      }
    }
  }

  private buildTilesFromLegacy(tiles: MapTileInput[]): ResolvedTile[] {
    return tiles.map((t) => ({ x: t.x, y: t.y, type: t.type, ...tileProps(t.type) }));
  }

  private validateEntities(entities: MapEntity[] | undefined, width: number, height: number): MapEntity[] {
    const out = (entities ?? []).filter((e) => e && typeof e.x === 'number' && typeof e.y === 'number');
    for (const e of out) {
      if (e.x < 0 || e.y < 0 || e.x >= width || e.y >= height) {
        throw new BadRequestException(`Entidade "${e.type}" fora dos limites do mapa (${e.x},${e.y})`);
      }
    }
    return out;
  }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { MapLayerId, TileCategory, TileDefinition, TileLayerType, TilesetDefinition } from '@aetheria/types';
import { MAP_LAYERS } from '@aetheria/types';
import type { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';
import { TilesetRegistry } from './tileset-registry.service';

const DEFAULT_TILE = 32;

export interface TilesetUploadInput {
  name: string;
  fileName?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  tileWidth?: number;
  tileHeight?: number;
  dataBase64: string;
}

export interface TileUpdateInput {
  tileId: number;
  name?: string;
  category?: TileCategory;
  layerType?: TileLayerType;
  walkable?: boolean;
  blocksMovement?: boolean;
  blocksProjectiles?: boolean;
  blocksVision?: boolean;
  movementCost?: number;
  tags?: string[];
  isWater?: boolean;
  isHazard?: boolean;
  isStairs?: boolean;
  isPortal?: boolean;
  enabled?: boolean;
}

function pngDimensions(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function webpDimensions(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 30) return null;
  if (buf[0] !== 0x52 || buf[1] !== 0x49 || buf[2] !== 0x46 || buf[3] !== 0x46) return null;
  if (buf[8] !== 0x57 || buf[9] !== 0x45 || buf[10] !== 0x42 || buf[11] !== 0x50) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const chunk = String.fromCharCode(buf[12], buf[13], buf[14], buf[15]);
  if (chunk === 'VP8X') {
    return { width: 1 + (view.getUint32(24) & 0x00ffffff), height: 1 + (view.getUint32(27) & 0x00ffffff) };
  }
  if (chunk === 'VP8L') {
    const bits = view.getUint32(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8 ') {
    return { width: view.getUint16(26) & 0x3fff, height: view.getUint16(28) & 0x3fff };
  }
  return null;
}

function imageDimensions(buf: Uint8Array): { width: number; height: number } | null {
  return pngDimensions(buf) ?? webpDimensions(buf);
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'tileset';
}

/** Persistência de tilesets + tile definitions (Central de Comando). */
@Injectable()
export class TilesetAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: TilesetRegistry,
  ) {}

  async list(): Promise<(TilesetDefinition & { usage: number })[]> {
    const rows = await this.prisma.tileset.findMany({ orderBy: { tileset_id: 'asc' } });
    const maps = await this.prisma.map.findMany({ select: { id: true, layers: true } });
    const defs = await this.prisma.tileDefinition.findMany({ select: { tileset_id: true, tile_id: true } });
    const idsByTileset = new Map<number, Set<number>>();
    for (const d of defs) {
      let set = idsByTileset.get(d.tileset_id);
      if (!set) idsByTileset.set(d.tileset_id, (set = new Set()));
      set.add(d.tile_id);
    }
    const usageByTileset = new Map<number, number>();
    for (const m of maps) {
      const layers = m.layers as Record<MapLayerId, (number | null)[]>;
      const used = this.collectTileIds(layers);
      for (const [tilesetId, ids] of idsByTileset) {
        for (const id of used) if (ids.has(id)) { usageByTileset.set(tilesetId, (usageByTileset.get(tilesetId) ?? 0) + 1); break; }
      }
    }
    return rows.map((r) => ({ ...this.toDefinition(r), usage: usageByTileset.get(r.tileset_id) ?? 0 }));
  }

  private collectTileIds(layers: Record<MapLayerId, (number | null)[]>): Set<number> {
    const ids = new Set<number>();
    if (!layers || typeof layers !== 'object') return ids;
    for (const layer of MAP_LAYERS) {
      const arr = layers[layer];
      if (!Array.isArray(arr)) continue;
      for (const id of arr) if (id != null) ids.add(id);
    }
    return ids;
  }

  async get(id: number) {
    const tileset = await this.prisma.tileset.findUnique({ where: { tileset_id: id } });
    if (!tileset) throw new NotFoundException('Tileset não encontrado');
    const asset = await this.prisma.spriteAsset.findUnique({ where: { sprite_asset_id: tileset.sprite_asset_id } });
    return {
      ...this.toDefinition(tileset),
      asset: asset ? { fileName: asset.file_name, mimeType: asset.mime_type, imageWidth: asset.image_width, imageHeight: asset.image_height } : null,
      tiles: await this.listTiles(id),
    };
  }

  async listTiles(tilesetId: number): Promise<TileDefinition[]> {
    const rows = await this.prisma.tileDefinition.findMany({ where: { tileset_id: tilesetId }, orderBy: { index: 'asc' } });
    return rows.map((r) => this.tileToDefinition(r));
  }

  async upload(input: TilesetUploadInput) {
    if (!input.name?.trim()) throw new BadRequestException('Nome do tileset é obrigatório');
    if (!input.dataBase64) throw new BadRequestException('dataBase64 é obrigatório');
    const mimeType = input.mimeType ?? 'image/png';
    if (mimeType !== 'image/png' && mimeType !== 'image/webp') {
      throw new BadRequestException('Formato não suportado (use PNG ou WEBP)');
    }

    const data = new Uint8Array(Buffer.from(input.dataBase64, 'base64'));
    if (data.length === 0) throw new BadRequestException('Arquivo vazio');
    const dims = imageDimensions(data);
    const width = dims?.width ?? input.width ?? 0;
    const height = dims?.height ?? input.height ?? 0;
    if (width <= 0 || height <= 0) throw new BadRequestException('Não foi possível ler as dimensões da imagem');

    const tileWidth = input.tileWidth ?? DEFAULT_TILE;
    const tileHeight = input.tileHeight ?? DEFAULT_TILE;
    if (tileWidth <= 0 || tileHeight <= 0) throw new BadRequestException('Dimensão de tile inválida');
    if (width % tileWidth !== 0 || height % tileHeight !== 0) {
      throw new BadRequestException(`A largura/altura do tileset não é múltipla de ${tileWidth}px.`);
    }

    const columns = Math.floor(width / tileWidth);
    const rows = Math.floor(height / tileHeight);
    const checksum = createHash('sha256').update(data).digest('hex');

    const created = await this.prisma.$transaction(async (tx) => {
      const asset = await tx.spriteAsset.create({
        data: {
          file_name: `tileset_placeholder.png`,
          mime_type: mimeType,
          file_size: data.length,
          image_width: width,
          image_height: height,
          data: Buffer.from(data),
          checksum,
        },
      });
      const slug = await this.uniqueSlug(input.name);
      const tileset = await tx.tileset.create({
        data: {
          name: input.name.trim(),
          slug,
          sprite_asset_id: asset.sprite_asset_id,
          tile_width: tileWidth,
          tile_height: tileHeight,
          columns,
          rows,
        },
      });
      const tiles: Prisma.TileDefinitionCreateManyInput[] = [];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < columns; x++) {
          const index = y * columns + x;
          tiles.push({
            tileset_id: tileset.tileset_id,
            index,
            source_x: x * tileWidth,
            source_y: y * tileHeight,
            width: tileWidth,
            height: tileHeight,
            name: `Tile ${index}`,
            category: 'other',
            layer_type: 'ground',
            walkable: true,
          });
        }
      }
      await tx.tileDefinition.createMany({ data: tiles });
      await tx.spriteAsset.update({
        where: { sprite_asset_id: asset.sprite_asset_id },
        data: { file_name: `tileset_${tileset.tileset_id}.png` },
      });
      return tileset;
    });

    await this.registry.invalidate();
    return this.get(created.tileset_id);
  }

  async update(id: number, input: { name?: string; enabled?: boolean }) {
    const existing = await this.prisma.tileset.findUnique({ where: { tileset_id: id } });
    if (!existing) throw new NotFoundException('Tileset não encontrado');
    const data: Prisma.TilesetUpdateInput = { version: existing.version + 1 };
    if (input.name?.trim()) data.name = input.name.trim();
    if (typeof input.enabled === 'boolean') data.enabled = input.enabled;
    await this.prisma.tileset.update({ where: { tileset_id: id }, data });
    await this.registry.invalidate();
    return this.get(id);
  }

  async remove(id: number) {
    const existing = await this.prisma.tileset.findUnique({ where: { tileset_id: id } });
    if (!existing) throw new NotFoundException('Tileset não encontrado');
    const usedBy = await this.usedBy(id);
    if (usedBy.length > 0) {
      throw new BadRequestException(`Tileset em uso por: ${usedBy.map((m) => m.name).join(', ')}`);
    }
    await this.prisma.tileset.delete({ where: { tileset_id: id } });
    await this.registry.invalidate();
    return { ok: true };
  }

  async updateTiles(tilesetId: number, updates: TileUpdateInput[]) {
    const existing = await this.prisma.tileset.findUnique({ where: { tileset_id: tilesetId } });
    if (!existing) throw new NotFoundException('Tileset não encontrado');
    if (!Array.isArray(updates) || updates.length === 0) throw new BadRequestException('Nenhum tile para atualizar');

    const owned = await this.prisma.tileDefinition.findMany({ where: { tileset_id: tilesetId }, select: { tile_id: true } });
    const ownedIds = new Set(owned.map((t) => t.tile_id));

    await this.prisma.$transaction(
      updates
        .filter((u) => ownedIds.has(u.tileId))
        .map((u) =>
          this.prisma.tileDefinition.update({
            where: { tile_id: u.tileId },
            data: this.tileUpdateData(u),
          }),
        ),
    );
    await this.registry.invalidate();
    return this.listTiles(tilesetId);
  }

  async usedBy(tilesetId: number): Promise<{ id: string; name: string }[]> {
    const tiles = await this.prisma.tileDefinition.findMany({ where: { tileset_id: tilesetId }, select: { tile_id: true } });
    const ids = new Set(tiles.map((t) => t.tile_id));
    if (ids.size === 0) return [];
    const maps = await this.prisma.map.findMany({ select: { id: true, name: true, layers: true } });
    return maps.filter((m) => this.layersUse(m.layers as Record<MapLayerId, (number | null)[]>, ids)).map((m) => ({ id: m.id, name: m.name }));
  }

  private layersUse(layers: Record<MapLayerId, (number | null)[]>, ids: Set<number>): boolean {
    if (!layers || typeof layers !== 'object') return false;
    for (const layer of MAP_LAYERS) {
      const arr = layers[layer];
      if (!Array.isArray(arr)) continue;
      for (const id of arr) if (id != null && ids.has(id)) return true;
    }
    return false;
  }

  private tileUpdateData(u: TileUpdateInput): Prisma.TileDefinitionUpdateInput {
    const data: Prisma.TileDefinitionUpdateInput = {};
    if (u.name !== undefined) data.name = u.name;
    if (u.category !== undefined) data.category = u.category;
    if (u.layerType !== undefined) data.layer_type = u.layerType;
    if (u.walkable !== undefined) data.walkable = u.walkable;
    if (u.blocksMovement !== undefined) data.blocks_movement = u.blocksMovement;
    if (u.blocksProjectiles !== undefined) data.blocks_projectiles = u.blocksProjectiles;
    if (u.blocksVision !== undefined) data.blocks_vision = u.blocksVision;
    if (u.movementCost !== undefined) data.movement_cost = u.movementCost;
    if (u.tags !== undefined) data.tags = u.tags as unknown as Prisma.InputJsonValue;
    if (u.isWater !== undefined) data.is_water = u.isWater;
    if (u.isHazard !== undefined) data.is_hazard = u.isHazard;
    if (u.isStairs !== undefined) data.is_stairs = u.isStairs;
    if (u.isPortal !== undefined) data.is_portal = u.isPortal;
    if (u.enabled !== undefined) data.enabled = u.enabled;
    return data;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name);
    const existing = await this.prisma.tileset.findUnique({ where: { slug: base } });
    if (!existing) return base;
    return `${base}-${Date.now().toString(36)}`;
  }

  private toDefinition(r: Prisma.TilesetGetPayload<object>): TilesetDefinition {
    return {
      tilesetId: r.tileset_id,
      name: r.name,
      slug: r.slug,
      assetId: r.sprite_asset_id,
      tileWidth: r.tile_width,
      tileHeight: r.tile_height,
      columns: r.columns,
      rows: r.rows,
      enabled: r.enabled,
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private tileToDefinition(r: Prisma.TileDefinitionGetPayload<object>): TileDefinition {
    return {
      tileId: r.tile_id,
      tilesetId: r.tileset_id,
      index: r.index,
      sourceX: r.source_x,
      sourceY: r.source_y,
      width: r.width,
      height: r.height,
      name: r.name ?? undefined,
      category: r.category as TileCategory,
      layerType: r.layer_type as TileLayerType,
      physics: {
        walkable: r.walkable,
        blocksMovement: r.blocks_movement,
        blocksProjectiles: r.blocks_projectiles,
        blocksVision: r.blocks_vision,
        movementCost: r.movement_cost,
      },
      tags: (r.tags as string[]) ?? [],
      isWater: r.is_water,
      isHazard: r.is_hazard,
      isStairs: r.is_stairs,
      isPortal: r.is_portal,
      animation: (r.animation as TileDefinition['animation']) ?? null,
      enabled: r.enabled,
    };
  }
}

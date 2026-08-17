import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TILE } from '@aetheria/config';
import { PrismaService } from '../../prisma/prisma.service';
import { MapRegistry } from './map-registry.service';

export interface MapTileInput {
  x: number;
  y: number;
  type: number;
}

export interface MapSaveInput {
  id?: string;
  name: string;
  width: number;
  height: number;
  tiles: MapTileInput[];
}

function tileProps(type: number): { walkable: boolean; blocksVision: boolean } {
  const walkable = type === TILE.GRASS || type === TILE.PATH;
  const blocksVision = type === TILE.TREE || type === TILE.ROCK || type === TILE.WALL;
  return { walkable, blocksVision };
}

/** Persistência de mapas custom (Map + MapTile). */
@Injectable()
export class MapAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: MapRegistry,
  ) {}

  async save(input: MapSaveInput) {
    if (!input.name?.trim()) throw new BadRequestException('Nome do mapa é obrigatório');
    if (input.width < 4 || input.width > 256 || input.height < 4 || input.height > 256) {
      throw new BadRequestException('Dimensões fora do intervalo (4–256)');
    }
    if (input.tiles.length !== input.width * input.height) {
      throw new BadRequestException(`São esperados ${input.width * input.height} tiles, recebidos ${input.tiles.length}`);
    }

    const id = input.id ?? `map_${Date.now().toString(36)}`;
    const map = await this.prisma.map.upsert({
      where: { id },
      update: { name: input.name, width: input.width, height: input.height },
      create: { id, name: input.name, width: input.width, height: input.height },
    });

    await this.prisma.mapTile.deleteMany({ where: { mapId: id } });
    await this.prisma.mapTile.createMany({
      data: input.tiles.map((t) => {
        const props = tileProps(t.type);
        return {
          mapId: id,
          x: t.x,
          y: t.y,
          z: 0,
          type: t.type,
          walkable: props.walkable,
          blocksVision: props.blocksVision,
        };
      }),
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
}

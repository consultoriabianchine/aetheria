import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { MapTile } from '@aetheria/types';
import { PrismaService } from '../../prisma/prisma.service';

export interface StoredMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: MapTile[];
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

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.warm();
  }

  async warm() {
    try {
      const rows = await this.prisma.map.findMany({ include: { tiles: true } });
      for (const m of rows) {
        this.maps.set(m.id, {
          id: m.id,
          name: m.name,
          width: m.width,
          height: m.height,
          tiles: m.tiles.map((t) => ({ x: t.x, y: t.y, z: t.z, type: t.type, walkable: t.walkable, blocksVision: t.blocksVision })),
        });
      }
      this.logger.log(`MapRegistry carregado: ${this.maps.size} mapa(s).`);
    } catch (err) {
      this.logger.warn(`Mapas indisponíveis (${(err as Error).message}) — hunts usarão arena procedural.`);
    }
  }

  getMap(id: string): StoredMap | null {
    return this.maps.get(id) ?? null;
  }

  list(): { id: string; name: string; width: number; height: number }[] {
    return [...this.maps.values()].map((m) => ({ id: m.id, name: m.name, width: m.width, height: m.height }));
  }

  async invalidate(id: string) {
    const row = await this.prisma.map.findUnique({ where: { id }, include: { tiles: true } });
    if (row) {
      this.maps.set(id, {
        id: row.id,
        name: row.name,
        width: row.width,
        height: row.height,
        tiles: row.tiles.map((t) => ({ x: t.x, y: t.y, z: t.z, type: t.type, walkable: t.walkable, blocksVision: t.blocksVision })),
      });
    } else {
      this.maps.delete(id);
    }
  }
}

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HUNT_CATALOG } from '@aetheria/config';
import type { HuntBossDefinition, HuntDefinition, HuntMonsterEntry, HuntTheme } from '@aetheria/types';
import type { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Cache das hunts. Começa seedando HUNT_CATALOG no banco (se vazio) e passa a
 * ler do banco como fonte de verdade; se o banco estiver indisponível, usa o
 * catálogo estático como fallback. Invalidado quando o admin salva/exclui.
 */
@Injectable()
export class HuntRegistry implements OnModuleInit {
  private readonly logger = new Logger(HuntRegistry.name);
  private hunts: HuntDefinition[] = HUNT_CATALOG;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.warm();
  }

  async warm() {
    try {
      let rows = await this.prisma.hunt.findMany({ orderBy: { ladderPosition: 'asc' } });
      if (rows.length === 0) {
        await this.seedFromCatalog();
        rows = await this.prisma.hunt.findMany({ orderBy: { ladderPosition: 'asc' } });
      }
      this.hunts = rows.map((r) => this.toDefinition(r));
      this.logger.log(`HuntRegistry carregado: ${this.hunts.length} hunt(s).`);
    } catch (err) {
      this.hunts = HUNT_CATALOG;
      this.logger.warn(`Hunts indisponíveis (${(err as Error).message}) — usando HUNT_CATALOG.`);
    }
  }

  getAll(): HuntDefinition[] {
    return this.hunts;
  }

  get(id: string): HuntDefinition | null {
    return this.hunts.find((h) => h.id === id) ?? null;
  }

  async invalidate() {
    await this.warm();
  }

  private async seedFromCatalog() {
    for (const h of HUNT_CATALOG) {
      await this.prisma.hunt.create({ data: this.toRow(h) });
    }
  }

  private toRow(h: HuntDefinition) {
    return {
      id: h.id,
      name: h.name,
      ladderPosition: h.ladderPosition,
      suggestedLevel: h.suggestedLevel,
      combatScore: h.combatScore ?? null,
      basePackSize: h.basePackSize,
      maxPackSize: h.maxPackSize,
      monsters: h.monsters as unknown as Prisma.InputJsonValue,
      boss: h.boss as unknown as Prisma.InputJsonValue,
      arenaId: h.arenaId,
      arenaWidth: h.arenaWidth ?? null,
      arenaHeight: h.arenaHeight ?? null,
      mapId: h.mapId ?? null,
      theme: h.theme ? (h.theme as unknown as Prisma.InputJsonValue) : undefined,
      enabled: h.enabled,
    };
  }

  private toDefinition(r: {
    id: string;
    name: string;
    ladderPosition: number;
    suggestedLevel: number;
    combatScore: number | null;
    basePackSize: number;
    maxPackSize: number;
    monsters: unknown;
    boss: unknown;
    arenaId: string;
    arenaWidth: number | null;
    arenaHeight: number | null;
    mapId: string | null;
    theme: unknown;
    enabled: boolean;
  }): HuntDefinition {
    return {
      id: r.id,
      name: r.name,
      ladderPosition: r.ladderPosition,
      suggestedLevel: r.suggestedLevel,
      combatScore: r.combatScore ?? undefined,
      basePackSize: r.basePackSize,
      maxPackSize: r.maxPackSize,
      monsters: r.monsters as HuntMonsterEntry[],
      boss: r.boss as HuntBossDefinition,
      arenaId: r.arenaId,
      arenaWidth: r.arenaWidth ?? undefined,
      arenaHeight: r.arenaHeight ?? undefined,
      mapId: r.mapId ?? undefined,
      theme: (r.theme as HuntTheme | null) ?? undefined,
      enabled: r.enabled,
    };
  }
}

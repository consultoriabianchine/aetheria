import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { HuntDefinition } from '@aetheria/types';
import type { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';
import { HuntRegistry } from './hunt-registry.service';

/** Persistência de hunts (tabela `hunts`, fonte de verdade do motor). */
@Injectable()
export class HuntAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: HuntRegistry,
  ) {}

  async save(input: HuntDefinition & { id?: string }) {
    if (!input.name?.trim()) throw new BadRequestException('Nome da hunt é obrigatório');
    if (!input.arenaId) throw new BadRequestException('arenaId é obrigatório');
    if (!input.monsters?.length) throw new BadRequestException('Adicione ao menos um monstro');

    const id = input.id ?? `hunt_${Date.now().toString(36)}`;
    const data = {
      id,
      name: input.name,
      ladderPosition: input.ladderPosition ?? 0,
      suggestedLevel: input.suggestedLevel ?? 1,
      combatScore: input.combatScore ?? null,
      basePackSize: input.basePackSize ?? 4,
      maxPackSize: input.maxPackSize ?? 9,
      monsters: input.monsters as unknown as Prisma.InputJsonValue,
      boss: input.boss as unknown as Prisma.InputJsonValue,
      arenaId: input.arenaId,
      arenaWidth: input.arenaWidth ?? null,
      arenaHeight: input.arenaHeight ?? null,
      mapId: input.mapId ?? null,
      theme: input.theme ? (input.theme as unknown as Prisma.InputJsonValue) : undefined,
      enabled: input.enabled,
    };
    await this.prisma.hunt.upsert({
      where: { id },
      create: data,
      update: data,
    });
    await this.registry.invalidate();
    return { ok: true, id };
  }

  async remove(id: string) {
    const existing = await this.prisma.hunt.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Hunt não encontrada');
    await this.prisma.hunt.delete({ where: { id } });
    await this.registry.invalidate();
    return { ok: true };
  }
}

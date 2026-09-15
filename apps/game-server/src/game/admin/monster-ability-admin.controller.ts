import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Put, UseGuards } from '@nestjs/common';
import { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthGuard } from './admin-auth.guard';

@Controller('admin/monsters')
@UseGuards(AdminAuthGuard)
export class MonsterAbilityAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/abilities')
  list(@Param('id', ParseIntPipe) id: number) {
    return this.prisma.monsterAbilityAssignment.findMany({ where: { monster_id: id }, orderBy: { priority: 'asc' } });
  }

  @Put(':id/abilities')
  async replace(@Param('id', ParseIntPipe) id: number, @Body() body: { abilities?: Array<{ abilityId: number; enabled?: boolean; priority: number; chance: number; cooldownOverrideMs?: number; parameters?: Record<string, number>; conditions?: unknown }> }) {
    const abilities = body.abilities ?? [];
    const valid = (item: { abilityId: number; chance: number; priority: number }) =>
      Number.isInteger(item.abilityId) && item.abilityId > 0 && item.chance >= 0 && item.chance <= 1 && item.priority >= 1;
    if (abilities.some((item) => !valid(item))) throw new BadRequestException('assignment inválido: abilityId deve ser um id positivo, chance entre 0 e 1 e prioridade >= 1');
    await this.prisma.$transaction(async (tx) => {
      await tx.monsterAbilityAssignment.deleteMany({ where: { monster_id: id } });
      await tx.monsterAbilityAssignment.createMany({ data: abilities.map((item) => ({ monster_id: id, ability_id: item.abilityId, enabled: item.enabled ?? true, priority: item.priority, chance: item.chance, cooldown_override_ms: item.cooldownOverrideMs ?? null, parameters: item.parameters as Prisma.InputJsonValue | undefined, conditions: item.conditions as Prisma.InputJsonValue | undefined })) });
    });
    return this.list(id);
  }
}

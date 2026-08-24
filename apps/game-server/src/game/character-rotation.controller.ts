import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Prisma } from '@aetheria/database';
import { PrismaService } from '../prisma/prisma.service';

@Controller('characters')
export class CharacterRotationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/attack-rotation/:preset')
  getAttack(@Param('id') characterId: string, @Param('preset') preset: string) {
    return this.prisma.characterAttackRotationSlot.findMany({ where: { character_id: characterId, preset }, orderBy: { slot_position: 'asc' } });
  }

  @Put(':id/attack-rotation/:preset')
  replaceAttack(@Param('id') characterId: string, @Param('preset') preset: string, @Body() body: { slots?: Array<{ position: number; abilityId?: number; enabled: boolean; minTargets?: number }> }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.characterAttackRotationSlot.deleteMany({ where: { character_id: characterId, preset } });
      await tx.characterAttackRotationSlot.createMany({ data: (body.slots ?? []).map((slot) => ({ character_id: characterId, preset, slot_position: slot.position, ability_id: slot.abilityId ?? null, enabled: slot.enabled, min_targets: slot.minTargets ?? null })) });
      return tx.characterAttackRotationSlot.findMany({ where: { character_id: characterId, preset }, orderBy: { slot_position: 'asc' } });
    });
  }

  @Get(':id/healing-rotation/:preset')
  getHealing(@Param('id') characterId: string, @Param('preset') preset: string) {
    return this.prisma.characterHealingRotationSlot.findMany({ where: { character_id: characterId, preset }, orderBy: { slot_position: 'asc' } });
  }

  @Put(':id/healing-rotation/:preset')
  replaceHealing(@Param('id') characterId: string, @Param('preset') preset: string, @Body() body: { slots?: Array<{ position: number; abilityId?: number; enabled: boolean; trigger: unknown }> }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.characterHealingRotationSlot.deleteMany({ where: { character_id: characterId, preset } });
      await tx.characterHealingRotationSlot.createMany({ data: (body.slots ?? []).map((slot) => ({ character_id: characterId, preset, slot_position: slot.position, ability_id: slot.abilityId ?? null, enabled: slot.enabled, trigger: slot.trigger as Prisma.InputJsonValue })) });
      return tx.characterHealingRotationSlot.findMany({ where: { character_id: characterId, preset }, orderBy: { slot_position: 'asc' } });
    });
  }
}

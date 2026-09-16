import { Prisma } from '@aetheria/database';
import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import type { CombatAbilityDefinition } from '@aetheria/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { normalizeVisual } from './visual-validation';

@Controller('admin/abilities')
@UseGuards(AdminAuthGuard)
export class AbilityAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() { return (await this.prisma.combatAbility.findMany({ orderBy: { id: 'asc' } })).map((row) => this.toDefinition(row)); }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    const row = await this.prisma.combatAbility.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Ability não encontrada');
    return this.toDefinition(row);
  }

  @Post()
  async create(@Body() body: Partial<CombatAbilityDefinition>) {
    return this.toDefinition(await this.prisma.combatAbility.create({ data: this.toData(body) }));
  }


  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<CombatAbilityDefinition>) {
    const data = this.toData(body) as unknown as Prisma.CombatAbilityUpdateInput;
    if (body.shootTypeId === null) data.shoot_type = { disconnect: true };
    if (body.effectTypeId === null) data.effect_type = { disconnect: true };
    return this.toDefinition(await this.prisma.combatAbility.update({ where: { id }, data }));
  }

  private toData(body: Partial<CombatAbilityDefinition>) {
    if (!body.slug || !body.name) throw new Error('slug e name são obrigatórios');
    return {
      slug: body.slug, name: body.name, description: body.description ?? null, icon_path: body.icon ?? null,
      owner_type: body.ownerType ?? 'both', player_class: body.playerClass ?? null,
      category: body.category ?? 'attack', target_mode: body.targetMode ?? 'single_enemy',
      damage_type: body.damageType ?? null, power_source: body.powerSource ?? 'fixed',
      cooldown_ms: Math.max(0, Math.round(body.cooldownMs ?? 2000)), cooldown_group: body.cooldownGroup ?? 'attack',
      range_tiles: Math.max(0, Math.round(body.rangeTiles ?? 1)), mana_cost: body.manaCost ?? null,
      level_requirement: body.levelRequirement ?? null,       area_config: body.areaConfig ? (body.areaConfig as unknown as Prisma.InputJsonValue) : undefined,
      shoot_type: body.shootTypeId ? { connect: { id: body.shootTypeId } } : undefined,
      effect_type: body.effectTypeId ? { connect: { id: body.effectTypeId } } : undefined,
      visual: normalizeVisual(body.visual) ? (normalizeVisual(body.visual) as unknown as Prisma.InputJsonValue) : undefined,
      allowed_parameters: (body.allowedParameters ?? []) as unknown as Prisma.InputJsonValue, default_parameters: body.defaultParameters ? (body.defaultParameters as unknown as Prisma.InputJsonValue) : undefined,
      conditions: body.conditions ? (body.conditions as unknown as Prisma.InputJsonValue) : undefined, enabled: body.enabled ?? true,
    };
  }

  private toDefinition(row: any): CombatAbilityDefinition {
    return { abilityId: row.id, slug: row.slug, name: row.name, description: row.description ?? undefined, icon: row.icon_path ?? undefined,
      ownerType: row.owner_type, playerClass: row.player_class ?? undefined, category: row.category,
      targetMode: row.target_mode, damageType: row.damage_type ?? undefined, powerSource: row.power_source,
      cooldownMs: row.cooldown_ms, cooldownGroup: row.cooldown_group, rangeTiles: row.range_tiles,
      manaCost: row.mana_cost ?? undefined, levelRequirement: row.level_requirement ?? undefined,
      areaConfig: row.area_config ?? undefined, shootTypeId: row.shoot_type_id ?? undefined,
      effectTypeId: row.effect_type_id ?? undefined, visual: row.visual ?? undefined,
      allowedParameters: row.allowed_parameters ?? [],
      defaultParameters: row.default_parameters ?? undefined, conditions: row.conditions ?? undefined,
      enabled: row.enabled, createdAt: row.created_at, updatedAt: row.updated_at };
  }
}

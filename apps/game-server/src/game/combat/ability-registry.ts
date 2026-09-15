import { Injectable } from '@nestjs/common';
import type { CombatAbilityDefinition } from '@aetheria/types';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AbilityRegistry {
  private abilities = new Map<number, CombatAbilityDefinition>();
  private loaded = false;

  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<CombatAbilityDefinition[]> {
    if (!this.loaded) await this.reload();
    return [...this.abilities.values()].filter((ability) => ability.enabled);
  }

  async get(id: number): Promise<CombatAbilityDefinition | null> {
    if (!this.loaded) await this.reload();
    return this.abilities.get(id) ?? null;
  }

  async reload(): Promise<void> {
    if (!this.prisma) {
      this.abilities = new Map();
      this.loaded = true;
      return;
    }
    const rows = await this.prisma.combatAbility.findMany({ where: { enabled: true } });
    this.abilities = new Map(rows.map((row) => [row.id, this.toDefinition(row)]));
    this.loaded = true;
  }

  invalidate() { this.loaded = false; }

  private toDefinition(row: any): CombatAbilityDefinition {
    return {
      abilityId: row.id, slug: row.slug, name: row.name, description: row.description ?? undefined, icon: row.icon_path ?? undefined,
      ownerType: row.owner_type, playerClass: row.player_class ?? undefined, category: row.category,
      targetMode: row.target_mode, damageType: row.damage_type ?? undefined, powerSource: row.power_source,
      cooldownMs: row.cooldown_ms, cooldownGroup: row.cooldown_group, rangeTiles: row.range_tiles,
      manaCost: row.mana_cost ?? undefined, levelRequirement: row.level_requirement ?? undefined,
      areaConfig: row.area_config ?? undefined, shootTypeId: row.shoot_type_id ?? undefined,
      effectTypeId: row.effect_type_id ?? undefined, visual: row.visual ?? undefined,
      allowedParameters: row.allowed_parameters ?? [],
      defaultParameters: row.default_parameters ?? undefined, conditions: row.conditions ?? undefined,
      enabled: row.enabled, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
}

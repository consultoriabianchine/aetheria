import type { BossStatMultipliers, CreatureDefinition } from '@aetheria/types';

export interface BossStats {
  maxHealth: number;
  attack: number;
  experience: number;
}

/**
 * Calcula as stats de um boss a partir de um monstro base (multiplicadores do
 * HUNT_CONFIG). Função pura e determinística — somente HP, dano e XP mudam.
 */
export function calculateBossStats(
  baseMonster: CreatureDefinition,
  multipliers: BossStatMultipliers,
): BossStats {
  return {
    maxHealth: Math.round(baseMonster.maxHealth * multipliers.hp),
    attack: Math.round(baseMonster.attack * multipliers.damage),
    experience: Math.round(baseMonster.experience * multipliers.xp),
  };
}
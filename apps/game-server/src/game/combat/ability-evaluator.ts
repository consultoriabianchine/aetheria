import type { AbilityUseConditions } from '@aetheria/types';

export interface PrioritySlot { position: number; enabled: boolean; abilityId?: number; minTargets?: number; trigger?: { hpBelowPercent: number } }

export function evaluatePrioritySlots<T extends PrioritySlot>(slots: T[], validate: (slot: T) => boolean): T | null {
  return [...slots].filter((slot) => slot.enabled && slot.abilityId !== undefined).sort((a, b) => a.position - b.position).find(validate) ?? null;
}

export function conditionsMatch(conditions: AbilityUseConditions | undefined, input: { targetCount: number; selfHpPercent: number; targetHpPercent: number; distance: number }): boolean {
  if (!conditions) return true;
  if (conditions.minTargets !== undefined && input.targetCount < conditions.minTargets) return false;
  if (conditions.selfHpBelowPercent !== undefined && input.selfHpPercent >= conditions.selfHpBelowPercent) return false;
  if (conditions.targetHpBelowPercent !== undefined && input.targetHpPercent >= conditions.targetHpBelowPercent) return false;
  if (conditions.minDistance !== undefined && input.distance < conditions.minDistance) return false;
  if (conditions.maxDistance !== undefined && input.distance > conditions.maxDistance) return false;
  return true;
}

export function rollChance(chance: number, random: () => number): boolean {
  return chance >= 1 || (chance > 0 && random() < chance);
}

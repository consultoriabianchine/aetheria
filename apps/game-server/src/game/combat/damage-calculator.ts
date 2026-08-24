import type { CharacterCombatStats, DamageType } from '@aetheria/types';
import { applyPhysicalMitigation, applyResistanceMitigation, calculatePhysicalMitigation } from './combat-formulas';

export interface DamageCalculationResult {
  rawDamage: number;
  mitigatedDamage: number;
  finalDamage: number;
  mitigation: number;
  immune: boolean;
}

export function calculateMitigatedDamage(input: {
  damage: number;
  damageType: DamageType;
  target: CharacterCombatStats;
  minimumDamage?: number;
  immune?: boolean;
  damageTakenModifier?: number;
}): DamageCalculationResult {
  const rawDamage = Math.max(0, input.damage);
  const immune = input.immune ?? false;
  const mitigation =
    input.damageType === 'physical'
      ? calculatePhysicalMitigation(input.target.armor + input.target.defense, input.target.level)
      : input.target.resistances[input.damageType] ?? 0;
  const beforeElement = immune
    ? 0
    : input.damageType === 'physical'
      ? applyPhysicalMitigation(rawDamage, input.target.armor + input.target.defense, input.target.level)
      : applyResistanceMitigation(rawDamage, mitigation);
  const mitigatedDamage = beforeElement * (1 - (input.damageTakenModifier ?? 0));
  const rounded = Math.round(mitigatedDamage);
  return {
    rawDamage,
    mitigatedDamage,
    finalDamage: immune ? 0 : Math.max(input.minimumDamage ?? 1, rounded),
    mitigation,
    immune,
  };
}

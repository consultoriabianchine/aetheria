import type { CharacterCombatStats, DamageType } from '@aetheria/types';
import { applyPhysicalMitigation, applyResistanceMitigation, calculatePhysicalMitigation } from './combat-formulas';

export interface DamageCalculationResult {
  rawDamage: number;
  mitigatedDamage: number;
  finalDamage: number;
  mitigation: number;
}

export function calculateMitigatedDamage(input: {
  damage: number;
  damageType: DamageType;
  target: CharacterCombatStats;
  minimumDamage?: number;
}): DamageCalculationResult {
  const rawDamage = Math.max(0, input.damage);
  const mitigation =
    input.damageType === 'physical'
      ? calculatePhysicalMitigation(input.target.armor + input.target.defense, input.target.level)
      : input.target.resistances[input.damageType] ?? 0;
  const mitigatedDamage =
    input.damageType === 'physical'
      ? applyPhysicalMitigation(rawDamage, input.target.armor + input.target.defense, input.target.level)
      : applyResistanceMitigation(rawDamage, mitigation);
  const rounded = Math.round(mitigatedDamage);
  return {
    rawDamage,
    mitigatedDamage,
    finalDamage: Math.max(input.minimumDamage ?? 1, rounded),
    mitigation,
  };
}

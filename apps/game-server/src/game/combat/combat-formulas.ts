import { COMBAT_FORMULA_CONFIG } from '@aetheria/config';
import type { CombatSkill, DamageType } from '@aetheria/types';

export const DAMAGE_TYPES: readonly DamageType[] = [
  'physical',
  'fire',
  'ice',
  'energy',
  'earth',
  'holy',
  'death',
  'arcane',
] as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateLevelMultiplier(level: number): number {
  return 1 + Math.max(0, level) * COMBAT_FORMULA_CONFIG.levelScalingPerLevel;
}

export function calculateSkillMultiplier(skill: CombatSkill, level: number): number {
  const coefficient =
    skill === 'magic'
      ? COMBAT_FORMULA_CONFIG.magicScalingPerLevel
      : skill === 'distance'
        ? COMBAT_FORMULA_CONFIG.distanceScalingPerSkill
        : COMBAT_FORMULA_CONFIG.meleeScalingPerSkill;
  return 1 + Math.max(0, level) * coefficient;
}

export function calculateMeleeMultiplier(skill: number): number {
  return calculateSkillMultiplier('melee', skill);
}

export function calculateDistanceMultiplier(skill: number): number {
  return calculateSkillMultiplier('distance', skill);
}

export function calculateMagicMultiplier(magicLevel: number): number {
  return calculateSkillMultiplier('magic', magicLevel);
}

export function calculatePhysicalMitigation(physicalDefense: number, targetLevel: number): number {
  const defense = Math.max(0, physicalDefense);
  const constant =
    COMBAT_FORMULA_CONFIG.physicalDefenseBaseConstant +
    Math.max(0, targetLevel) * COMBAT_FORMULA_CONFIG.physicalDefenseLevelConstant;
  return defense / (defense + constant);
}

export function applyPhysicalMitigation(rawDamage: number, physicalDefense: number, targetLevel: number): number {
  return rawDamage * (1 - calculatePhysicalMitigation(physicalDefense, targetLevel));
}

export function applyResistanceMitigation(rawDamage: number, resistance: number): number {
  const capped = Math.min(resistance, COMBAT_FORMULA_CONFIG.maxResistance);
  return rawDamage * (1 - capped);
}

export function rollVariance(rng: () => number): number {
  const min = COMBAT_FORMULA_CONFIG.damageVarianceMin;
  const max = COMBAT_FORMULA_CONFIG.damageVarianceMax;
  return min + (max - min) * clamp(rng(), 0, 1);
}

export function rollCritical(criticalChance: number, rng: () => number): boolean {
  return clamp(criticalChance, 0, COMBAT_FORMULA_CONFIG.maxCriticalChance) > clamp(rng(), 0, 1);
}

export function calculateCritical(damage: number, criticalDamageMultiplier: number): number {
  return damage * Math.max(1, criticalDamageMultiplier);
}

export function calculateRawDamage(input: {
  basePower: number;
  flatPower?: number;
  skill: CombatSkill;
  skillLevel: number;
  level: number;
  abilityMultiplier?: number;
  otherMultiplier?: number;
  variance?: number;
}): number {
  return (
    (Math.max(0, input.basePower) + Math.max(0, input.flatPower ?? 0)) *
    calculateSkillMultiplier(input.skill, input.skillLevel) *
    calculateLevelMultiplier(input.level) *
    Math.max(0, input.abilityMultiplier ?? 1) *
    Math.max(0, input.otherMultiplier ?? 1) *
    Math.max(0, input.variance ?? 1)
  );
}

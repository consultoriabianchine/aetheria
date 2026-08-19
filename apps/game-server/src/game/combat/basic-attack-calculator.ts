import type { AmmoDefinition, CharacterCombatStats, CombatArchetype, CombatSkill, DamageType, WeaponDefinition } from '@aetheria/types';
import { COMBAT_FORMULA_PROFILES } from './combat-profiles';
import { calculateCritical, calculateRawDamage, rollCritical, rollVariance } from './combat-formulas';

export interface BasicAttackLoadout {
  weapon: WeaponDefinition | null;
  ammo?: AmmoDefinition | null;
}

export interface BasicAttackResult {
  valid: boolean;
  reason?: string;
  basePower: number;
  scalingSkill: CombatSkill;
  skillLevel: number;
  damageType: DamageType;
  rawDamage: number;
  critical: boolean;
  damageBeforeMitigation: number;
  range: number;
  trainingSkill: CombatSkill;
}

export function calculateBasicAttack(input: {
  archetype: CombatArchetype;
  attacker: CharacterCombatStats;
  loadout: BasicAttackLoadout;
  rng: () => number;
  abilityMultiplier?: number;
  flatPower?: number;
}): BasicAttackResult {
  const profile = COMBAT_FORMULA_PROFILES[input.archetype];
  const weapon = input.loadout.weapon;
  if (!weapon) return invalid(profile.scalingSkill, 'MISSING_WEAPON');

  let basePower = 0;
  let damageType: DamageType = weapon.damageType ?? 'physical';
  if (profile.basePowerSource === 'magic_weapon') {
    if (weapon.weaponType !== 'staff') return invalid(profile.scalingSkill, 'INVALID_MAGE_WEAPON');
    basePower = weapon.magicPower ?? 0;
    damageType = weapon.damageType ?? 'arcane';
  } else if (profile.basePowerSource === 'weapon') {
    if (!['sword', 'axe', 'club'].includes(weapon.weaponType)) return invalid(profile.scalingSkill, 'INVALID_WARRIOR_WEAPON');
    basePower = weapon.attackPower;
    damageType = weapon.damageType ?? 'physical';
  } else {
    if (!['bow', 'crossbow'].includes(weapon.weaponType)) return invalid(profile.scalingSkill, 'INVALID_ARCHER_WEAPON');
    const ammo = input.loadout.ammo;
    if (!ammo) return invalid(profile.scalingSkill, 'MISSING_AMMO');
    if (weapon.allowedAmmoType && ammo.ammoType !== weapon.allowedAmmoType) return invalid(profile.scalingSkill, 'INVALID_AMMO');
    basePower = weapon.attackPower + ammo.attackPower;
    damageType = ammo.damageType ?? weapon.damageType ?? 'physical';
  }

  const skillLevel =
    profile.scalingSkill === 'magic'
      ? input.attacker.magicLevel
      : profile.scalingSkill === 'distance'
        ? input.attacker.distanceSkill
        : input.attacker.meleeSkill;
  const rawDamage = calculateRawDamage({
    basePower,
    flatPower: input.flatPower,
    skill: profile.scalingSkill,
    skillLevel,
    level: input.attacker.level,
    abilityMultiplier: input.abilityMultiplier ?? 1,
    variance: rollVariance(input.rng),
  });
  const critical = rollCritical(input.attacker.criticalChance, input.rng);
  const damageBeforeMitigation = critical ? calculateCritical(rawDamage, input.attacker.criticalDamage) : rawDamage;
  return {
    valid: true,
    basePower,
    scalingSkill: profile.scalingSkill,
    skillLevel,
    damageType,
    rawDamage,
    critical,
    damageBeforeMitigation,
    range: weapon.range,
    trainingSkill: profile.scalingSkill,
  };
}

function invalid(trainingSkill: CombatSkill, reason: string): BasicAttackResult {
  return {
    valid: false,
    reason,
    basePower: 0,
    scalingSkill: trainingSkill,
    skillLevel: 0,
    damageType: 'physical',
    rawDamage: 0,
    critical: false,
    damageBeforeMitigation: 0,
    range: 0,
    trainingSkill,
  };
}

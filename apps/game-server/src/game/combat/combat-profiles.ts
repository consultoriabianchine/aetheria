import { COMBAT_FORMULA_CONFIG } from '@aetheria/config';
import type { CombatArchetype, CombatFormulaProfile, WeaponType } from '@aetheria/types';

export const COMBAT_FORMULA_PROFILES: Record<CombatArchetype, CombatFormulaProfile> = {
  mage: {
    basePowerSource: 'magic_weapon',
    scalingSkill: 'magic',
    skillCoefficient: COMBAT_FORMULA_CONFIG.magicScalingPerLevel,
    levelCoefficient: COMBAT_FORMULA_CONFIG.levelScalingPerLevel,
  },
  warrior: {
    basePowerSource: 'weapon',
    scalingSkill: 'melee',
    skillCoefficient: COMBAT_FORMULA_CONFIG.meleeScalingPerSkill,
    levelCoefficient: COMBAT_FORMULA_CONFIG.levelScalingPerLevel,
  },
  archer: {
    basePowerSource: 'weapon_plus_ammo',
    scalingSkill: 'distance',
    skillCoefficient: COMBAT_FORMULA_CONFIG.distanceScalingPerSkill,
    levelCoefficient: COMBAT_FORMULA_CONFIG.levelScalingPerLevel,
  },
};

export const ARCHETYPE_WEAPONS: Record<CombatArchetype, readonly WeaponType[]> = {
  mage: ['staff'],
  warrior: ['sword', 'axe', 'club'],
  archer: ['bow', 'crossbow'],
};

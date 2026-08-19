import { COMBAT_FORMULA_CONFIG } from '@aetheria/config';
import type { CharacterCombatStats, CharacterEquipment, CharacterSkills, DamageType, ItemDefinition } from '@aetheria/types';
import { DAMAGE_TYPES } from './combat-formulas';

export function emptyResistances(): Record<DamageType, number> {
  return Object.fromEntries(DAMAGE_TYPES.map((type) => [type, 0])) as Record<DamageType, number>;
}

export function aggregateCharacterCombatStats(input: {
  level: number;
  maxHp: number;
  maxMana: number;
  skills: CharacterSkills;
  equipment: CharacterEquipment;
  getItem: (itemId: string) => ItemDefinition | undefined;
}): CharacterCombatStats {
  const stats: CharacterCombatStats = {
    level: input.level,
    maxHp: input.maxHp,
    maxMana: input.maxMana,
    armor: 0,
    defense: 0,
    meleeSkill: input.skills.melee,
    distanceSkill: input.skills.distance,
    magicLevel: input.skills.magic,
    criticalChance: COMBAT_FORMULA_CONFIG.baseCriticalChance,
    criticalDamage: COMBAT_FORMULA_CONFIG.baseCriticalDamage,
    accuracy: 0,
    dodge: 0,
    resistances: emptyResistances(),
  };

  for (const stack of Object.values(input.equipment)) {
    if (!stack) continue;
    const item = input.getItem(stack.itemId);
    const combat = item?.combatStats;
    if (!item && !combat) continue;
    stats.armor += combat?.armor ?? (item?.slot === 'helmet' || item?.slot === 'armor' || item?.slot === 'legs' || item?.slot === 'boots' ? item.defense : 0);
    stats.defense += combat?.defense ?? (item?.slot !== 'helmet' && item?.slot !== 'armor' && item?.slot !== 'legs' && item?.slot !== 'boots' ? item?.defense ?? 0 : 0);
    stats.maxHp += combat?.maxHp ?? 0;
    stats.maxMana += combat?.maxMana ?? 0;
    stats.criticalChance += combat?.criticalChance ?? 0;
    stats.criticalDamage += combat?.criticalDamage ?? 0;
    stats.accuracy += combat?.accuracy ?? 0;
    stats.dodge += combat?.dodge ?? 0;
    stats.meleeSkill += combat?.skillBonuses?.melee ?? 0;
    stats.distanceSkill += combat?.skillBonuses?.distance ?? 0;
    stats.magicLevel += combat?.skillBonuses?.magic ?? 0;
    for (const type of DAMAGE_TYPES) stats.resistances[type] += combat?.resistances?.[type] ?? 0;
  }

  return stats;
}

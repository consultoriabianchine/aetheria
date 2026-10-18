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
    speed: 0,
    resistances: emptyResistances(),
    damageBonuses: emptyResistances(),
  };

  for (const stack of Object.values(input.equipment)) {
    if (!stack) continue;
    const item = input.getItem(stack.itemId);
    const combat = item?.combatStats;
    if (!item && !combat) continue;
    const quality = Math.max(0.5, Math.min(2, (stack.quality ?? 100) / 100));
    stats.armor += Math.round((combat?.armor ?? (item?.slot === 'helmet' || item?.slot === 'armor' || item?.slot === 'legs' || item?.slot === 'boots' ? item.defense : 0)) * quality);
    stats.defense += Math.round((combat?.defense ?? (item?.slot !== 'helmet' && item?.slot !== 'armor' && item?.slot !== 'legs' && item?.slot !== 'boots' ? item?.defense ?? 0 : 0)) * quality);
    stats.maxHp += Math.round((combat?.maxHp ?? 0) * quality);
    stats.maxMana += Math.round((combat?.maxMana ?? 0) * quality);
    stats.criticalChance += (combat?.criticalChance ?? 0) * quality;
    stats.criticalDamage += (combat?.criticalDamage ?? 0) * quality;
    stats.accuracy += (combat?.accuracy ?? 0) * quality;
    stats.dodge += (combat?.dodge ?? 0) * quality;
    stats.speed += (combat?.speed ?? 0) * quality;
    stats.meleeSkill += Math.round((combat?.skillBonuses?.melee ?? 0) * quality);
    stats.distanceSkill += Math.round((combat?.skillBonuses?.distance ?? 0) * quality);
    stats.magicLevel += Math.round((combat?.skillBonuses?.magic ?? 0) * quality);
    for (const type of DAMAGE_TYPES) stats.resistances[type] += (combat?.resistances?.[type] ?? 0) * quality;
    for (const type of DAMAGE_TYPES) stats.damageBonuses[type] += (combat?.damageBonus?.[type] ?? 0) * quality;
  }

  return stats;
}

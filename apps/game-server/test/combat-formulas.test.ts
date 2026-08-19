import { describe, expect, it } from 'vitest';
import type { CharacterCombatStats, CharacterEquipment, CharacterSkills } from '@aetheria/types';
import {
  applyResistanceMitigation,
  calculateMagicMultiplier,
  calculateMeleeMultiplier,
  calculatePhysicalMitigation,
  calculateRawDamage,
} from '../src/game/combat/combat-formulas';
import { calculateBasicAttack } from '../src/game/combat/basic-attack-calculator';
import { aggregateCharacterCombatStats, emptyResistances } from '../src/game/combat/character-stat-aggregator';
import { calculateCritical } from '../src/game/combat/combat-formulas';
import { skillXpRequired, trainCombatSkill } from '../src/game/skills/skill-progression';

const baseStats: CharacterCombatStats = {
  level: 100,
  maxHp: 1000,
  maxMana: 500,
  armor: 0,
  defense: 0,
  meleeSkill: 80,
  distanceSkill: 80,
  magicLevel: 50,
  criticalChance: 0,
  criticalDamage: 1.5,
  accuracy: 0,
  dodge: 0,
  resistances: emptyResistances(),
};

describe('combat formulas', () => {
  it('calcula o raw médio do basic mage', () => {
    const raw = calculateRawDamage({ basePower: 30, skill: 'magic', skillLevel: 50, level: 100 });
    expect(raw).toBe(78.75);
    expect(calculateMagicMultiplier(50)).toBe(1.75);
  });

  it('calcula o raw médio do basic warrior', () => {
    const raw = calculateRawDamage({ basePower: 40, skill: 'melee', skillLevel: 80, level: 100 });
    expect(raw).toBe(108);
    expect(calculateMeleeMultiplier(80)).toBe(1.8);
  });

  it('calcula o raw médio do basic archer', () => {
    const raw = calculateRawDamage({ basePower: 30, skill: 'distance', skillLevel: 80, level: 100 });
    expect(raw).toBe(81);
  });

  it('aplica mitigation física com diminishing returns', () => {
    expect(calculatePhysicalMitigation(500, 100)).toBeCloseTo(0.3125);
  });

  it('aplica resistance positiva e negativa', () => {
    expect(applyResistanceMitigation(200, 0.25)).toBe(150);
    expect(applyResistanceMitigation(200, -0.2)).toBe(240);
  });

  it('aplica crítico', () => {
    expect(calculateCritical(100, 1.5)).toBe(150);
  });

  it('valida basic archer sem ammo e ammo errada', () => {
    const weapon = { itemId: 'bow', weaponType: 'bow' as const, attackPower: 18, range: 6, allowedAmmoType: 'arrow' as const };
    expect(calculateBasicAttack({ archetype: 'archer', attacker: baseStats, loadout: { weapon }, rng: () => 0.5 }).valid).toBe(false);
    const wrongAmmo = { itemId: 'bolt', ammoType: 'bolt' as const, attackPower: 12 };
    expect(calculateBasicAttack({ archetype: 'archer', attacker: baseStats, loadout: { weapon, ammo: wrongAmmo }, rng: () => 0.5 }).reason).toBe('INVALID_AMMO');
  });

  it('valida mage com arma errada', () => {
    const weapon = { itemId: 'sword', weaponType: 'sword' as const, attackPower: 40, range: 1 };
    expect(calculateBasicAttack({ archetype: 'mage', attacker: baseStats, loadout: { weapon }, rng: () => 0.5 }).reason).toBe('INVALID_MAGE_WEAPON');
  });

  it('agrega armor de equipamentos', () => {
    const equipment: CharacterEquipment = {
      helmet: { itemId: 'helmet', quantity: 1 },
      armor: { itemId: 'armor', quantity: 1 },
      legs: { itemId: 'legs', quantity: 1 },
      boots: { itemId: 'boots', quantity: 1 },
    };
    const skills: CharacterSkills = { melee: 10, distance: 10, magic: 10 };
    const stats = aggregateCharacterCombatStats({
      level: 1,
      maxHp: 100,
      maxMana: 50,
      skills,
      equipment,
      getItem: (itemId) => ({
        id: itemId,
        name: itemId,
        type: itemId === 'helmet' ? 'helmet' : itemId === 'boots' ? 'boots' : itemId === 'legs' ? 'legs' : 'armor',
        weight: 0,
        stackable: false,
        attack: 0,
        defense: itemId === 'helmet' ? 20 : itemId === 'armor' ? 50 : itemId === 'legs' ? 30 : 10,
        image: '',
        category: '',
        slot: itemId as keyof CharacterEquipment,
      }),
    });
    expect(stats.armor).toBe(110);
  });

  it('calcula XP de skill e suporta múltiplos level-ups', () => {
    expect(skillXpRequired('melee', 10)).toBe(2600);
    const current: CharacterSkills = { melee: 10, distance: 10, magic: 10 };
    const result = trainCombatSkill(current, [], 'melee', skillXpRequired('melee', 10) + skillXpRequired('melee', 11));
    expect(result.skills.melee).toBe(12);
    expect(result.events).toHaveLength(2);
  });
});

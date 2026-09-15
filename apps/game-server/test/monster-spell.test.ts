import { describe, expect, it } from 'vitest';
import { randomIntInRange, mulberry32 } from '@aetheria/shared';
import { calculateMitigatedDamage } from '../src/game/combat/damage-calculator';
import { emptyResistances } from '../src/game/combat/character-stat-aggregator';
import type { CharacterCombatStats } from '@aetheria/types';

function targetStats(overrides: Partial<CharacterCombatStats> = {}): CharacterCombatStats {
  return {
    level: 1,
    maxHp: 100,
    maxMana: 50,
    armor: 0,
    defense: 0,
    meleeSkill: 10,
    distanceSkill: 10,
    magicLevel: 10,
    criticalChance: 0,
    criticalDamage: 1.5,
    accuracy: 0,
    dodge: 0,
    speed: 0,
    resistances: emptyResistances(),
    ...overrides,
  };
}

describe('randomIntInRange (dano base de magia de criatura)', () => {
  it('respeita os limites min/max com rng determinístico', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const value = randomIntInRange(40, 90, rng);
      expect(value).toBeGreaterThanOrEqual(40);
      expect(value).toBeLessThanOrEqual(90);
    }
  });

  it('normaliza min/max invertidos e retorna inteiros', () => {
    expect(Number.isInteger(randomIntInRange(90, 40, () => 0))).toBe(true);
    expect(randomIntInRange(90, 40, () => 0)).toBeGreaterThanOrEqual(40);
    expect(randomIntInRange(90, 40, () => 1)).toBeLessThanOrEqual(90);
  });

  it('cobre o intervalo completo nos extremos do rng', () => {
    expect(randomIntInRange(40, 90, () => 0)).toBe(40);
    expect(randomIntInRange(40, 90, () => 1)).toBe(90);
  });
});

describe('dano elemental de magia de criatura', () => {
  it('aplica resistência elemental do player ao dano de fogo', () => {
    const withResistance = targetStats({ resistances: { ...emptyResistances(), fire: 0.5 } });
    const result = calculateMitigatedDamage({ damage: 100, damageType: 'fire', target: withResistance });
    expect(result.finalDamage).toBe(50);
  });

  it('mantém dano físico mitigado por armor+defense', () => {
    const armored = targetStats({ armor: 40, defense: 10 });
    const result = calculateMitigatedDamage({ damage: 100, damageType: 'physical', target: armored });
    expect(result.finalDamage).toBeLessThan(100);
  });
});

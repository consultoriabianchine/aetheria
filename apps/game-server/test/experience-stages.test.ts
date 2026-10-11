import { describe, expect, it } from 'vitest';
import { experienceMultiplierForLevel, scaledExperienceForLevel, skillExperienceMultiplierForLevel } from '@aetheria/config';

describe('experience stages', () => {
  it.each([
    [1, 50],
    [50, 50],
    [51, 25],
    [100, 25],
    [101, 10],
    [150, 10],
    [151, 5],
    [200, 5],
    [201, 3],
    [300, 3],
    [301, 2],
    [999, 2],
  ])('retorna %sx para o nível %s', (level, multiplier) => {
    expect(experienceMultiplierForLevel(level)).toBe(multiplier);
  });

  it('aplica o estágio individualmente ao valor recebido', () => {
    expect(scaledExperienceForLevel(10, 1)).toBe(500);
    expect(scaledExperienceForLevel(10, 51)).toBe(250);
    expect(scaledExperienceForLevel(10, 301)).toBe(20);
  });

  it('não produz XP negativa', () => {
    expect(scaledExperienceForLevel(-10, 1)).toBe(0);
  });

  it.each([
    ['melee', 1, 10],
    ['melee', 50, 10],
    ['melee', 51, 5],
    ['melee', 101, 3],
    ['melee', 151, 2],
    ['melee', 201, 1],
    ['distance', 50, 10],
    ['distance', 100, 5],
    ['distance', 150, 3],
    ['distance', 200, 2],
    ['distance', 201, 1],
    ['magic', 1, 8],
    ['magic', 50, 8],
    ['magic', 51, 4],
    ['magic', 101, 2],
    ['magic', 151, 1],
  ] as const)('retorna o estágio de skill correto para %s nível %s', (skill, level, multiplier) => {
    expect(skillExperienceMultiplierForLevel(skill, level)).toBe(multiplier);
  });
});

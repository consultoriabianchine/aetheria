import { describe, expect, it } from 'vitest';
import { experienceMultiplierForLevel, scaledExperienceForLevel } from '@aetheria/config';

describe('experience stages', () => {
  it.each([
    [1, 100],
    [50, 100],
    [51, 50],
    [100, 50],
    [101, 20],
    [150, 20],
    [151, 10],
    [200, 10],
    [201, 5],
    [300, 5],
    [301, 2],
    [999, 2],
  ])('retorna %sx para o nível %s', (level, multiplier) => {
    expect(experienceMultiplierForLevel(level)).toBe(multiplier);
  });

  it('aplica o estágio individualmente ao valor recebido', () => {
    expect(scaledExperienceForLevel(10, 1)).toBe(1000);
    expect(scaledExperienceForLevel(10, 51)).toBe(500);
    expect(scaledExperienceForLevel(10, 301)).toBe(20);
  });

  it('não produz XP negativa', () => {
    expect(scaledExperienceForLevel(-10, 1)).toBe(0);
  });
});

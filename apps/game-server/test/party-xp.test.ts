import { describe, expect, it } from 'vitest';
import { splitPartyExperience } from '../src/game/combat/party-xp';

describe('splitPartyExperience', () => {
  it('retorna XP integral para um único membro', () => {
    expect(splitPartyExperience(100, 1)).toBe(100);
  });

  it('divide com bônus de grupo para dois membros', () => {
    expect(splitPartyExperience(100, 2)).toBe(Math.round((100 * 1.1) / 2));
  });

  it('divide com bônus de grupo para três membros', () => {
    expect(splitPartyExperience(100, 3)).toBe(Math.round((100 * 1.2) / 3));
  });

  it('trata contagem zero ou negativa como um membro', () => {
    expect(splitPartyExperience(100, 0)).toBe(100);
    expect(splitPartyExperience(100, -1)).toBe(100);
  });

  it('retorna zero para XP não positivo', () => {
    expect(splitPartyExperience(0, 3)).toBe(0);
    expect(splitPartyExperience(-5, 3)).toBe(0);
  });

  it('garante pelo menos 1 XP para criatura com XP baixo', () => {
    expect(splitPartyExperience(1, 3)).toBe(1);
  });
});

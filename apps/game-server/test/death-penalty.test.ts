import { describe, expect, it } from 'vitest';
import { applyDeathExperiencePenalty } from '../src/game/engine/death-penalty';

describe('applyDeathExperiencePenalty', () => {
  it('remove 25% da progressão sem perder nível quando há XP suficiente', () => {
    const result = applyDeathExperiencePenalty(10, 1000);

    expect(result.level).toBe(9);
    expect(result.experience).toBe(1325);
    expect(result.lostLevels).toBe(1);
  });

  it('desce de nível e mantém a barra coerente', () => {
    const result = applyDeathExperiencePenalty(2, 1);

    expect(result.level).toBe(1);
    expect(result.experience).toBe(76);
    expect(result.lostLevels).toBe(1);
  });

  it('nunca reduz abaixo do nível 1', () => {
    const result = applyDeathExperiencePenalty(1, 0);

    expect(result.level).toBe(1);
    expect(result.experience).toBe(0);
  });
});

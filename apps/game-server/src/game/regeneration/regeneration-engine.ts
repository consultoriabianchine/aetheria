import { VOCATIONS } from '@aetheria/config';
import type { VocationId } from '@aetheria/types';

export interface RegenerationInput {
  vocationId: VocationId;
  promoted: boolean;
  currentHp: number;
  currentMana: number;
  maxHp: number;
  maxMana: number;
}

export interface RegenerationResult {
  hpRecovered: number;
  manaRecovered: number;
  finalHp: number;
  finalMana: number;
}

/**
 * Regeneração baseada em tempo decorrido (elapsed × rate).
 * Reutilizável online e offline — não depende de timers por personagem.
 */
export function calculateRegeneration(elapsedSeconds: number, input: RegenerationInput): RegenerationResult {
  const vocation = VOCATIONS[input.vocationId];
  const multiplier = input.promoted ? 1.5 : 1;
  const hpRecovered = Math.floor(elapsedSeconds * vocation.regeneration.hpPerSecond * multiplier);
  const manaRecovered = Math.floor(elapsedSeconds * vocation.regeneration.manaPerSecond * multiplier);
  return {
    hpRecovered,
    manaRecovered,
    finalHp: Math.min(input.maxHp, input.currentHp + hpRecovered),
    finalMana: Math.min(input.maxMana, input.currentMana + manaRecovered),
  };
}
import { ARCHETYPES } from '@aetheria/config';
import type { CombatArchetype } from '@aetheria/types';

export interface RegenerationInput {
  archetype: CombatArchetype;
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
  const archetype = ARCHETYPES[input.archetype];
  const hpRecovered = Math.floor(elapsedSeconds * archetype.regeneration.hpPerSecond);
  const manaRecovered = Math.floor(elapsedSeconds * archetype.regeneration.manaPerSecond);
  return {
    hpRecovered,
    manaRecovered,
    finalHp: Math.min(input.maxHp, input.currentHp + hpRecovered),
    finalMana: Math.min(input.maxMana, input.currentMana + manaRecovered),
  };
}

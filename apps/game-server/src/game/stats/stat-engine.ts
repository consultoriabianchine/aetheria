import { ARCHETYPES, GAME_CONFIG } from '@aetheria/config';
import type { ArchetypeDefinition, CombatArchetype } from '@aetheria/types';

export interface CharacterCoreStats {
  maxHp: number;
  maxMana: number;
  hpRegeneration: number;
  manaRegeneration: number;
}

/** MaxHP = baseHp + (hpPerLevel × level). */
export function calculateMaxHp(level: number, archetype: ArchetypeDefinition): number {
  return GAME_CONFIG.baseHp + archetype.hpPerLevel * level;
}

/** MaxMana = baseMana + (manaPerLevel × level). */
export function calculateMaxMana(level: number, archetype: ArchetypeDefinition): number {
  return GAME_CONFIG.baseMana + archetype.manaPerLevel * level;
}

/** Compõe os atributos derivados do personagem. */
export function computeCoreStats(
  level: number,
  archetypeId: CombatArchetype,
): CharacterCoreStats {
  const archetype = ARCHETYPES[archetypeId];
  return {
    maxHp: calculateMaxHp(level, archetype),
    maxMana: calculateMaxMana(level, archetype),
    hpRegeneration: archetype.regeneration.hpPerSecond,
    manaRegeneration: archetype.regeneration.manaPerSecond,
  };
}

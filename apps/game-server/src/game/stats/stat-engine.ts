import { GAME_CONFIG, VOCATIONS } from '@aetheria/config';
import type { VocationDefinition, VocationId } from '@aetheria/types';

export interface CharacterCoreStats {
  maxHp: number;
  maxMana: number;
  damageReduction: number;
  hpRegeneration: number;
  manaRegeneration: number;
  regenerationMultiplier: number;
}

/** MaxHP = baseHp + (hpPerLevel × level). */
export function calculateMaxHp(level: number, vocation: VocationDefinition): number {
  return GAME_CONFIG.baseHp + vocation.hpPerLevel * level;
}

/** MaxMana = baseMana + (manaPerLevel × level). */
export function calculateMaxMana(level: number, vocation: VocationDefinition): number {
  return GAME_CONFIG.baseMana + vocation.manaPerLevel * level;
}

/** Redução de dano da vocação como multiplicador (1 = sem redução). */
export function damageReductionMultiplier(vocation: VocationDefinition): number {
  return 1 - vocation.damageReduction;
}

/** Aplica a redução de dano da vocação, garantindo mínimo 1 de dano. */
export function applyVocationDamageReduction(rawDamage: number, vocation: VocationDefinition): number {
  return Math.max(1, Math.round(rawDamage * damageReductionMultiplier(vocation)));
}

/** Calcula o multiplicador de regeneração (promovido = 1.5×). */
export function regenerationMultiplier(promoted: boolean): number {
  return promoted ? GAME_CONFIG.promotion.regenerationMultiplier : 1;
}

/** Compõe os atributos derivados do personagem. */
export function computeCoreStats(
  level: number,
  vocationId: VocationId,
  promoted: boolean,
): CharacterCoreStats {
  const vocation = VOCATIONS[vocationId];
  const multiplier = regenerationMultiplier(promoted);
  return {
    maxHp: calculateMaxHp(level, vocation),
    maxMana: calculateMaxMana(level, vocation),
    damageReduction: vocation.damageReduction,
    hpRegeneration: vocation.regeneration.hpPerSecond * multiplier,
    manaRegeneration: vocation.regeneration.manaPerSecond * multiplier,
    regenerationMultiplier: multiplier,
  };
}
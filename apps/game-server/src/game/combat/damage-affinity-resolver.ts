import { COMBAT_FORMULA_CONFIG } from '@aetheria/config';
import type { DamageAffinities, DamageType } from '@aetheria/types';

export interface ResolvedDamageAffinity {
  modifier: number;
  immune: boolean;
}

export function resolveDamageAffinity(affinities: DamageAffinities | undefined, damageType: DamageType): ResolvedDamageAffinity {
  const affinity = affinities?.[damageType];
  return {
    modifier: Math.max(COMBAT_FORMULA_CONFIG.minDamageTakenModifier, Math.min(COMBAT_FORMULA_CONFIG.maxDamageTakenModifier, affinity?.modifier ?? 0)),
    immune: affinity?.immune ?? false,
  };
}

export function getDamageTakenMultiplier(affinities: DamageAffinities | undefined, damageType: DamageType): number {
  const affinity = resolveDamageAffinity(affinities, damageType);
  return affinity.immune ? 0 : 1 + affinity.modifier;
}

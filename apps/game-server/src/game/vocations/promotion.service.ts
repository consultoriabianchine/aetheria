import { GAME_CONFIG } from '@aetheria/config';
import type { StoredCharacter } from '../store/store';

export type PromotionError =
  | 'CHARACTER_NOT_FOUND'
  | 'CHARACTER_NOT_OWNED'
  | 'PROMOTION_LEVEL_REQUIRED'
  | 'PROMOTION_NOT_ENOUGH_GOLD'
  | 'ALREADY_PROMOTED';

export interface PromotionResult {
  ok: true;
  character: StoredCharacter;
}

export type PromotionOutcome = PromotionResult | { ok: false; error: PromotionError };

/** Valida as regras de promoção (não muta o estado). */
export function validatePromotion(character: StoredCharacter | null | undefined): PromotionError | null {
  if (!character) return 'CHARACTER_NOT_FOUND';
  if (character.promoted) return 'ALREADY_PROMOTED';
  if (character.level < GAME_CONFIG.promotion.requiredLevel) return 'PROMOTION_LEVEL_REQUIRED';
  if (character.gold < GAME_CONFIG.promotion.goldCost) return 'PROMOTION_NOT_ENOUGH_GOLD';
  return null;
}

/** Aplica a promoção sobre o personagem (deduz gold, marca promoted). */
export function applyPromotion(character: StoredCharacter, now = Date.now()): StoredCharacter {
  return {
    ...character,
    gold: character.gold - GAME_CONFIG.promotion.goldCost,
    promoted: true,
    promotedAt: now,
  };
}
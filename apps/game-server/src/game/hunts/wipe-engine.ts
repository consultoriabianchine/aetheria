import { HUNT_CONFIG } from '@aetheria/config';

/**
 * Penalidade de ouro de um wipe: 500 × soma dos níveis dos membros >= 50,
 * limitada ao ouro disponível (nunca negativa). Função pura.
 */
export function calculateWipePenalty(levels: number[], availableGold: number): number {
  const sum = levels.filter((l) => l >= HUNT_CONFIG.wipe.minPenaltyLevel).reduce((acc, l) => acc + l, 0);
  const penalty = sum * HUNT_CONFIG.wipe.goldPerLevel;
  return Math.min(penalty, Math.max(0, availableGold));
}
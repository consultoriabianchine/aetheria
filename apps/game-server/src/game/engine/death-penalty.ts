import { xpForLevel } from '@aetheria/config';

export interface DeathPenaltyResult {
  level: number;
  experience: number;
  lostLevels: number;
  lostExperience: number;
}

function totalExperienceAtLevel(level: number): number {
  let total = 0;
  for (let current = 1; current < level; current++) total += xpForLevel(current);
  return total;
}

/** Remove uma fração da experiência total e reconstrói nível e barra atual. */
export function applyDeathExperiencePenalty(level: number, experience: number, fraction = 0.25): DeathPenaltyResult {
  const safeLevel = Math.max(1, Math.floor(level));
  const safeExperience = Math.max(0, Math.floor(experience));
  const totalExperience = totalExperienceAtLevel(safeLevel) + safeExperience;
  const penalty = Math.max(0, Math.floor(totalExperience * fraction));
  let remaining = Math.max(0, totalExperience - penalty);
  let nextLevel = 1;
  while (nextLevel < safeLevel && remaining >= xpForLevel(nextLevel)) {
    remaining -= xpForLevel(nextLevel);
    nextLevel++;
  }
  return {
    level: nextLevel,
    experience: remaining,
    lostLevels: safeLevel - nextLevel,
    lostExperience: penalty,
  };
}

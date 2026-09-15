import { PARTY_XP_CONFIG } from '@aetheria/config';

export function splitPartyExperience(totalExperience: number, aliveMemberCount: number): number {
  if (totalExperience <= 0) return 0;
  const count = Math.max(1, Math.floor(aliveMemberCount));
  const bonus = 1 + PARTY_XP_CONFIG.bonusPerExtraMember * (count - 1);
  return Math.max(1, Math.round((totalExperience * bonus) / count));
}

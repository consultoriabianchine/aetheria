import { VOCATIONS } from '@aetheria/config';
import type { CharacterSkills, SkillType, VocationDefinition, VocationId } from '@aetheria/types';

/** Progresso interno por skill (além do nível visível). */
export interface SkillProgress {
  skillType: SkillType;
  level: number;
  experience: number;
}

export interface SkillLevelUpEvent {
  type: 'SKILL_LEVEL_UP';
  skill: SkillType;
  oldLevel: number;
  newLevel: number;
}

export interface SkillTrainingResult {
  skills: CharacterSkills;
  progress: SkillProgress[];
  events: SkillLevelUpEvent[];
}

const MELEE_SKILLS: readonly SkillType[] = ['sword', 'axe', 'club'];

/** Curva de XP por nível de skill (configuração provisória de balanceamento). */
export function skillXpForLevel(level: number): number {
  return 100 + (level - 10) * 25;
}

function rateForSkill(vocation: VocationDefinition, skill: SkillType): number {
  if ((MELEE_SKILLS as readonly SkillType[]).includes(skill)) return vocation.trainingRates.melee;
  return vocation.trainingRates[skill as 'magic' | 'distance' | 'shielding'];
}

/**
 * Aplica um uso válido de skill, multiplica pela training rate da vocação,
 * acumula XP e dispara level-ups. Determinístico — não depende de timers.
 */
export function trainSkill(
  current: CharacterSkills,
  progress: SkillProgress[],
  skill: SkillType,
  vocationId: VocationId,
  rawXp: number,
): SkillTrainingResult {
  const vocation = VOCATIONS[vocationId];
  const nextProgress = progress.map((p) => ({ ...p }));
  const idx = nextProgress.findIndex((p) => p.skillType === skill);
  const entry: SkillProgress = idx >= 0 ? nextProgress[idx] : { skillType: skill, level: current[skill], experience: 0 };

  const skills: CharacterSkills = { ...current };
  const events: SkillLevelUpEvent[] = [];
  let gained = rawXp * rateForSkill(vocation, skill);

  while (gained > 0) {
    const need = skillXpForLevel(entry.level);
    const missing = need - entry.experience;
    if (gained < missing) {
      entry.experience += gained;
      gained = 0;
    } else {
      gained -= missing;
      const oldLevel = entry.level;
      entry.level += 1;
      entry.experience = 0;
      skills[skill] = entry.level;
      events.push({ type: 'SKILL_LEVEL_UP', skill, oldLevel, newLevel: entry.level });
    }
  }

  const result: SkillProgress[] = idx >= 0 ? nextProgress : [...nextProgress, entry];
  return { skills, progress: result, events };
}
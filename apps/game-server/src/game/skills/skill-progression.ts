import { SKILL_PROGRESSION_CONFIG } from '@aetheria/config';
import type { CharacterSkills, CombatSkill } from '@aetheria/types';

export interface SkillProgress {
  skillType: CombatSkill;
  level: number;
  experience: number;
}

export interface SkillLevelUpEvent {
  type: 'SKILL_LEVEL_UP';
  skill: CombatSkill;
  oldLevel: number;
  newLevel: number;
}

export interface SkillTrainingResult {
  skills: CharacterSkills;
  progress: SkillProgress[];
  events: SkillLevelUpEvent[];
}

export function skillXpRequired(skill: CombatSkill, level: number): number {
  const cfg = SKILL_PROGRESSION_CONFIG[skill];
  return cfg.base + cfg.quadratic * level * level;
}

export function magicTrainingGain(manaCost: number): number {
  const cfg = SKILL_PROGRESSION_CONFIG.magic;
  return Math.max(cfg.minimumGain, manaCost * cfg.manaGainMultiplier);
}

export function trainCombatSkill(
  current: CharacterSkills,
  progress: SkillProgress[],
  skill: CombatSkill,
  rawXp: number,
): SkillTrainingResult {
  const nextProgress = progress.map((p) => ({ ...p }));
  const idx = nextProgress.findIndex((p) => p.skillType === skill);
  const entry: SkillProgress = idx >= 0 ? nextProgress[idx] : { skillType: skill, level: current[skill], experience: 0 };
  const skills: CharacterSkills = { ...current };
  const events: SkillLevelUpEvent[] = [];
  let gained = Math.max(0, rawXp);

  while (gained > 0) {
    const need = skillXpRequired(skill, entry.level);
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

  if (idx < 0) nextProgress.push(entry);
  return { skills, progress: nextProgress, events };
}

import { HUNT_CONFIG } from '@aetheria/config';
import type { CreatureDefinition, HuntBossDefinition, HuntDefinition } from '@aetheria/types';

/**
 * Modelo de dificuldade do Aetheria (inspirado no Avalon Idle).
 *
 * O "combat power" de uma criatura é o produto entre HP efetivo (HP ×
 * sobrevivência da defesa) e DPS (dano por segundo, normalizado pela
 * velocidade de ataque). O score de uma Hunt pondera o pack médio das
 * 9 waves normais (80%) com o boss (20%). O nível sugerido é uma
 * calibração por raiz quadrada do score.
 */

export interface CombatPowerInput {
  maxHealth: number;
  attack: number;
  defense: number;
  attackSpeedMs: number;
}

/** Sobrevivência por defesa: cada 50 de defesa dobra o HP efetivo. */
export function survivabilityMultiplier(defense: number): number {
  return 1 + defense * 0.02;
}

export function effectiveHp(monster: CombatPowerInput): number {
  return monster.maxHealth * survivabilityMultiplier(monster.defense);
}

export function effectiveDps(monster: CombatPowerInput): number {
  const secondsPerAttack = Math.max(0.1, monster.attackSpeedMs / 1000);
  return monster.attack / secondsPerAttack;
}

export function monsterCombatPower(monster: CombatPowerInput): number {
  return effectiveHp(monster) * effectiveDps(monster);
}

/** Pack médio ao longo das waves normais, usando a fórmula oficial de tamanho. */
export function averagePackSize(basePackSize: number, maxPackSize: number, waves: number): number {
  if (waves <= 0) return 0;
  let total = 0;
  for (let wave = 1; wave <= waves; wave++) {
    total += Math.min(maxPackSize, basePackSize + Math.floor((wave - 1) / 2));
  }
  return total / waves;
}

/** Stats do boss após aplicar os multiplicadores da hunt. */
export function bossStats(base: CombatPowerInput, multipliers: { hp: number; damage: number }): CombatPowerInput {
  return {
    maxHealth: base.maxHealth * multipliers.hp,
    attack: base.attack * multipliers.damage,
    defense: base.defense,
    attackSpeedMs: base.attackSpeedMs,
  };
}

export interface HuntScoreInput {
  monsters: { stats: CombatPowerInput; weight: number }[];
  boss: CombatPowerInput;
  basePackSize: number;
  maxPackSize: number;
}

export function huntCombatScore(input: HuntScoreInput): number {
  const totalWeight = input.monsters.reduce((s, m) => s + m.weight, 0) || 1;
  const weightedMonsterPower =
    input.monsters.reduce((s, m) => s + monsterCombatPower(m.stats) * m.weight, 0) / totalWeight;
  const normalWaves = HUNT_CONFIG.waveCount - 1;
  const packPressure = averagePackSize(input.basePackSize, input.maxPackSize, normalWaves);
  const normalWaveScore = weightedMonsterPower * packPressure;
  const bossScore = monsterCombatPower(input.boss);
  return normalWaveScore * 0.8 + bossScore * 0.2;
}

/** Nível sugerido calculado a partir do score (referência para a ladder). */
export function suggestedLevelFromScore(score: number, ladderPosition: number): number {
  if (ladderPosition === 1) return 1;
  return Math.max(1, Math.round(Math.sqrt(Math.max(0, score)) / 10));
}

/** Monta o score de uma Hunt a partir do catálogo + definições de criatura. */
export function scoreCatalogHunt(
  hunt: HuntDefinition,
  getDef: (id: string) => CreatureDefinition | null,
  boss?: HuntBossDefinition,
): number {
  const monsterStats = (id: string): CombatPowerInput | null => {
    const def = getDef(id);
    if (!def) return null;
    return {
      maxHealth: def.maxHealth,
      attack: def.attack,
      defense: def.defense,
      attackSpeedMs: def.attackSpeed,
    };
  };
  const entries = hunt.monsters
    .map((m) => ({ stats: monsterStats(m.monsterId), weight: m.weight }))
    .filter((e): e is { stats: CombatPowerInput; weight: number } => e.stats !== null);
  const b = boss ?? hunt.boss;
  const baseBoss = monsterStats(b.monsterId);
  if (entries.length === 0 || !baseBoss) return 0;
  return huntCombatScore({
    monsters: entries,
    boss: bossStats(baseBoss, b.statMultipliers),
    basePackSize: hunt.basePackSize,
    maxPackSize: hunt.maxPackSize,
  });
}
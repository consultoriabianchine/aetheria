import { describe, expect, it } from 'vitest';
import { HUNT_CATALOG, HUNT_CONFIG, calculatePackSize } from '@aetheria/config';
import { mulberry32 } from '@aetheria/shared';
import type {
  CharacterEquipment,
  CharacterSkills,
  CharacterSummary,
  CreatureDefinition,
  HuntProgress,
  Position,
} from '@aetheria/types';
import type { CreatureTarget } from '../src/game/creature/creature-ai.service';
import { calculateBossStats } from '../src/game/hunts/boss-engine';
import { HuntEngine, type HuntEngineHooks } from '../src/game/hunts/hunt-engine';
import { generatePack, normalizeWeights, pickMonster } from '../src/game/hunts/pack-generator';
import { calculateWipePenalty } from '../src/game/hunts/wipe-engine';
import { GamePlayer } from '../src/game/engine/world';
import {
  averagePackSize,
  bossStats,
  huntCombatScore,
  monsterCombatPower,
  suggestedLevelFromScore,
  survivabilityMultiplier,
} from '../src/game/difficulty/combat-power';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const DEFAULT_SKILLS: CharacterSkills = { melee: 10, distance: 10, magic: 10 };

function makeDefinition(overrides: Partial<CreatureDefinition> = {}): CreatureDefinition {
  return {
    id: 'goblin',
    name: 'Goblin',
    slug: 'goblin',
    description: '',
    type: 'humanoid',
    level: 1,
    health: 40,
    maxHealth: 40,
    attack: 5,
    defense: 2,
    experience: 12,
    movementSpeed: 1,
    attackSpeed: 1200,
    attackRange: 1,
    viewRange: 5,
    chaseRange: 8,
    fleeHealthPercent: 20,
    canWander: false,
    canChase: true,
    canFlee: false,
    returnToSpawn: true,
    loot: [],
    ...overrides,
  };
}

function makePlayer(overrides: Partial<GamePlayer> = {}): GamePlayer {
  const character = {
    id: 'p1',
    accountId: 'a1',
    name: 'Tester',
    archetype: 'warrior' as const,
    gold: 1000,
    level: 1,
    experience: 0,
    health: 100,
    maxHealth: 100,
    mana: 50,
    maxMana: 50,
    position: { x: 0, y: 0, z: 0 } as Position,
    skills: { ...DEFAULT_SKILLS },
    skillProgress: Object.keys(DEFAULT_SKILLS).map((skillType) => ({
      skillType: skillType as keyof CharacterSkills,
      level: DEFAULT_SKILLS[skillType as keyof CharacterSkills],
      experience: 0,
    })),
    inventory: [],
    equipment: {} as CharacterEquipment,
  };
  const player = new GamePlayer(character);
  player.socketId = 'sock-p1';
  return Object.assign(player, overrides) as GamePlayer;
}

const goblinHunt = HUNT_CATALOG.find((h) => h.id === 'goblin_warren');
if (!goblinHunt) throw new Error('goblin_warren ausente do catálogo');

function makeHuntEngine(): {
  engine: HuntEngine;
  player: GamePlayer;
  emits: { socketId: string; event: string; data: unknown }[];
  finished: { characterId: string; reason: string }[];
  completed: { characterId: string; huntId: string }[];
  completions: { characterId: string; huntId: string; clearTimeMs: number }[];
} {
  const player = makePlayer();
  const emits: { socketId: string; event: string; data: unknown }[] = [];
  const finished: { characterId: string; reason: string }[] = [];
  const completed: { characterId: string; huntId: string }[] = [];
  const completions: { characterId: string; huntId: string; clearTimeMs: number }[] = [];

  const summarize = (p: GamePlayer): CharacterSummary => ({
    id: p.id,
    accountId: p.accountId,
    name: p.name,
    archetype: p.archetype,
    gold: p.gold,
    level: p.level,
    experience: p.experience,
    health: p.health,
    maxHealth: p.maxHealth,
    mana: p.mana,
    maxMana: p.maxMana,
    position: { ...p.position },
    skills: { ...p.skills },
  });

  const snapshot = (p: GamePlayer | null): CreatureTarget | null =>
    p
      ? { id: p.id, position: p.position, socketId: p.socketId, health: p.health, defense: p.defenseBase }
      : null;

  const hooks: HuntEngineHooks = {
    getPlayer: (id) => (id === player.id ? player : null),
    playerSnapshot: (id) => snapshot(id === player.id ? player : null),
    summarize,
    getCreatureDefinition: (id) => (id === 'goblin' ? makeDefinition() : null),
    getMap: () => null,
    getHunts: () => HUNT_CATALOG,
    emitTo: (socketId, event, data) => emits.push({ socketId, event, data }),
    onCreatureAttackPlayer: () => undefined,
    onRunFinished: (characterId, reason) => finished.push({ characterId, reason }),
    onHuntCompleted: (characterId, huntId) => completed.push({ characterId, huntId }),
    recordCompletion: (characterId, huntId, clearTimeMs) => {
      completions.push({ characterId, huntId, clearTimeMs });
      const progress: HuntProgress = {
        huntId,
        completionCount: 1,
        firstClearAt: null,
        firstClearTimeMs: clearTimeMs,
        bestClearTimeMs: clearTimeMs,
        bestClearAt: null,
      };
      return Promise.resolve(progress);
    },
    getProgress: async () => new Map(),
  };

  return { engine: new HuntEngine(hooks), player, emits, finished, completed, completions };
}

function clearWaveCreatures(runCreatures: { removeCreature(id: string): boolean; getAll(): Iterable<{ id: string }> }) {
  for (const c of [...runCreatures.getAll()]) runCreatures.removeCreature(c.id);
}

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// pack generator
// ---------------------------------------------------------------------------

describe('pack-generator', () => {
  it('segue a fórmula oficial de tamanho de pack', () => {
    const sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((w) => calculatePackSize(4, 9, w));
    expect(sizes).toEqual([4, 4, 5, 5, 6, 6, 7, 7, 8]);
    expect(calculatePackSize(4, 9, 10)).toBe(8);
    expect(calculatePackSize(1, 4, 1)).toBe(1);
    expect(calculatePackSize(4, 9, 50)).toBe(9);
  });

  it('normaliza pesos para soma 1', () => {
    const norm = normalizeWeights([
      { monsterId: 'a', weight: 1 },
      { monsterId: 'b', weight: 3 },
    ]);
    expect(norm.reduce((s, e) => s + e.weight, 0)).toBeCloseTo(1);
    expect(norm[0].weight).toBeCloseTo(0.25);
    expect(norm[1].weight).toBeCloseTo(0.75);
  });

  it('peso zero não quebra a seleção', () => {
    const norm = normalizeWeights([
      { monsterId: 'a', weight: 0 },
      { monsterId: 'b', weight: 0 },
    ]);
    expect(norm.every((e) => e.weight === 0)).toBe(true);
  });

  it('pickMonster respeita o RNG injetável', () => {
    const entries = [
      { monsterId: 'a', weight: 1 },
      { monsterId: 'b', weight: 3 },
    ];
    expect(pickMonster(entries, { next: () => 0.1 })).toBe('a');
    expect(pickMonster(entries, { next: () => 0.9 })).toBe('b');
  });

  it('generatePack é determinístico para a mesma seed', () => {
    const rngA = { next: mulberry32(42) };
    const rngB = { next: mulberry32(42) };
    const a = generatePack(goblinHunt, 3, rngA);
    const b = generatePack(goblinHunt, 3, rngB);
    expect(a.monsterIds).toEqual(b.monsterIds);
    expect(a.monsterIds.length).toBe(calculatePackSize(goblinHunt.basePackSize, goblinHunt.maxPackSize, 3));
    expect(a.monsterIds.every((id) => id === 'goblin')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// boss engine
// ---------------------------------------------------------------------------

describe('boss-engine', () => {
  it('aplica multiplicadores de HP, dano e XP (arredondados)', () => {
    const stats = calculateBossStats(makeDefinition(), { hp: 3, damage: 1.5, xp: 2.5 });
    expect(stats.maxHealth).toBe(120);
    expect(stats.attack).toBe(8);
    expect(stats.experience).toBe(30);
  });

  it('multiplicadores 1 mantêm as stats base', () => {
    const stats = calculateBossStats(makeDefinition(), { hp: 1, damage: 1, xp: 1 });
    expect(stats.maxHealth).toBe(40);
    expect(stats.attack).toBe(5);
    expect(stats.experience).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// wipe engine
// ---------------------------------------------------------------------------

describe('wipe-engine', () => {
  it('sem níveis >= 50 não há penalidade', () => {
    expect(calculateWipePenalty([10, 20, 49], 100_000)).toBe(0);
  });

  it('penaliza 500 por nível >= 50', () => {
    expect(calculateWipePenalty([50, 60], 1_000_000)).toBe(55_000);
  });

  it('nunca passa do ouro disponível', () => {
    expect(calculateWipePenalty([50, 60], 10_000)).toBe(10_000);
    expect(calculateWipePenalty([50, 60], 0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// difficulty model
// ---------------------------------------------------------------------------

describe('difficulty', () => {
  it('sobrevivência cresce com a defesa', () => {
    expect(survivabilityMultiplier(0)).toBe(1);
    expect(survivabilityMultiplier(50)).toBe(2);
  });

  it('combat power é HP efetivo × DPS', () => {
    const power = monsterCombatPower({ maxHealth: 40, attack: 5, defense: 2, attackSpeedMs: 1200 });
    expect(power).toBeCloseTo(40 * 1.04 * (5 / 1.2), 5);
  });

  it('pack médio segue a fórmula', () => {
    expect(averagePackSize(4, 9, 9)).toBeCloseTo(52 / 9, 5);
    expect(averagePackSize(1, 4, 9)).toBeGreaterThan(1);
  });

  it('boss com multiplicadores tem power maior que o monstro base', () => {
    const base = { maxHealth: 100, attack: 10, defense: 5, attackSpeedMs: 1000 };
    const b = bossStats(base, { hp: 3, damage: 1.5 });
    expect(monsterCombatPower(b)).toBeGreaterThan(monsterCombatPower(base));
  });

  it('score é positivo e maior para adversários mais fortes', () => {
    const weak = huntCombatScore({
      monsters: [{ stats: { maxHealth: 40, attack: 5, defense: 2, attackSpeedMs: 1200 }, weight: 1 }],
      boss: bossStats({ maxHealth: 40, attack: 5, defense: 2, attackSpeedMs: 1200 }, { hp: 3, damage: 1.5 }),
      basePackSize: 4,
      maxPackSize: 9,
    });
    const strong = huntCombatScore({
      monsters: [{ stats: { maxHealth: 200, attack: 20, defense: 10, attackSpeedMs: 1500 }, weight: 1 }],
      boss: bossStats({ maxHealth: 200, attack: 20, defense: 10, attackSpeedMs: 1500 }, { hp: 3, damage: 1.5 }),
      basePackSize: 4,
      maxPackSize: 9,
    });
    expect(weak).toBeGreaterThan(0);
    expect(strong).toBeGreaterThan(weak);
  });

  it('nível sugerido cresce com o score e posição 1 é sempre 1', () => {
    expect(suggestedLevelFromScore(0, 1)).toBe(1);
    expect(suggestedLevelFromScore(10_000, 2)).toBeGreaterThan(suggestedLevelFromScore(1_000, 2));
  });
});

// ---------------------------------------------------------------------------
// hunt engine
// ---------------------------------------------------------------------------

describe('hunt-engine', () => {
  it('startHunt cria run, entra na arena e inicia a wave 1', () => {
    const { engine, player, emits } = makeHuntEngine();
    const result = engine.startHunt(player.id, 'goblin_warren', false, 0);
    expect(result.ok).toBe(true);
    const run = engine.getRun(player.id)!;
    expect(run.wave).toBe(1);
    expect(run.waveState).toBe('combat');
    expect(run.isBossWave).toBe(false);
    expect(run.creatures.size).toBe(calculatePackSize(goblinHunt.basePackSize, goblinHunt.maxPackSize, 1));
    const events = emits.map((e) => e.event);
    expect(events).toContain('game.enterArena');
    expect(events).toContain('hunt.started');
    expect(events).toContain('creature.spawn');
    expect(run.map.width).toBeGreaterThan(0);
    expect(run.map.height).toBeGreaterThan(0);
    expect(run.map.tiles.some((t) => t.walkable)).toBe(true);
    expect(run.map.tiles.some((t) => !t.walkable)).toBe(true);
  });

  it('rejeita hunt inexistente ou personagem já em hunt', () => {
    const { engine, player } = makeHuntEngine();
    expect(engine.startHunt(player.id, 'hunt_inexistente', false, 10)).toEqual({ ok: false, error: 'HUNT_NOT_FOUND' });
    engine.startHunt(player.id, 'goblin_warren', false, 0);
    expect(engine.startHunt(player.id, 'goblin_warren', false, 10)).toEqual({
      ok: false,
      error: 'CHARACTER_ALREADY_IN_HUNT',
    });
  });

  it('progressa waves após limpar os monstros (transição com delay)', () => {
    const { engine, player, emits } = makeHuntEngine();
    engine.startHunt(player.id, 'goblin_warren', false, 0);
    const run = engine.getRun(player.id)!;

    clearWaveCreatures(run.creatures);
    engine.update(1_000);
    expect(run.waveState).toBe('transitioning');
    expect(run.transitionAt).toBe(1_000 + HUNT_CONFIG.waveTransitionMs);

    engine.update(run.transitionAt! + 1);
    expect(run.wave).toBe(2);
    expect(run.waveState).toBe('combat');
    expect(run.creatures.size).toBe(calculatePackSize(goblinHunt.basePackSize, goblinHunt.maxPackSize, 2));
    expect(emits.some((e) => e.event === 'hunt.cleared')).toBe(true);
  });

  it('boss aparece na wave 10 e a conclusão encerra a run sem loop', async () => {
    const { engine, player, emits, finished, completed, completions } = makeHuntEngine();
    engine.startHunt(player.id, 'goblin_warren', false, 0);
    let run = engine.getRun(player.id)!;

    for (let wave = 1; wave <= 9; wave++) {
      run = engine.getRun(player.id)!;
      expect(run.wave).toBe(wave);
      clearWaveCreatures(run.creatures);
      engine.update(wave * 10_000);
      run = engine.getRun(player.id)!;
      engine.update((run.transitionAt ?? wave * 10_000) + 1);
    }

    run = engine.getRun(player.id)!;
    expect(run.wave).toBe(10);
    expect(run.isBossWave).toBe(true);
    expect(run.bossCreatureId).not.toBeNull();
    const boss = run.creatures.getCreature(run.bossCreatureId!);
    expect(boss?.name).toBe(goblinHunt.boss.name);
    expect(boss?.maxHealth).toBe(Math.round(40 * goblinHunt.boss.statMultipliers.hp));

    clearWaveCreatures(run.creatures);
    engine.update(100_000);
    await flush();

    expect(completed).toEqual([{ characterId: player.id, huntId: 'goblin_warren' }]);
    expect(completions.length).toBe(1);
    expect(emits.some((e) => e.event === 'hunt.completed')).toBe(true);
    expect(finished).toEqual([{ characterId: player.id, reason: 'completed' }]);
    expect(engine.getRun(player.id)!.status).toBe('returning_to_city');
  });

  it('com loop, o clear reinicia na wave 1 automaticamente', async () => {
    const { engine, player, emits, finished } = makeHuntEngine();
    engine.startHunt(player.id, 'goblin_warren', true, 0);
    let run = engine.getRun(player.id)!;

    for (let wave = 1; wave <= 10; wave++) {
      run = engine.getRun(player.id)!;
      clearWaveCreatures(run.creatures);
      engine.update(wave * 10_000);
      run = engine.getRun(player.id)!;
      engine.update((run.transitionAt ?? wave * 10_000) + 1);
    }
    await flush();

    run = engine.getRun(player.id)!;
    expect(run.status).toBe('active');
    expect(run.wave).toBe(1);
    expect(run.isBossWave).toBe(false);
    expect(finished).toEqual([]);
    expect(emits.filter((e) => e.event === 'hunt.completed').length).toBe(1);
  });

  it('wipe aplica penalidade, limpa a arena e (com loop) respawna', () => {
    const { engine, player, emits } = makeHuntEngine();
    engine.startHunt(player.id, 'goblin_warren', true, 0);
    const run = engine.getRun(player.id)!;
    const goldBefore = player.gold;

    engine.onPlayerDied(player.id, 5_000);
    const wiped = emits.filter((e) => e.event === 'hunt.wiped');
    expect(wiped.length).toBe(1);
    expect(run.status).toBe('wiped');
    expect(run.creatures.size).toBe(0);
    expect(player.gold).toBe(goldBefore); // nível baixo → sem penalidade
    expect(run.respawnAt).toBe(5_000 + HUNT_CONFIG.wipe.respawnMs);

    engine.update(run.respawnAt! + 1);
    expect(run.status).toBe('active');
    expect(run.wave).toBe(1);
    expect(run.isBossWave).toBe(false);
  });

  it('wipe sem loop retorna à cidade', () => {
    const { engine, player, finished } = makeHuntEngine();
    engine.startHunt(player.id, 'goblin_warren', false, 0);
    engine.onPlayerDied(player.id, 5_000);
    expect(finished).toEqual([{ characterId: player.id, reason: 'wiped' }]);
    expect(engine.getRun(player.id)!.status).toBe('returning_to_city');
  });

  it('stopHunt finaliza com motivo stopped', () => {
    const { engine, player, finished } = makeHuntEngine();
    engine.startHunt(player.id, 'goblin_warren', false, 0);
    expect(engine.stopHunt(player.id)).toBe(true);
    expect(finished).toEqual([{ characterId: player.id, reason: 'stopped' }]);
    expect(engine.stopHunt(player.id)).toBe(false);
  });

  it('removeRun limpa a run sem penalidade', () => {
    const { engine, player } = makeHuntEngine();
    engine.startHunt(player.id, 'goblin_warren', false, 0);
    engine.removeRun(player.id);
    expect(engine.getRun(player.id)).toBeNull();
  });

  it('listHunts retorna o catálogo ordenado por posição na ladder', () => {
    const { engine } = makeHuntEngine();
    const hunts = engine.listHunts();
    expect(hunts.length).toBe(HUNT_CATALOG.length);
    for (let i = 1; i < hunts.length; i++) {
      expect(hunts[i].ladderPosition).toBeGreaterThan(hunts[i - 1].ladderPosition);
    }
  });
});

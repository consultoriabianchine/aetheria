import { ARENAS, HUNT_CONFIG } from '@aetheria/config';
import { mulberry32, uid } from '@aetheria/shared';
import type {
  ArenaDefinition,
  CharacterSummary,
  CreatureDefinition,
  HuntDefinition,
  HuntListEntry,
  HuntProgress,
  HuntRunStatus,
  HuntRunView,
  WaveState,
} from '@aetheria/types';
import { CreatureAIService, CreatureTarget } from '../creature/creature-ai.service';
import { CreatureEntity } from '../creature/creature.entity';
import { CreatureManager } from '../creature/creature-manager.service';
import { MovementService } from '../creature/movement.service';
import type { GamePlayer } from '../engine/world';
import { generateArenaMap, monsterSpawnPositions, partySpawnPosition } from './arena-map';
import { calculateBossStats } from './boss-engine';
import { generatePack, RandomSource } from './pack-generator';
import { calculateWipePenalty } from './wipe-engine';
import { buildWorldMapData, type WorldMapData } from '../engine/world-map';

export interface HuntRun {
  id: string;
  characterId: string;
  hunt: HuntDefinition;
  arena: ArenaDefinition;
  wave: number;
  status: HuntRunStatus;
  waveState: WaveState;
  loopEnabled: boolean;
  startedAt: number;
  transitionAt: number | null;
  respawnAt: number | null;
  z: number;
  map: WorldMapData;
  movement: MovementService;
  creatures: CreatureManager;
  ai: CreatureAIService;
  rng: RandomSource;
  isBossWave: boolean;
  bossCreatureId: string | null;
}

export interface HuntEngineHooks {
  getPlayer(characterId: string): GamePlayer | null;
  playerSnapshot(characterId: string): CreatureTarget | null;
  summarize(player: GamePlayer): CharacterSummary;
  getCreatureDefinition(id: string): CreatureDefinition | null;
  getMap(id: string): { width: number; height: number; tiles: import('@aetheria/types').MapTile[] } | null;
  getHunts(): HuntDefinition[];
  emitTo(socketId: string, event: string, data: unknown): void;
  onCreatureAttackPlayer(creature: CreatureEntity, playerId: string, amount: number, critical: boolean, now: number): void;
  onRunFinished(characterId: string, reason: 'completed' | 'wiped' | 'stopped'): void;
  onHuntCompleted(characterId: string, huntId: string, suggestedLevel: number): void;
  recordCompletion(characterId: string, huntId: string, clearTimeMs: number): Promise<HuntProgress>;
  getProgress(characterId: string): Promise<Map<string, HuntProgress>>;
}

export type StartHuntResult =
  | { ok: true; run: HuntRun }
  | { ok: false; error: string };

/** Resolve a arena de uma hunt, aplicando dimensões custom (se definidas). */
function resolveArena(hunt: HuntDefinition): ArenaDefinition {
  const base = ARENAS[hunt.arenaId];
  return {
    ...base,
    width: hunt.arenaWidth ?? base.width,
    height: hunt.arenaHeight ?? base.height,
  };
}

/**
 * Motor de Hunts: controla waves, packs, boss, loop, wipe, transições e
 * conclusão. O Combate (dano, morte, XP, loot) é responsabilidade do
 * GameEngine — o HuntEngine apenas gerencia a progressão das fases.
 */
export class HuntEngine {
  private runs = new Map<string, HuntRun>();
  private nextZ = 100;

  constructor(private readonly hooks: HuntEngineHooks) {}

  getRun(characterId: string): HuntRun | null {
    return this.runs.get(characterId) ?? null;
  }

  /** Encontra a run que contém uma criatura (para rotear eventos). */
  findRunByCreature(creatureId: string): HuntRun | null {
    for (const run of this.runs.values()) {
      if (run.creatures.getCreature(creatureId)) return run;
    }
    return null;
  }

  /** Remove a run (disconnect / parada) sem penalidade. */
  removeRun(characterId: string): void {
    this.runs.delete(characterId);
  }

  findHunt(huntId: string): HuntDefinition | null {
    return this.hooks.getHunts().find((h) => h.id === huntId) ?? null;
  }

  listHunts(): HuntDefinition[] {
    return [...this.hooks.getHunts()].sort((a, b) => a.ladderPosition - b.ladderPosition);
  }

  async toListEntry(hunt: HuntDefinition, characterId: string): Promise<HuntListEntry> {
    const progress = (await this.hooks.getProgress(characterId)).get(hunt.id);
    const monsterName = (id: string) => this.hooks.getCreatureDefinition(id)?.name ?? id;
    return {
      id: hunt.id,
      name: hunt.name,
      ladderPosition: hunt.ladderPosition,
      suggestedLevel: hunt.suggestedLevel,
      combatScore: hunt.combatScore,
      basePackSize: hunt.basePackSize,
      maxPackSize: hunt.maxPackSize,
      monsters: hunt.monsters.map((m) => ({ id: m.monsterId, name: monsterName(m.monsterId) })),
      boss: { monsterId: hunt.boss.monsterId, name: hunt.boss.name },
      arenaId: hunt.arenaId,
      theme: hunt.theme,
      enabled: hunt.enabled,
      completionCount: progress?.completionCount ?? 0,
      firstClearTimeMs: progress?.firstClearTimeMs ?? null,
      bestClearTimeMs: progress?.bestClearTimeMs ?? null,
    };
  }

  startHunt(characterId: string, huntId: string, loopEnabled: boolean, now: number): StartHuntResult {
    const existing = this.runs.get(characterId);
    if (existing && existing.status === 'active') return { ok: false, error: 'CHARACTER_ALREADY_IN_HUNT' };
    const hunt = this.findHunt(huntId);
    if (!hunt) return { ok: false, error: 'HUNT_NOT_FOUND' };
    if (!hunt.enabled) return { ok: false, error: 'HUNT_DISABLED' };
    const arena = resolveArena(hunt);
    if (!ARENAS[hunt.arenaId]) return { ok: false, error: 'HUNT_NOT_FOUND' };

    const run = this.createRun(characterId, hunt, arena, loopEnabled, now);    this.runs.set(characterId, run);
    this.enterArena(run);
    this.startWave(run, 1, now);
    return { ok: true, run };
  }

  stopHunt(characterId: string): boolean {
    const run = this.runs.get(characterId);
    if (!run || run.status !== 'active') return false;
    run.status = 'returning_to_city';
    this.hooks.onRunFinished(characterId, 'stopped');
    return true;
  }

  setLoop(characterId: string, enabled: boolean): boolean {
    const run = this.runs.get(characterId);
    if (!run) return false;
    run.loopEnabled = enabled;
    const player = this.hooks.getPlayer(characterId);
    this.hooks.emitTo(player?.socketId ?? '', 'hunt.loopChanged', { huntId: run.hunt.id, loopEnabled: enabled });
    return true;
  }

  view(run: HuntRun): HuntRunView {
    return {
      huntId: run.hunt.id,
      huntName: run.hunt.name,
      wave: run.wave,
      status: run.status,
      loopEnabled: run.loopEnabled,
      monsterCount: run.creatures.size,
      isBoss: run.isBossWave,
      startedAt: run.startedAt,
      waveStartedAt: run.transitionAt ?? run.startedAt,
    };
  }

  /** Evento chamado pelo GameEngine quando o jogador morre. */
  onPlayerDied(characterId: string, now: number) {
    const run = this.runs.get(characterId);
    if (!run || run.status !== 'active') return;
    this.handleWipe(run, now);
  }

  update(now: number) {
    for (const run of this.runs.values()) {
      try {
        if (run.status === 'returning_to_city') continue;

        run.creatures.updateCreatures(run.ai, now);

        if (run.respawnAt !== null && now >= run.respawnAt) {
          run.respawnAt = null;
          this.restartLoop(run, now);
          continue;
        }

        if (run.status !== 'active') continue;

        if (run.waveState === 'transitioning' && run.transitionAt !== null && now >= run.transitionAt) {
          run.transitionAt = null;
          this.startWave(run, run.wave + 1, now);
          continue;
        }

        if (run.waveState === 'combat' && run.creatures.size === 0) {
          this.completeWave(run, now);
        }
      } catch {
        // run individual não deve derrubar o tick global
      }
    }
  }

  // ------------------------------------------------------------ internos

  private createRun(characterId: string, hunt: HuntDefinition, arena: ArenaDefinition, loopEnabled: boolean, now: number): HuntRun {
    const z = this.nextZ++;
    const map = this.resolveMap(hunt, arena, z);
    const effectiveArena: ArenaDefinition = { ...arena, width: map.width, height: map.height };
    const movement = new MovementService(map, (position, exceptIds) => this.isOccupied(run, position, exceptIds));
    const run: HuntRun = {
      id: uid('hunt'),
      characterId,
      hunt,
      arena: effectiveArena,
      wave: 0,
      status: 'active',
      waveState: 'not_started',
      loopEnabled,
      startedAt: now,
      transitionAt: null,
      respawnAt: null,
      z,
      map,
      movement,
      creatures: new CreatureManager(movement),
      ai: new CreatureAIService(
        {
          movement,
          getPlayers: () => this.playersInRun(run),
          getPlayerById: (id) => (id === characterId ? this.hooks.playerSnapshot(characterId) : null),
          broadcast: (event, data) => this.emitCreature(run, event, data),
          onAttackPlayer: (creature, target, amount, critical, now) =>
            this.hooks.onCreatureAttackPlayer(creature, target.id, amount, critical, now),
        },
        { aggressive: true },
      ),
      rng: { next: mulberry32(now >>> 0) },
      isBossWave: false,
      bossCreatureId: null,
    };
    return run;
  }

  private playersInRun(run: HuntRun): CreatureTarget[] {
    const snap = this.hooks.playerSnapshot(run.characterId);
    return snap ? [snap] : [];
  }

  /** Mapa da masmorra: custom (mapId) se existir, senão arena procedural. */
  private resolveMap(hunt: HuntDefinition, arena: ArenaDefinition, z: number): WorldMapData {
    if (hunt.mapId) {
      const custom = this.hooks.getMap(hunt.mapId);
      if (custom) return buildWorldMapData(custom.tiles, custom.width, custom.height, z);
    }
    return generateArenaMap(arena, z);
  }

  private isOccupied(run: HuntRun, position: { x: number; y: number; z: number }, exceptIds?: Iterable<string>): boolean {
    const except = new Set(exceptIds ?? []);
    for (const c of run.creatures.getAll()) {
      if (c.state === 'DEAD') continue;
      if (except.has(c.id)) continue;
      if (c.position.x === position.x && c.position.y === position.y && c.position.z === position.z) return true;
    }
    return false;
  }

  private emitCreature(run: HuntRun, event: string, data: unknown) {
    const player = this.hooks.getPlayer(run.characterId);
    this.hooks.emitTo(player?.socketId ?? '', event, data);
  }

  private emit(run: HuntRun, event: string, data: unknown) {
    const player = this.hooks.getPlayer(run.characterId);
    this.hooks.emitTo(player?.socketId ?? '', event, data);
  }

  private enterArena(run: HuntRun) {
    const player = this.hooks.getPlayer(run.characterId);
    if (!player) return;
    player.position = { ...partySpawnPosition(run.arena, run.z) };
    player.moveDir = null;
    player.targetId = null;
    player.health = player.maxHealth;
    player.mana = player.maxMana;
    this.emit(run, 'game.enterArena', {
      character: this.hooks.summarize(player),
      map: run.map.tiles,
      width: run.arena.width,
      height: run.arena.height,
      hunt: this.view(run),
    });
    this.emit(run, 'hunt.started', { hunt: this.view(run) });
  }

  private startWave(run: HuntRun, wave: number, now: number) {
    run.wave = wave;
    run.waveState = 'combat';
    run.transitionAt = null;

    if (wave === HUNT_CONFIG.bossWave) {
      this.spawnBoss(run);
    } else {
      this.spawnPack(run, wave);
    }
    this.emit(run, 'hunt.wave', {
      huntId: run.hunt.id,
      wave,
      monsterCount: run.creatures.size,
      isBoss: run.isBossWave,
    });
    void now;
  }

  private spawnPack(run: HuntRun, wave: number) {
    run.isBossWave = false;
    run.bossCreatureId = null;
    const pack = generatePack(run.hunt, wave, run.rng);
    const arena = run.arena;
    const positions = monsterSpawnPositions(arena, run.z, pack.monsterIds.length);
    pack.monsterIds.forEach((monsterId, i) => {
      const def = this.hooks.getCreatureDefinition(monsterId);
      if (!def) return;
      const entity = run.creatures.spawnCreature(def, positions[i] ?? positions[positions.length - 1]);
      entity.respawnTimeMs = -1;
      this.emitCreatureSpawn(run, entity, false);
    });
  }

  private spawnBoss(run: HuntRun) {
    run.isBossWave = true;
    const base = this.hooks.getCreatureDefinition(run.hunt.boss.monsterId);
    if (!base) {
      this.handleMissingBoss(run);
      return;
    }
    const stats = calculateBossStats(base, run.hunt.boss.statMultipliers);
    const bossDef: CreatureDefinition = {
      ...base,
      id: `${base.id}_boss`,
      name: run.hunt.boss.name,
      maxHealth: stats.maxHealth,
      health: stats.maxHealth,
      attack: stats.attack,
      experience: stats.experience,
      loot: [],
    };
    const arena = run.arena;
    const pos = monsterSpawnPositions(arena, run.z, 1)[0];
    const entity = run.creatures.spawnCreature(bossDef, pos);
    entity.respawnTimeMs = -1;
    run.bossCreatureId = entity.id;
    this.emitCreatureSpawn(run, entity, true);
  }

  private emitCreatureSpawn(run: HuntRun, entity: CreatureEntity, isBoss: boolean) {
    this.emit(run, 'creature.spawn', {
      creatureId: entity.id,
      definitionId: entity.definitionId,
      definitionCreatureId: entity.definition.creatureId,
      slug: entity.definition.slug,
      name: entity.name,
      position: { ...entity.position },
      facing: entity.facing,
      state: entity.state,
      health: entity.health,
      maxHealth: entity.maxHealth,
      level: entity.definition.level,
      viewRange: entity.definition.viewRange,
      chaseRange: entity.definition.chaseRange,
      attackRange: entity.definition.attackRange,
      movementSpeed: entity.definition.movementSpeed,
      description: entity.definition.description,
      isBoss,
    });
  }

  private completeWave(run: HuntRun, now: number) {
    if (run.wave >= HUNT_CONFIG.bossWave) {
      this.completeHunt(run, now);
      return;
    }
    run.waveState = 'transitioning';
    run.transitionAt = now + HUNT_CONFIG.waveTransitionMs;
    this.emit(run, 'hunt.cleared', { huntId: run.hunt.id, wave: run.wave });
  }

  private completeHunt(run: HuntRun, now: number) {
    const clearTimeMs = Math.max(0, now - run.startedAt);
    run.status = 'completed';
    run.waveState = 'not_started';
    this.hooks.onHuntCompleted(run.characterId, run.hunt.id, run.hunt.suggestedLevel);
    void this.hooks.recordCompletion(run.characterId, run.hunt.id, clearTimeMs).then((progress) => {
      if (this.runs.get(run.characterId) !== run) return;
      this.emit(run, 'hunt.completed', {
        huntId: run.hunt.id,
        completionCount: progress.completionCount,
        clearTimeMs,
        bestClearTimeMs: progress.bestClearTimeMs,
        loopEnabled: run.loopEnabled,
      });
      if (run.loopEnabled) {
        this.restartLoop(run, now);
      } else {
        run.status = 'returning_to_city';
        this.hooks.onRunFinished(run.characterId, 'completed');
      }
    });
  }

  private restartLoop(run: HuntRun, now: number) {
    run.creatures.clear();
    run.status = 'active';
    run.waveState = 'not_started';
    run.startedAt = now;
    run.transitionAt = null;
    run.respawnAt = null;
    const player = this.hooks.getPlayer(run.characterId);
    if (player) {
      player.health = player.maxHealth;
      player.mana = player.maxMana;
      player.position = { ...partySpawnPosition(run.arena, run.z) };
    }
    this.startWave(run, 1, now);
  }

  private handleWipe(run: HuntRun, now: number) {
    const player = this.hooks.getPlayer(run.characterId);
    const penalty = player ? calculateWipePenalty([player.level], player.gold) : 0;
    if (player) {
      player.gold -= penalty;
      this.emit(run, 'gold.update', { gold: player.gold });
    }
    run.creatures.clear();
    run.status = 'wiped';
    run.waveState = 'not_started';
    if (run.loopEnabled) {
      run.respawnAt = now + HUNT_CONFIG.wipe.respawnMs;
      this.emit(run, 'hunt.wiped', { huntId: run.hunt.id, penaltyPaid: penalty, loopEnabled: true, respawnInMs: HUNT_CONFIG.wipe.respawnMs });
    } else {
      this.emit(run, 'hunt.wiped', { huntId: run.hunt.id, penaltyPaid: penalty, loopEnabled: false, respawnInMs: null });
      run.status = 'returning_to_city';
      this.hooks.onRunFinished(run.characterId, 'wiped');
    }
  }

  private handleMissingBoss(run: HuntRun) {
    // Sem definição de boss no registry, encerra como falha controlada.
    run.status = 'returning_to_city';
    this.hooks.onRunFinished(run.characterId, 'stopped');
  }
}
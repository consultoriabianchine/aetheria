import { ARENAS, HUNT_CONFIG, difficultyRatingFromLevel, difficultyRatingFromScore } from '@aetheria/config';
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
import { OccupancyGrid } from '../creature/occupancy-grid';
import type { GamePlayer } from '../engine/world';
import { generateArenaMap, monsterSpawnPositions, partySpawnPositions } from './arena-map';
import { calculateBossStats } from './boss-engine';
import { generatePack, RandomSource } from './pack-generator';
import { calculateWipePenalty } from './wipe-engine';
import { buildWorldMapData, type WorldMapData } from '../engine/world-map';

export interface HuntRun {
  id: string;
  characterId: string;
  /** IDs de todos os membros da party na run (líder primeiro). */
  memberIds: string[];
  /** Subconjunto de memberIds ainda vivos na wave atual. */
  aliveMemberIds: string[];
  /** Companheiros mortos na run atual, que retornam no próximo loop. */
  deadMemberIds: string[];
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
  occupancy: OccupancyGrid;
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
  getMapRender(id: string): import('@aetheria/types').MapRenderData | null;
  getHunts(): HuntDefinition[];
  emitTo(socketId: string, event: string, data: unknown): void;
  getGold(characterId: string): number;
  deductGold(characterId: string, amount: number): number;
  onCreatureAttackPlayer(creature: CreatureEntity, playerId: string, amount: number, critical: boolean, now: number): void;
  getCreatureAttackRange(creature: CreatureEntity): number;
  onRunFinished(characterId: string, reason: 'completed' | 'wiped' | 'stopped'): void;
  onRunLoopRestarted?(characterId: string, memberIds: string[]): void;
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
  private memberIndex = new Map<string, string>();
  private nextZ = 100;

  constructor(private readonly hooks: HuntEngineHooks) {}

  getRun(characterId: string): HuntRun | null {
    const direct = this.runs.get(characterId);
    if (direct) return direct;
    const leaderId = this.memberIndex.get(characterId);
    return leaderId ? this.runs.get(leaderId) ?? null : null;
  }

  hasRun(characterId: string): boolean {
    return this.getRun(characterId) !== null;
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
    const run = this.getRun(characterId);
    if (!run) return;
    for (const id of run.memberIds) this.memberIndex.delete(id);
    this.runs.delete(run.characterId);
  }

  findHunt(huntId: string): HuntDefinition | null {
    return this.hooks.getHunts().find((h) => h.id === huntId) ?? null;
  }

  listHunts(): HuntDefinition[] {
    return [...this.hooks.getHunts()].sort((a, b) => a.ladderPosition - b.ladderPosition);
  }

  async toListEntry(hunt: HuntDefinition, characterId: string): Promise<HuntListEntry> {
    const progress = (await this.hooks.getProgress(characterId)).get(hunt.id);
    const monsterInfo = (id: string) => {
      const def = this.hooks.getCreatureDefinition(id);
      return { creatureId: def?.creatureId ?? null, slug: def?.slug ?? id, name: def?.name ?? id };
    };
    const difficultyRating =
      hunt.difficultyRating ??
      (hunt.combatScore != null ? difficultyRatingFromScore(hunt.combatScore) : difficultyRatingFromLevel(hunt.suggestedLevel));
    return {
      id: hunt.id,
      name: hunt.name,
      slug: hunt.slug,
      ladderPosition: hunt.ladderPosition,
      suggestedLevel: hunt.suggestedLevel,
      combatScore: hunt.combatScore,
      difficultyRating,
      xpRating: hunt.xpRating ?? null,
      lootRating: hunt.lootRating ?? null,
      tags: hunt.tags ?? [],
      basePackSize: hunt.basePackSize,
      maxPackSize: hunt.maxPackSize,
      monsters: hunt.monsters.map((m) => ({ id: m.monsterId, ...monsterInfo(m.monsterId) })),
      boss: { monsterId: hunt.boss.monsterId, ...monsterInfo(hunt.boss.monsterId), name: hunt.boss.name },
      arenaId: hunt.arenaId,
      theme: hunt.theme,
      enabled: hunt.enabled,
      completionCount: progress?.completionCount ?? 0,
      firstClearAt: progress?.firstClearAt ?? null,
      firstClearTimeMs: progress?.firstClearTimeMs ?? null,
      bestClearTimeMs: progress?.bestClearTimeMs ?? null,
      favorite: progress?.favorite ?? false,
    };
  }

  startHunt(characterId: string, memberIds: string[], huntId: string, loopEnabled: boolean, now: number): StartHuntResult {
    const existing = this.runs.get(characterId);
    if (existing && existing.status === 'active') return { ok: false, error: 'CHARACTER_ALREADY_IN_HUNT' };
    const hunt = this.findHunt(huntId);
    if (!hunt) return { ok: false, error: 'HUNT_NOT_FOUND' };
    if (!hunt.enabled) return { ok: false, error: 'HUNT_DISABLED' };
    const arena = resolveArena(hunt);
    if (!ARENAS[hunt.arenaId]) return { ok: false, error: 'HUNT_NOT_FOUND' };

    const members = memberIds.includes(characterId) ? memberIds : [characterId, ...memberIds];
    const run = this.createRun(characterId, members, hunt, arena, loopEnabled, now);
    this.runs.set(characterId, run);
    for (const id of members) this.memberIndex.set(id, characterId);
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

  /** Evento chamado pelo GameEngine quando um membro da party morre. */
  onPlayerDied(characterId: string, now: number) {
    const run = this.getRun(characterId);
    if (!run || run.status !== 'active') return;
    run.aliveMemberIds = run.aliveMemberIds.filter((id) => id !== characterId);
    if (!run.deadMemberIds.includes(characterId)) run.deadMemberIds.push(characterId);
    this.clearCreatureTarget(run, characterId);
    run.movement.releaseEntity(characterId);
    if (run.aliveMemberIds.length === 0) this.handleWipe(run, now);
  }

  /** Retira um companheiro morto da wave atual sem removê-lo da run. */
  removeMember(characterId: string, now: number) {
    const run = this.getRun(characterId);
    if (!run || run.status !== 'active') return;
    run.aliveMemberIds = run.aliveMemberIds.filter((id) => id !== characterId);
    if (!run.deadMemberIds.includes(characterId)) run.deadMemberIds.push(characterId);
    this.clearCreatureTarget(run, characterId);
    run.movement.releaseEntity(characterId);
    if (run.aliveMemberIds.length === 0) this.handleWipe(run, now);
  }

  private clearCreatureTarget(run: HuntRun, characterId: string) {
    for (const creature of run.creatures.getAll()) {
      if (creature.targetId !== characterId) continue;
      creature.targetId = null;
      creature.path = [];
      creature.pathIndex = 0;
      if (creature.state === 'ATTACK' || creature.state === 'CHASE') creature.state = 'IDLE';
    }
  }

  update(now: number) {
    for (const run of this.runs.values()) {
      this.updateRun(run.characterId, now);
    }
  }

  nextUpdateAt(characterId: string, now: number): number {
    const run = this.runs.get(characterId);
    if (!run) return now + 1000;
    if (run.respawnAt !== null) return Math.min(run.respawnAt, now + 1000);
    if (run.transitionAt !== null) return Math.min(run.transitionAt, now + 1000);
    let next = run.creatures.nextUpdateAt(now);
    for (const id of run.aliveMemberIds) {
      const player = this.hooks.getPlayer(id);
      if (!player || player.combat.movement === 'hold') continue;
      next = Math.min(next, Math.max(now + 50, player.nextMoveAt));
    }
    return next;
  }

  updateRun(characterId: string, now: number) {
    const run = this.runs.get(characterId);
    if (!run) return;
    try {
      if (run.status === 'returning_to_city') return;

      run.creatures.updateCreatures(run.ai, now);

      if (run.respawnAt !== null && now >= run.respawnAt) {
        run.respawnAt = null;
        this.restartLoop(run, now);
        return;
      }

      if (run.status !== 'active') return;

      if (run.waveState === 'transitioning' && run.transitionAt !== null && now >= run.transitionAt) {
        run.transitionAt = null;
        this.startWave(run, run.wave + 1, now);
        return;
      }

      if (run.waveState === 'combat' && run.creatures.size === 0) {
        this.completeWave(run, now);
      }
    } catch {
      // run individual não deve derrubar o tick global
    }
  }

  // ------------------------------------------------------------ internos

  private createRun(characterId: string, memberIds: string[], hunt: HuntDefinition, arena: ArenaDefinition, loopEnabled: boolean, now: number): HuntRun {
    const z = this.nextZ++;
    const map = this.resolveMap(hunt, arena, z);
    const effectiveArena: ArenaDefinition = { ...arena, width: map.width, height: map.height };
    const occupancy = new OccupancyGrid();
    const movement = new MovementService(
      map,
      (position, exceptIds) => occupancy.isOccupied(position, exceptIds),
      occupancy,
    );
    const run: HuntRun = {
      id: uid('hunt'),
      characterId,
      memberIds: [...memberIds],
      aliveMemberIds: [...memberIds],
      deadMemberIds: [],
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
      occupancy,
      creatures: new CreatureManager(movement),
      ai: new CreatureAIService(
        {
          movement,
          getPlayers: () => this.playersInRun(run),
          getPlayerById: (id) => (memberIds.includes(id) ? this.hooks.playerSnapshot(id) : null),
          broadcast: (event, data) => this.emitToMembers(run, event, data),
          onAttackPlayer: (creature, target, amount, critical, now) =>
            this.hooks.onCreatureAttackPlayer(creature, target.id, amount, critical, now),
          getCreatureAttackRange: (creature) => this.hooks.getCreatureAttackRange(creature),
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
    const out: CreatureTarget[] = [];
    for (const id of run.aliveMemberIds) {
      const snap = this.hooks.playerSnapshot(id);
      if (snap) out.push(snap);
    }
    return out;
  }

  /** Mapa da masmorra: custom (mapId) se existir, senão arena procedural. */
  private resolveMap(hunt: HuntDefinition, arena: ArenaDefinition, z: number): WorldMapData {
    if (hunt.mapId) {
      const custom = this.hooks.getMap(hunt.mapId);
      if (custom) {
        const render = this.hooks.getMapRender(hunt.mapId);
        return buildWorldMapData(custom.tiles, custom.width, custom.height, z, render ?? undefined);
      }
    }
    return generateArenaMap(arena, z);
  }

  private emitToMembers(run: HuntRun, event: string, data: unknown) {
    for (const id of run.memberIds) {
      const member = this.hooks.getPlayer(id);
      if (member?.socketId) this.hooks.emitTo(member.socketId, event, data);
    }
  }

  private emit(run: HuntRun, event: string, data: unknown) {
    this.emitToMembers(run, event, data);
  }

  private enterArena(run: HuntRun) {
    const leader = this.hooks.getPlayer(run.characterId);
    if (!leader) return;
    const positions = partySpawnPositions(run.arena, run.z, run.memberIds.length);
    run.memberIds.forEach((id, i) => {
      const member = this.hooks.getPlayer(id);
      if (!member) return;
      run.movement.releaseEntity(id);
      member.position = { ...(positions[i] ?? positions[positions.length - 1]) };
      run.movement.occupy(member.position, id);
      member.moveDir = null;
      member.targetId = null;
      member.health = member.maxHealth;
      member.mana = member.maxMana;
    });
    this.emit(run, 'game.enterArena', {
      character: this.hooks.summarize(leader),
      members: run.memberIds
        .map((id) => this.hooks.getPlayer(id))
        .filter((p): p is GamePlayer => !!p)
        .map((p) => this.hooks.summarize(p)),
      map: run.map.tiles,
      width: run.arena.width,
      height: run.arena.height,
      render: run.map.render ?? undefined,
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
      const entity = run.creatures.spawnCreature(def, positions[i] ?? positions[positions.length - 1], undefined, run.rng.next);
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
    const entity = run.creatures.spawnCreature(bossDef, pos, undefined, run.rng.next);
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
    const rejoining = [...run.deadMemberIds];
    run.creatures.clear();
    run.status = 'active';
    run.waveState = 'not_started';
    run.wave = 0;
    run.startedAt = now;
    run.transitionAt = null;
    run.respawnAt = null;
    run.deadMemberIds = [];
    run.aliveMemberIds = [...run.memberIds];
    this.enterArena(run);
    this.hooks.onRunLoopRestarted?.(run.characterId, rejoining);
    this.startWave(run, 1, now);
  }

  private repositionMembers(run: HuntRun) {
    const positions = partySpawnPositions(run.arena, run.z, run.memberIds.length);
    run.memberIds.forEach((id, i) => {
      const member = this.hooks.getPlayer(id);
      if (!member) return;
      member.health = member.maxHealth;
      member.mana = member.maxMana;
      run.movement.releaseEntity(id);
      member.position = { ...(positions[i] ?? positions[positions.length - 1]) };
      run.movement.occupy(member.position, id);
      member.targetId = null;
      member.moveDir = null;
    });
  }

  private handleWipe(run: HuntRun, now: number) {
    const levels = run.memberIds
      .map((id) => this.hooks.getPlayer(id))
      .filter((p): p is GamePlayer => !!p)
      .map((p) => p.level);
    const gold = this.hooks.getGold(run.characterId);
    const penalty = levels.length > 0 ? calculateWipePenalty(levels, gold) : 0;
    if (penalty > 0) {
      this.hooks.deductGold(run.characterId, penalty);
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

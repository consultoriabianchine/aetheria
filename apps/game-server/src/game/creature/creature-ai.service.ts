import {
  BLOCKED_RETARGET_THRESHOLD_MS,
  CREATURE_REGENERATION_PER_TICK,
  CREATURE_STUCK_LIMIT,
  FLEE_PREFERRED_DIST,
  PATH_RECALC_TARGET_DELTA,
  PATH_RECALCULATION_INTERVAL,
  RANGED_PREFERRED_MIN,
  TARGET_PRIORITY,
  TARGET_STICKINESS_BONUS,
  TARGET_UNREACHABLE_PENALTY,
  TICK_MS,
  TILE_RESERVE_TTL_MS,
  WANDER_CHANCE_PER_TICK,
  WANDER_MAX_DIST,
  WANDER_MAX_STEPS,
  WANDER_MIN_DIST,
  debugCreatures,
} from '@aetheria/config';
import { samePosition, tileDistance } from '@aetheria/shared';
import type { CombatArchetype, CreatureState, Position } from '@aetheria/types';
import { CreatureEntity } from './creature.entity';
import { ALL_DIRECTIONS, DIRECTION_DELTAS, Direction, directionFromDelta } from './direction';
import { MovementService } from './movement.service';
import { findPath } from './pathfinding';

/** Visão que a IA tem de um jogador (snapshot autoritativo do engine). */
export interface CreatureTarget {
  id: string;
  position: Position;
  socketId: string | null;
  health: number;
  defense: number;
  archetype: CombatArchetype;
}

export interface CreatureAIHooks {
  movement: MovementService;
  getPlayers(): Iterable<CreatureTarget>;
  getPlayerById(id: string): CreatureTarget | null;
  /** Transmite para todos os jogadores conectados. */
  broadcast(event: string, data: unknown): void;
  /** A criatura acertou um jogador: aplica dano, atualiza HP e trata morte. */
  onAttackPlayer(creature: CreatureEntity, target: CreatureTarget, amount: number, critical: boolean, now: number): void;
  /** Alcance de posicionamento da criatura (tiles), independente das magias. */
  getCreatureAttackRange?(creature: CreatureEntity): number;
}

/** Opções de comportamento da IA. */
export interface CreatureAIOptions {
  /**
   * Modo arena (hunts): criaturas sempre perseguem o jogador — detectam-no a
   * qualquer distância, ignoram canWander/canChase/canFlee e nunca desistem
   * da perseguição por distância ao spawn.
   */
  aggressive?: boolean;
}

const WANDER_TIMEOUT_MS = 8000;
const FLEE_RECALC_INTERVAL_MS = 900;

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * IA das criaturas — exclusivamente no backend.
 * Máquina de estados: IDLE, WANDER, CHASE, ATTACK, FLEE, RETURN, DEAD.
 * Movimento em tiles, pathfinding A*, detecção por Chebyshev + mesmo andar.
 */
export class CreatureAIService {
  constructor(
    private readonly hooks: CreatureAIHooks,
    private readonly options: CreatureAIOptions = {},
  ) {}

  private get aggressive(): boolean {
    return this.options.aggressive ?? false;
  }

  private get movement(): MovementService {
    return this.hooks.movement;
  }

  private exceptIds(creature: CreatureEntity, target?: CreatureTarget | null): Iterable<string> {
    const ids = [creature.id];
    if (target) ids.push(target.id);
    return ids;
  }

  /** Footprint lógico da criatura (default 1×1). */
  private fp(creature: CreatureEntity): { w: number; h: number } {
    return {
      w: Math.max(1, creature.definition.footprintWidth ?? 1),
      h: Math.max(1, creature.definition.footprintHeight ?? 1),
    };
  }

  // ------------------------------------------------------------ estado

  private switchState(creature: CreatureEntity, state: CreatureState, now: number) {
    if (creature.state === state) return;
    creature.state = state;
    if (state === 'CHASE') {
      creature.path = [];
      creature.pathIndex = 0;
      creature.lastPathCalcAt = 0;
      creature.lastChaseTargetPos = null;
      creature.stuckCount = 0;
    } else if (state === 'RETURN' || state === 'FLEE') {
      creature.path = [];
      creature.pathIndex = 0;
      creature.stuckCount = 0;
    }
    void now;
  }

  // ------------------------------------------------------------ update

  update(creature: CreatureEntity, now: number) {
    if (creature.state === 'DEAD') return;
    const target = this.resolveTarget(creature, now);

    const shouldFlee =
      !this.aggressive &&
      creature.definition.canFlee &&
      target !== null &&
      creature.healthPercent <= creature.definition.fleeHealthPercent;

    if (shouldFlee && creature.state !== 'FLEE') {
      this.switchState(creature, 'FLEE', now);
    }

    switch (creature.state) {
      case 'IDLE':
        this.updateIdle(creature, target, now);
        break;
      case 'WANDER':
        this.updateWander(creature, target, now);
        break;
      case 'CHASE':
        this.updateChase(creature, target, now);
        break;
      case 'ATTACK':
        this.updateAttack(creature, target, now);
        break;
      case 'FLEE':
        this.updateFlee(creature, target, now);
        break;
      case 'RETURN':
        this.updateReturn(creature, now);
        break;
    }

    if (creature.state === 'IDLE' && creature.health < creature.maxHealth) {
      creature.health = Math.min(
        creature.maxHealth,
        creature.health + Math.round(creature.maxHealth * CREATURE_REGENERATION_PER_TICK),
      );
    }
  }

  // ------------------------------------------------------------ detecção

  /** Alcance de posicionamento; magias são resolvidas depois que o ataque começa. */
  private effectiveAttackRange(creature: CreatureEntity): number {
    return Math.max(0, creature.definition.attackRange);
  }

  /** O posicionamento ranged depende do ataque base, não do alcance de magias. */
  private isRanged(creature: CreatureEntity): boolean {
    return creature.definition.attackRange > 1;
  }

  /** Semente de tie-break estável por criatura (varia caminhos de custo igual). */
  private tieBreakSeed(creature: CreatureEntity): number {
    let h = 0;
    for (let i = 0; i < creature.id.length; i++) h = (h * 31 + creature.id.charCodeAt(i)) | 0;
    return h + creature.preferredSide;
  }

  /** true se há caminho (ou alcance) para atacar o alvo. */
  private canReach(creature: CreatureEntity, target: CreatureTarget): boolean {
    if (tileDistance(creature.position, target.position) <= this.effectiveAttackRange(creature)) return true;
    const path = findPath(this.movement, {
      start: creature.position,
      goal: target.position,
      exceptIds: [creature.id, target.id],
      maxCost: this.aggressive ? 1000 : creature.definition.chaseRange + creature.definition.viewRange,
      tieBreak: this.tieBreakSeed(creature),
      footprint: this.fp(creature),
    });
    return path !== null && path.length > 0;
  }

  /** Seleciona o melhor alvo por score (prioridade de classe + alcance + stickiness). */
  private selectBestTarget(creature: CreatureEntity): CreatureTarget | null {
    let best: CreatureTarget | null = null;
    let bestScore = -Infinity;
    for (const p of this.hooks.getPlayers()) {
      if (p.health <= 0) continue;
      if (p.position.z !== creature.position.z) continue;
      if (!this.aggressive && tileDistance(creature.position, p.position) > creature.definition.viewRange) continue;
      const priority = TARGET_PRIORITY[p.archetype] ?? 0;
      const distance = tileDistance(creature.position, p.position);
      const stickiness = p.id === creature.targetId ? TARGET_STICKINESS_BONUS : 0;
      const reachable = this.canReach(creature, p);
      const score = priority + stickiness - distance - (reachable ? 0 : TARGET_UNREACHABLE_PENALTY);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) {
      creature.debugScore = bestScore;
      creature.debugTargetPos = { ...best.position };
    }
    return best;
  }

  private resolveTarget(creature: CreatureEntity, now: number): CreatureTarget | null {
    let target: CreatureTarget | null = null;
    if (creature.targetId) {
      target = this.hooks.getPlayerById(creature.targetId);
      if (!target) creature.targetId = null;
    }
    if (target && target.health <= 0) {
      target = null;
      creature.targetId = null;
    }
    if (target) return target;

    // Sem alvo atual (ou morto): seleciona o melhor candidato.
    const detected = this.aggressive || creature.definition.canChase ? this.selectBestTarget(creature) : null;
    if (detected) {
      creature.targetId = detected.id;
      return detected;
    }
    void now;
    return null;
  }

  // ------------------------------------------------------------ IDLE

  updateIdle(creature: CreatureEntity, target: CreatureTarget | null, now: number) {
    if (target && (creature.definition.canChase || this.aggressive)) {
      this.switchState(creature, 'CHASE', now);
      return;
    }
    if (creature.definition.canWander && now >= creature.lastMoveAt && Math.random() < WANDER_CHANCE_PER_TICK) {
      this.startWander(creature, now);
    }
  }

  private startWander(creature: CreatureEntity, now: number) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const dist = WANDER_MIN_DIST + Math.random() * (WANDER_MAX_DIST - WANDER_MIN_DIST);
      const angle = Math.random() * Math.PI * 2;
      const goal: Position = {
        x: clamp(Math.round(creature.position.x + Math.cos(angle) * dist), 1, 62),
        y: clamp(Math.round(creature.position.y + Math.sin(angle) * dist), 1, 62),
        z: creature.position.z,
      };
      if (samePosition(goal, creature.position)) continue;
      if (!this.movement.isWalkable(goal)) continue;
      const path = findPath(this.movement, {
        start: creature.position,
        goal,
        exceptIds: this.exceptIds(creature),
        maxCost: WANDER_MAX_DIST * 3,
        footprint: this.fp(creature),
      });
      if (path && path.length > 0) {
        creature.state = 'WANDER';
        creature.path = path;
        creature.pathIndex = 0;
        creature.wanderSteps = Math.min(path.length, WANDER_MAX_STEPS);
        creature.wanderStartedAt = now;
        creature.stuckCount = 0;
        return;
      }
    }
  }

  // ------------------------------------------------------------ WANDER

  updateWander(creature: CreatureEntity, target: CreatureTarget | null, now: number) {
    if (target && (creature.definition.canChase || this.aggressive)) {
      this.switchState(creature, 'CHASE', now);
      return;
    }
    if (now - creature.wanderStartedAt > WANDER_TIMEOUT_MS) {
      this.switchState(creature, 'IDLE', now);
      return;
    }
    if (creature.pathIndex >= creature.wanderSteps || creature.pathIndex >= creature.path.length) {
      this.switchState(creature, 'IDLE', now);
      return;
    }
    this.stepAlongPath(creature, now, this.exceptIds(creature));
  }

  // ------------------------------------------------------------ CHASE

  updateChase(creature: CreatureEntity, target: CreatureTarget | null, now: number) {
    if (!target || target.health <= 0) {
      if (creature.targetId) creature.targetId = null;
      if (creature.definition.returnToSpawn && tileDistance(creature.position, creature.spawnPosition) > 1) {
        this.switchState(creature, 'RETURN', now);
      } else {
        this.switchState(creature, 'IDLE', now);
      }
      return;
    }

    const distToTarget = tileDistance(creature.position, target.position);

    if (this.isRanged(creature)) {
      this.updateChaseRanged(creature, target, now, distToTarget);
      return;
    }

    if (distToTarget <= this.effectiveAttackRange(creature)) {
      this.faceToward(creature, target.position);
      this.switchState(creature, 'ATTACK', now);
      creature.blockedSince = 0;
      return;
    }

    if (!this.aggressive && tileDistance(creature.position, creature.spawnPosition) > creature.definition.chaseRange) {
      creature.targetId = null;
      if (creature.definition.returnToSpawn) {
        this.switchState(creature, 'RETURN', now);
      } else {
        this.switchState(creature, 'IDLE', now);
      }
      return;
    }

    this.ensurePath(creature, target.position, now, this.exceptIds(creature, target));
    this.stepAndHandleBlock(creature, target, now);
  }

  /** Chase de criaturas ranged: mantém distância preferida (não cola no alvo). */
  private updateChaseRanged(creature: CreatureEntity, target: CreatureTarget, now: number, distToTarget: number) {
    if (distToTarget > this.effectiveAttackRange(creature)) {
      this.ensurePath(creature, target.position, now, this.exceptIds(creature, target));
      this.stepAndHandleBlock(creature, target, now);
      return;
    }
    if (distToTarget < RANGED_PREFERRED_MIN) {
      this.retreatStep(creature, target.position, now, this.exceptIds(creature, target));
      return;
    }
    this.faceToward(creature, target.position);
    this.switchState(creature, 'ATTACK', now);
    creature.blockedSince = 0;
  }

  /** Um passo no path; rastreia bloqueio persistente e reavalia o alvo. */
  private stepAndHandleBlock(creature: CreatureEntity, target: CreatureTarget, now: number) {
    const exceptIds = this.exceptIds(creature, target);
    const moved = this.stepAlongPath(creature, now, exceptIds);
    if (moved) {
      creature.blockedSince = 0;
      return;
    }
    if (!creature.blockedSince) creature.blockedSince = now;
    this.attemptGreedyStep(creature, target.position, now, exceptIds);
    if (now - creature.blockedSince > BLOCKED_RETARGET_THRESHOLD_MS) {
      creature.targetId = null;
      creature.blockedSince = 0;
      creature.path = [];
      creature.pathIndex = 0;
    }
  }

  /** Passo greedy para longe da ameaça (ranged perto demais). */
  private retreatStep(creature: CreatureEntity, threat: Position, now: number, exceptIds: Iterable<string>): boolean {
    if (now < creature.lastMoveAt) return false;
    const fp = this.fp(creature);
    const cur = Math.hypot(creature.position.x - threat.x, creature.position.y - threat.y);
    let bestDir: Direction | null = null;
    let bestGain = 0;
    for (const dir of ALL_DIRECTIONS) {
      if (!this.movement.canMove(creature.position, dir, exceptIds, fp)) continue;
      const next = this.movement.step(creature.position, dir);
      const gain = Math.hypot(next.x - threat.x, next.y - threat.y) - cur;
      if (gain > bestGain) {
        bestGain = gain;
        bestDir = dir;
      }
    }
    if (!bestDir) return false;
    const goal = this.movement.step(creature.position, bestDir);
    this.movement.reserve(goal, creature.id, TILE_RESERVE_TTL_MS, fp);
    this.applyMove(creature, bestDir, now);
    return true;
  }

  /** Recalcula o caminho apenas quando necessário. */
  private ensurePath(creature: CreatureEntity, goal: Position, now: number, exceptIds: Iterable<string>) {
    const needRecalc =
      creature.path.length === 0 ||
      creature.pathIndex >= creature.path.length ||
      now - creature.lastPathCalcAt > PATH_RECALCULATION_INTERVAL + creature.repathJitterMs ||
      (creature.lastChaseTargetPos &&
        tileDistance(creature.lastChaseTargetPos, goal) >= PATH_RECALC_TARGET_DELTA) ||
      creature.stuckCount >= CREATURE_STUCK_LIMIT;

    if (!needRecalc) return;

    const path = findPath(this.movement, {
      start: creature.position,
      goal,
      exceptIds,
      maxCost: this.aggressive ? 1000 : creature.definition.chaseRange + creature.definition.viewRange,
      tieBreak: this.tieBreakSeed(creature),
      footprint: this.fp(creature),
    });
    creature.path = path ?? [];
    creature.pathIndex = 0;
    creature.lastPathCalcAt = now;
    creature.lastChaseTargetPos = { ...goal };
    creature.stuckCount = 0;
  }

  // ------------------------------------------------------------ ATTACK

  updateAttack(creature: CreatureEntity, target: CreatureTarget | null, now: number) {
    if (!target || target.health <= 0) {
      this.switchState(creature, 'CHASE', now);
      if (creature.targetId) creature.targetId = null;
      return;
    }
    const dist = tileDistance(creature.position, target.position);
    if (dist > this.effectiveAttackRange(creature)) {
      this.switchState(creature, 'CHASE', now);
      return;
    }
    if (this.isRanged(creature) && dist < RANGED_PREFERRED_MIN) {
      this.switchState(creature, 'CHASE', now);
      return;
    }
    this.faceToward(creature, target.position);
    if (now < creature.lastAttackAt + creature.definition.attackSpeed) return;

    creature.lastAttackAt = now;
    this.hooks.broadcast('creature.attack', {
      creatureId: creature.id,
      targetId: target.id,
      position: { ...creature.position },
      facing: creature.facing,
      timestamp: now,
    });

    const critical = Math.random() < 0.06;
    const raw = (creature.definition.attack - target.defense) * (0.9 + Math.random() * 0.2);
    let amount = Math.max(1, Math.round(raw));
    if (critical) amount = Math.round(amount * 1.5);

    this.hooks.onAttackPlayer(creature, target, amount, critical, now);
  }

  // ------------------------------------------------------------ FLEE

  updateFlee(creature: CreatureEntity, target: CreatureTarget | null, now: number) {
    if (!target || target.health <= 0) {
      this.switchState(creature, 'IDLE', now);
      return;
    }
    if (creature.healthPercent > creature.definition.fleeHealthPercent) {
      this.switchState(creature, 'CHASE', now);
      return;
    }
    if (now - creature.lastPathCalcAt > FLEE_RECALC_INTERVAL_MS || creature.path.length === 0) {
      creature.path = this.fleePath(creature, target.position);
      creature.pathIndex = 0;
      creature.lastPathCalcAt = now;
    }
    const moved = this.stepAlongPath(creature, now, this.exceptIds(creature, target));
    if (!moved && creature.path.length === 0) {
      // Sem caminho para fugir: tenta um passo para longe da ameaça.
      const away: Position = {
        x: clamp(creature.position.x + sign(creature.position.x - target.position.x) * FLEE_PREFERRED_DIST, 1, 62),
        y: clamp(creature.position.y + sign(creature.position.y - target.position.y) * FLEE_PREFERRED_DIST, 1, 62),
        z: creature.position.z,
      };
      this.attemptGreedyStep(creature, away, now, this.exceptIds(creature, target));
    }
  }

  private fleePath(creature: CreatureEntity, threat: Position): Position[] {
    const dx = sign(creature.position.x - threat.x);
    const dy = sign(creature.position.y - threat.y);
    const directions: Direction[] = [];
    if (dx !== 0 || dy !== 0) directions.push(directionFromDelta(dx, dy) ?? Direction.SOUTH);
    // Rotaciona o vetor de fuga em 45° para tentar alternativas.
    const base = ALL_DIRECTIONS.indexOf(directions[0]);
    for (let i = 1; i < 4; i++) {
      directions.push(ALL_DIRECTIONS[(base + i) % ALL_DIRECTIONS.length]);
    }
    for (const dir of directions) {
      const delta = DIRECTION_DELTAS[dir];
      const goal: Position = {
        x: clamp(creature.position.x + delta.dx * FLEE_PREFERRED_DIST, 1, 62),
        y: clamp(creature.position.y + delta.dy * FLEE_PREFERRED_DIST, 1, 62),
        z: creature.position.z,
      };
      if (!this.movement.isWalkable(goal)) continue;
      const path = findPath(this.movement, {
        start: creature.position,
        goal,
        exceptIds: this.exceptIds(creature),
        maxCost: FLEE_PREFERRED_DIST * 3,
        footprint: this.fp(creature),
      });
      if (path && path.length > 0) return path;
    }
    return [];
  }

  // ------------------------------------------------------------ RETURN

  updateReturn(creature: CreatureEntity, now: number) {
    if (tileDistance(creature.position, creature.spawnPosition) <= 1) {
      this.switchState(creature, 'IDLE', now);
      return;
    }
    if (creature.path.length === 0 || creature.pathIndex >= creature.path.length) {
      const path = findPath(this.movement, {
        start: creature.position,
        goal: creature.spawnPosition,
        exceptIds: this.exceptIds(creature),
        maxCost: creature.definition.chaseRange * 2,
        footprint: this.fp(creature),
      });
      creature.path = path ?? [];
      creature.pathIndex = 0;
    }
    const moved = this.stepAlongPath(creature, now, this.exceptIds(creature));
    if (!moved) {
      this.attemptGreedyStep(creature, creature.spawnPosition, now, this.exceptIds(creature));
    }
  }

  // ------------------------------------------------------------ movimento

  private stepAlongPath(creature: CreatureEntity, now: number, exceptIds: Iterable<string>): boolean {
    if (now < creature.lastMoveAt) return false;
    const goal = creature.path[creature.pathIndex];
    if (!goal) return false;
    const dir = directionFromDelta(sign(goal.x - creature.position.x), sign(goal.y - creature.position.y));
    if (!dir) return false;
    const fp = this.fp(creature);
    if (!this.movement.reserve(goal, creature.id, TILE_RESERVE_TTL_MS, fp)) {
      creature.stuckCount++;
      this.giveUpPathIfStuck(creature);
      return false;
    }
    if (this.movement.canMove(creature.position, dir, exceptIds, fp)) {
      this.applyMove(creature, dir, now);
      creature.pathIndex++;
      creature.stuckCount = 0;
      return true;
    }
    this.movement.releaseReservation(goal, creature.id, fp);
    creature.stuckCount++;
    this.giveUpPathIfStuck(creature);
    return false;
  }

  private giveUpPathIfStuck(creature: CreatureEntity) {
    if (creature.stuckCount >= CREATURE_STUCK_LIMIT) {
      creature.path = [];
      creature.pathIndex = 0;
      creature.stuckCount = 0;
    }
  }

  /** Movimento greedy de fallback (quando não há caminho calculado). */
  private attemptGreedyStep(creature: CreatureEntity, goal: Position, now: number, exceptIds: Iterable<string>) {
    if (now < creature.lastMoveAt) return;
    const dx = goal.x - creature.position.x;
    const dy = goal.y - creature.position.y;
    if (dx === 0 && dy === 0) return;
    const idealAngle = Math.atan2(dy, dx);
    const ordered = [...ALL_DIRECTIONS].sort((a, b) => {
      const da = Math.abs(angleDiff(Math.atan2(DIRECTION_DELTAS[a].dy, DIRECTION_DELTAS[a].dx), idealAngle));
      const db = Math.abs(angleDiff(Math.atan2(DIRECTION_DELTAS[b].dy, DIRECTION_DELTAS[b].dx), idealAngle));
      return da - db;
    });
    const fp = this.fp(creature);
    for (const dir of ordered) {
      const next = this.movement.step(creature.position, dir);
      if (!this.movement.canMove(creature.position, dir, exceptIds, fp)) continue;
      this.movement.reserve(next, creature.id, TILE_RESERVE_TTL_MS, fp);
      this.applyMove(creature, dir, now);
      return;
    }
  }

  private faceToward(creature: CreatureEntity, position: Position) {
    const dir = directionFromDelta(sign(position.x - creature.position.x), sign(position.y - creature.position.y));
    if (dir) creature.facing = dir;
  }

  private applyMove(creature: CreatureEntity, dir: Direction, now: number) {
    const from = { ...creature.position };
    const to = this.movement.step(from, dir);
    this.movement.commitMove(creature.id, from, to, this.fp(creature));
    creature.position = to;
    creature.facing = dir;
    creature.lastMoveAt = now + creature.definition.movementSpeed;
    const payload: Record<string, unknown> = {
      creatureId: creature.id,
      from,
      to: { ...creature.position },
      facing: dir,
      state: creature.state,
      timestamp: now,
    };
    if (debugCreatures()) {
      payload.path = creature.path.slice(creature.pathIndex);
      payload.targetId = creature.targetId;
      payload.blocked = creature.blockedSince > 0;
      payload.targetPosition = creature.debugTargetPos;
      payload.score = creature.debugScore;
    }
    this.hooks.broadcast('creature.move', payload);
  }
}

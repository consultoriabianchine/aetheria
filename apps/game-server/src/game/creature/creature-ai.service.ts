import {
  CREATURE_REGENERATION_PER_TICK,
  CREATURE_STUCK_LIMIT,
  FLEE_PREFERRED_DIST,
  PATH_RECALC_TARGET_DELTA,
  PATH_RECALCULATION_INTERVAL,
  TICK_MS,
  WANDER_CHANCE_PER_TICK,
  WANDER_MAX_DIST,
  WANDER_MAX_STEPS,
  WANDER_MIN_DIST,
  debugCreatures,
} from '@aetheria/config';
import { samePosition, tileDistance } from '@aetheria/shared';
import type { CreatureState, Position } from '@aetheria/types';
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
}

export interface CreatureAIHooks {
  movement: MovementService;
  getPlayers(): Iterable<CreatureTarget>;
  getPlayerById(id: string): CreatureTarget | null;
  /** Transmite para todos os jogadores conectados. */
  broadcast(event: string, data: unknown): void;
  /** A criatura acertou um jogador: aplica dano, atualiza HP e trata morte. */
  onAttackPlayer(creature: CreatureEntity, target: CreatureTarget, amount: number, critical: boolean, now: number): void;
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

  /** Jogadores no mesmo andar dentro de viewRange (distância Chebyshev). */
  playersInView(creature: CreatureEntity, range: number): CreatureTarget[] {
    const out: CreatureTarget[] = [];
    for (const p of this.hooks.getPlayers()) {
      if (p.health <= 0) continue;
      if (p.position.z !== creature.position.z) continue;
      if (tileDistance(creature.position, p.position) <= range) out.push(p);
    }
    return out;
  }

  private nearestPlayerInView(creature: CreatureEntity, range: number): CreatureTarget | null {
    let best: CreatureTarget | null = null;
    let bestDist = Infinity;
    for (const p of this.playersInView(creature, range)) {
      const d = tileDistance(creature.position, p.position);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  /** Jogador mais próximo no mesmo andar, sem limite de alcance (modo agressivo). */
  private nearestPlayer(creature: CreatureEntity): CreatureTarget | null {
    let best: CreatureTarget | null = null;
    let bestDist = Infinity;
    for (const p of this.hooks.getPlayers()) {
      if (p.health <= 0) continue;
      if (p.position.z !== creature.position.z) continue;
      const d = tileDistance(creature.position, p.position);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
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
    if (!target) {
      const detected = this.aggressive
        ? this.nearestPlayer(creature)
        : creature.definition.canChase
          ? this.nearestPlayerInView(creature, creature.definition.viewRange)
          : null;
      if (detected) {
        creature.targetId = detected.id;
        return detected;
      }
    }
    return target;
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
    this.stepAlongPath(creature, now);
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
    if (distToTarget <= creature.definition.attackRange) {
      this.switchState(creature, 'ATTACK', now);
      return;
    }

    if (!this.aggressive) {
      const distToSpawn = tileDistance(creature.position, creature.spawnPosition);
      if (distToSpawn > creature.definition.chaseRange) {
        creature.targetId = null;
        if (creature.definition.returnToSpawn) {
          this.switchState(creature, 'RETURN', now);
        } else {
          this.switchState(creature, 'IDLE', now);
        }
        return;
      }
    }

    this.ensurePath(creature, target.position, now, this.exceptIds(creature, target));
    const moved = this.stepAlongPath(creature, now);
    if (!moved) this.attemptGreedyStep(creature, target.position, now, this.exceptIds(creature, target));
  }

  /** Recalcula o caminho apenas quando necessário. */
  private ensurePath(creature: CreatureEntity, goal: Position, now: number, exceptIds: Iterable<string>) {
    const needRecalc =
      creature.path.length === 0 ||
      creature.pathIndex >= creature.path.length ||
      now - creature.lastPathCalcAt > PATH_RECALCULATION_INTERVAL ||
      (creature.lastChaseTargetPos &&
        tileDistance(creature.lastChaseTargetPos, goal) >= PATH_RECALC_TARGET_DELTA) ||
      creature.stuckCount >= CREATURE_STUCK_LIMIT;

    if (!needRecalc) return;

    const path = findPath(this.movement, {
      start: creature.position,
      goal,
      exceptIds,
      maxCost: this.aggressive ? 1000 : creature.definition.chaseRange + creature.definition.viewRange,
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
    if (dist > creature.definition.attackRange) {
      this.switchState(creature, 'CHASE', now);
      return;
    }
    if (now < creature.lastAttackAt + creature.definition.attackSpeed) return;

    creature.lastAttackAt = now;
    this.hooks.broadcast('creature.attack', {
      creatureId: creature.id,
      targetId: target.id,
      position: { ...creature.position },
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
    const moved = this.stepAlongPath(creature, now);
    if (!moved && creature.path.length === 0) {
      // Sem caminho para fugir: tenta um passo aleatório para não ficar preso.
      this.attemptGreedyStep(creature, target.position, now, this.exceptIds(creature, target));
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
      });
      creature.path = path ?? [];
      creature.pathIndex = 0;
    }
    const moved = this.stepAlongPath(creature, now);
    if (!moved) {
      this.attemptGreedyStep(creature, creature.spawnPosition, now, this.exceptIds(creature));
    }
  }

  // ------------------------------------------------------------ movimento

  private stepAlongPath(creature: CreatureEntity, now: number): boolean {
    if (now < creature.lastMoveAt) return false;
    const goal = creature.path[creature.pathIndex];
    if (!goal) return false;
    const dir = directionFromDelta(sign(goal.x - creature.position.x), sign(goal.y - creature.position.y));
    if (!dir) return false;
    if (this.movement.canMove(creature.position, dir, this.exceptIds(creature))) {
      this.applyMove(creature, dir, now);
      creature.pathIndex++;
      creature.stuckCount = 0;
      return true;
    }
    creature.stuckCount++;
    if (creature.stuckCount >= CREATURE_STUCK_LIMIT) {
      creature.path = [];
      creature.pathIndex = 0;
      creature.stuckCount = 0;
    }
    return false;
  }

  /** Movimento greedy de fallback (quando não há caminho calculado). */
  private attemptGreedyStep(creature: CreatureEntity, goal: Position, now: number, exceptIds: Iterable<string>) {
    if (now < creature.lastMoveAt) return;
    const dx = sign(goal.x - creature.position.x);
    const dy = sign(goal.y - creature.position.y);
    const candidates: Direction[] = [];
    if (dx !== 0) candidates.push(dx > 0 ? Direction.EAST : Direction.WEST);
    if (dy !== 0) candidates.push(dy > 0 ? Direction.SOUTH : Direction.NORTH);
    if (dx !== 0 && dy !== 0) candidates.push(directionFromDelta(dx, dy) as Direction);
    for (const dir of candidates) {
      if (this.movement.canMove(creature.position, dir, exceptIds)) {
        this.applyMove(creature, dir, now);
        return;
      }
    }
  }

  private applyMove(creature: CreatureEntity, dir: Direction, now: number) {
    const from = { ...creature.position };
    creature.position = this.movement.step(from, dir);
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
    if (debugCreatures()) payload.path = creature.path.slice(creature.pathIndex);
    this.hooks.broadcast('creature.move', payload);
  }
}
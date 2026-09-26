import { PLAYER_AI } from '@aetheria/config';
import { tileDistance } from '@aetheria/shared';
import type { CombatAbilityDefinition, PlayerCombatConfig, Position } from '@aetheria/types';
import { CreatureEntity } from '../creature/creature.entity';
import { ALL_DIRECTIONS, CARDINAL_DIRECTIONS, DIRECTION_DELTAS, Direction, directionFromDelta } from '../creature/direction';
import { findPath } from '../creature/pathfinding';
import type { GamePlayer } from '../engine/world';
import type { HuntRun } from '../hunts/hunt-engine';

interface PlayerPathState {
  path: Position[];
  index: number;
  goal: Position;
}

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

/**
 * IA de combate do personagem nas Hunts (arena). Decide alvo e movimento por
 * classe/configuração: mantém a distância configurada, ou fica parado (hold).
 * Ataque continua independente.
 */
export class PlayerCombatAIService {
  private paths = new Map<string, PlayerPathState>();
  private positioningAbilities = new Map<string, CombatAbilityDefinition[]>();

  setPositioningAbilities(characterId: string, abilities: CombatAbilityDefinition[]) {
    this.positioningAbilities.set(characterId, abilities);
  }

  /** Seleciona a criatura-alvo viva (mesmo andar) segundo o modo configurado. */
  selectTarget(creatures: Iterable<CreatureEntity>, player: GamePlayer): CreatureEntity | null {
    const mode: PlayerCombatConfig['targeting'] = player.combat.targeting;
    let best: CreatureEntity | null = null;
    let bestScore = mode === 'furthest' || mode === 'highestHp' ? -Infinity : Infinity;
    for (const c of creatures) {
      if (c.state === 'DEAD') continue;
      if (c.position.z !== player.position.z) continue;
      const d = tileDistance(player.position, c.position);
      let score: number;
      switch (mode) {
        case 'furthest':
          score = d;
          break;
        case 'lowestHp':
          score = c.health;
          break;
        case 'highestHp':
          score = c.health;
          break;
        default:
          score = d;
      }
      const better =
        mode === 'furthest' || mode === 'highestHp' ? score > bestScore : score < bestScore;
      if (better) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }

  /** Decide e executa um passo do jogador na arena. Retorna true se moveu. */
  update(player: GamePlayer, run: HuntRun, now: number): boolean {
    if (now < player.nextMoveAt) return false;
    const profile = PLAYER_AI[player.archetype];
    const movement = player.combat.movement;
    const configuredRange = player.combat.attackRange;
    const alive = [...run.creatures.getAll()].filter(
      (c) => c.state !== 'DEAD' && c.position.z === player.position.z,
    );

    if (movement === 'hold' && !player.combat.frontPositioning) {
      this.paths.delete(player.id);
      return false;
    }

    if (alive.length === 0) {
      if (movement === 'hold') {
        this.paths.delete(player.id);
        return false;
      }
      // Sem criaturas: recentraliza no meio da arena em vez de ficar preso na parede.
      return this.recenter(player, run, now);
    }

    const target = this.selectTarget(alive, player);
    if (!target) return false;
    const desiredDistance = configuredRange ?? profile.defaultDistance;
    const distance = tileDistance(player.position, target.position);

    if (player.combat.frontPositioning && (movement === 'hold' || distance === desiredDistance)) {
      const plan = this.bestFrontPlan(player, run, alive, target, movement === 'hold' ? undefined : desiredDistance);
      if (plan) {
        const facingChanged = player.facing !== plan.direction;
        player.facing = plan.direction;
        if (movement === 'hold' || plan.position.x === player.position.x && plan.position.y === player.position.y) {
          this.paths.delete(player.id);
          return false;
        }
        const moved = this.stepTo(player, run, plan.position, now, [player.id, target.id]);
        if (moved) player.facing = plan.direction;
        return moved || facingChanged;
      }
    }

    if (distance === desiredDistance) {
      this.paths.delete(player.id);
      return false;
    }
    if (distance > desiredDistance) {
      return this.stepTo(player, run, target.position, now, [player.id, target.id]);
    }
    // Recua um passo por vez para não ultrapassar a distância desejada.
    return this.stepAwayFrom(player, run, target.position, now);
  }

  private bestFrontPlan(
    player: GamePlayer,
    run: HuntRun,
    creatures: CreatureEntity[],
    target: CreatureEntity,
    desiredDistance?: number,
  ): { position: Position; direction: Direction; score: number } | null {
    const abilities = this.positioningAbilities.get(player.id)?.filter((ability) => ability.targetMode === 'directional');
    if (!abilities || abilities.length === 0) return null;

    const candidates: Position[] = [];
    const radius = desiredDistance === undefined ? 0 : 4;
    for (let y = player.position.y - radius; y <= player.position.y + radius; y++) {
      for (let x = player.position.x - radius; x <= player.position.x + radius; x++) {
        const position = { x, y, z: player.position.z };
        if (!run.movement.canOccupy(position, [player.id, target.id])) continue;
        if (desiredDistance !== undefined && tileDistance(position, target.position) !== desiredDistance) continue;
        if (x === player.position.x && y === player.position.y) {
          candidates.push(position);
          continue;
        }
        const path = findPath(run.movement, { start: player.position, goal: position, exceptIds: [player.id, target.id], maxCost: 20 });
        if (path?.length) candidates.push(position);
      }
    }

    let best: { position: Position; direction: Direction; score: number; travel: number } | null = null;
    for (const position of candidates) {
      for (const direction of CARDINAL_DIRECTIONS) {
        const score = this.frontScore(position, direction, creatures, abilities);
        const travel = tileDistance(player.position, position);
        if (!best || score > best.score || score === best.score && travel < best.travel) {
          best = { position, direction, score, travel };
        }
      }
    }
    return best && best.score > 0 ? best : null;
  }

  private frontScore(position: Position, direction: Direction, creatures: CreatureEntity[], abilities: CombatAbilityDefinition[]): number {
    const delta = DIRECTION_DELTAS[direction];
    const keys = new Set<string>();
    for (const ability of abilities) {
      const range = Math.max(1, ability.rangeTiles);
      const width = Math.max(1, ability.areaConfig?.width ?? 1);
      const shape = ability.areaConfig?.shape ?? 'line';
      for (let distance = 1; distance <= range; distance++) {
        const half = shape === 'cone' ? Math.max(0, Math.floor((width * distance) / 2)) : Math.floor((width - 1) / 2);
        for (let side = -half; side <= half; side++) {
          const x = position.x + delta.dx * distance + -delta.dy * side;
          const y = position.y + delta.dy * distance + delta.dx * side;
          keys.add(`${x},${y},${position.z}`);
        }
      }
    }
    return creatures.filter((creature) => keys.has(`${creature.position.x},${creature.position.y},${creature.position.z}`)).length;
  }

  private recenter(player: GamePlayer, run: HuntRun, now: number): boolean {
    if (!run.arena) return false;
    const center = {
      x: Math.floor(run.arena.width / 2),
      y: Math.floor(run.arena.height / 2),
      z: player.position.z,
    };
    if (tileDistance(player.position, center) <= 1) {
      this.paths.delete(player.id);
      return false;
    }
    return this.stepTo(player, run, center, now);
  }

  private stepTo(
    player: GamePlayer,
    run: HuntRun,
    goal: Position,
    now: number,
    exceptIds: Iterable<string> = [player.id],
  ): boolean {
    const movement = run.movement;
    if (!movement.isWalkable(goal)) return false;
    const key = player.id;
    const cached = this.paths.get(key);
    const stale =
      !cached ||
      cached.goal.x !== goal.x ||
      cached.goal.y !== goal.y ||
      cached.goal.z !== goal.z ||
      cached.index >= cached.path.length;

    if (stale) {
      const path = findPath(movement, { start: player.position, goal, exceptIds, maxCost: 80 });
      if (!path || path.length === 0) {
        this.paths.delete(key);
        return false;
      }
      this.paths.set(key, { path, index: 0, goal: { ...goal } });
    }

    const state = this.paths.get(key);
    if (!state) return false;
    const next = state.path[state.index];
    if (!next) {
      this.paths.delete(key);
      return false;
    }
    const dir = directionFromDelta(sign(next.x - player.position.x), sign(next.y - player.position.y));
    if (!dir) {
      state.index++;
      return false;
    }
    if (movement.canMove(player.position, dir, exceptIds)) {
      const from = { ...player.position };
      player.position = movement.step(player.position, dir);
      movement.commitMove(player.id, from, player.position);
      player.facing = dir;
      player.nextMoveAt = now + player.moveIntervalMs;
      state.index++;
      return true;
    }
    this.paths.delete(key);
    return false;
  }

  /** Melhor passo que aumenta a distância euclidiana da ameaça (desvia de parede). */
  private stepAwayFrom(player: GamePlayer, run: HuntRun, threat: Position, now: number): boolean {
    const movement = run.movement;
    const cur = Math.hypot(player.position.x - threat.x, player.position.y - threat.y);
    let bestDir: Direction | null = null;
    let bestGain = 0;
    for (const dir of ALL_DIRECTIONS) {
      if (!movement.canMove(player.position, dir, [player.id])) continue;
      const next = movement.step(player.position, dir);
      const gain = Math.hypot(next.x - threat.x, next.y - threat.y) - cur;
      if (gain > bestGain) {
        bestGain = gain;
        bestDir = dir;
      }
    }
    if (!bestDir) return false;
    const from = { ...player.position };
    player.position = movement.step(player.position, bestDir);
    movement.commitMove(player.id, from, player.position);
    player.facing = bestDir;
    player.nextMoveAt = now + player.moveIntervalMs;
    return true;
  }

  clear(characterId: string) {
    this.paths.delete(characterId);
    this.positioningAbilities.delete(characterId);
  }
}

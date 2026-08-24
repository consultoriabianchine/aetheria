import { PLAYER_AI } from '@aetheria/config';
import { tileDistance } from '@aetheria/shared';
import type { PlayerCombatConfig, Position } from '@aetheria/types';
import { CreatureEntity } from '../creature/creature.entity';
import { ALL_DIRECTIONS, Direction, directionFromDelta } from '../creature/direction';
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
 * classe/configuração: warrior engaja melee, mage/archer fazem kite (recuam via
 * A* enquanto atacam), ou ficam parados (hold). Ataque continua independente.
 */
export class PlayerCombatAIService {
  private paths = new Map<string, PlayerPathState>();

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
  update(player: GamePlayer, run: HuntRun, now: number, attackRange?: number): boolean {
    if (now < player.nextMoveAt) return false;
    const profile = PLAYER_AI[player.archetype];
    const movement = player.combat.movement;
    const alive = [...run.creatures.getAll()].filter(
      (c) => c.state !== 'DEAD' && c.position.z === player.position.z,
    );

    if (movement === 'hold') {
      this.paths.delete(player.id);
      return false;
    }

    if (alive.length === 0) {
      // Sem criaturas: recentraliza no meio da arena em vez de ficar preso na parede.
      return this.recenter(player, run, now);
    }

    if (movement === 'engage') {
      const target = this.selectTarget(alive, player);
      if (!target) return false;
      if (tileDistance(player.position, target.position) <= profile.engageRange) {
        this.paths.delete(player.id);
        return false;
      }
      return this.stepTo(player, run, target.position, now, [player.id, target.id]);
    }

    // kite: foge da criatura mais próxima (ameaça) quando dentro da zona de perigo.
    const threat = this.nearestCreature(alive, player);
    if (!threat) return false;
    const kiteSafe = Math.max(profile.kiteDangerDist + 1, Math.min(profile.kiteSafeDist, attackRange ?? profile.kiteSafeDist));
    if (tileDistance(player.position, threat.position) >= kiteSafe) {
      this.paths.delete(player.id);
      return false;
    }
    const goal = this.retreatGoal(player.position, threat.position, kiteSafe);
    if (this.stepTo(player, run, goal, now)) return true;
    // Sem rota A* (parede/obstáculo no caminho) ou cercado: desvia pela parede.
    return this.stepAwayFrom(player, run, threat.position, now);
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

  private retreatGoal(from: Position, threat: Position, dist: number): Position {
    const dx = sign(from.x - threat.x);
    const dy = sign(from.y - threat.y);
    if (dx === 0 && dy === 0) {
      return { x: from.x, y: from.y - dist, z: from.z };
    }
    return { x: from.x + dx * dist, y: from.y + dy * dist, z: from.z };
  }

  private nearestCreature(creatures: CreatureEntity[], player: GamePlayer): CreatureEntity | null {
    let best: CreatureEntity | null = null;
    let bestDist = Infinity;
    for (const c of creatures) {
      const d = tileDistance(player.position, c.position);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
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
      player.position = movement.step(player.position, dir);
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
    player.position = movement.step(player.position, bestDir);
    player.facing = bestDir;
    player.nextMoveAt = now + player.moveIntervalMs;
    return true;
  }

  clear(characterId: string) {
    this.paths.delete(characterId);
  }
}

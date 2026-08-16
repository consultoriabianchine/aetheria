import { tileKey } from '@aetheria/shared';
import type { MapTile, Position } from '@aetheria/types';
import type { WorldMapData } from '../engine/world-map';
import { ALL_DIRECTIONS, DIRECTION_DELTAS, Direction } from './direction';

/** Resolve se uma posição está ocupada por outra entidade viva. */
export type OccupancyResolver = (position: Position, exceptIds?: Iterable<string>) => boolean;

/**
 * Responsável pela movimentação em tiles: colisão estática (mapa) e dinâmica
 * (entidades vivas). Servidor autoritativo — o cliente nunca move criaturas.
 */
export class MovementService {
  constructor(
    private readonly world: WorldMapData,
    private readonly resolveOccupied: OccupancyResolver = () => false,
  ) {}

  getTile(position: Position): MapTile | null {
    return this.world.byKey.get(tileKey(position.x, position.y, position.z)) ?? null;
  }

  inBounds(position: Position): boolean {
    return (
      position.z === this.world.z &&
      position.x >= 0 &&
      position.x < this.world.width &&
      position.y >= 0 &&
      position.y < this.world.height
    );
  }

  isWalkable(position: Position): boolean {
    const tile = this.getTile(position);
    return !!tile && tile.walkable;
  }

  isBlocked(position: Position): boolean {
    return !this.isWalkable(position);
  }

  canOccupy(position: Position, exceptIds?: Iterable<string>): boolean {
    return this.isWalkable(position) && !this.resolveOccupied(position, exceptIds);
  }

  canMove(from: Position, direction: Direction, exceptIds?: Iterable<string>): boolean {
    const next = this.step(from, direction);
    return this.canOccupy(next, exceptIds);
  }

  /** Posição resultante de um passo na direção. */
  step(from: Position, direction: Direction): Position {
    const delta = DIRECTION_DELTAS[direction];
    return { x: from.x + delta.dx, y: from.y + delta.dy, z: from.z };
  }

  /** Vizinhança de 8 direções (apenas tiles caminháveis e desocupados). */
  getNeighbours(position: Position, exceptIds?: Iterable<string>): Position[] {
    const out: Position[] = [];
    for (const dir of ALL_DIRECTIONS) {
      const n = this.step(position, dir);
      if (this.canOccupy(n, exceptIds)) out.push(n);
    }
    return out;
  }

  /**
   * Encontra o tile caminhável mais próximo (busca em anéis expansivos).
   * Usado para "fixar" coordenadas de spawn que caíram em obstáculo.
   */
  nearestWalkable(position: Position, maxRadius = 14): Position | null {
    if (this.isWalkable(position)) return { ...position };
    for (let r = 1; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const candidate = { x: position.x + dx, y: position.y + dy, z: position.z };
          if (this.isWalkable(candidate)) return candidate;
        }
      }
    }
    return null;
  }
}
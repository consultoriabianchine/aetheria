import { tileKey } from '@aetheria/shared';
import type { MapTile, Position } from '@aetheria/types';
import type { WorldMapData } from '../engine/world-map';
import { ALL_DIRECTIONS, DIRECTION_DELTAS, Direction } from './direction';
import { OccupancyGrid } from './occupancy-grid';

/** Resolve se uma posição está ocupada por outra entidade viva. */
export type OccupancyResolver = (position: Position, exceptIds?: Iterable<string>) => boolean;

/** Dimensões do footprint lógico (em tiles). Default 1×1. */
export interface Footprint {
  w: number;
  h: number;
}

export const UNIT_FOOTPRINT: Footprint = { w: 1, h: 1 };

/** Células cobertas por um footprint com âncora no canto noroeste. */
export function footprintCells(position: Position, footprint: Footprint = UNIT_FOOTPRINT): Position[] {
  const cells: Position[] = [];
  for (let dy = 0; dy < footprint.h; dy++) {
    for (let dx = 0; dx < footprint.w; dx++) {
      cells.push({ x: position.x + dx, y: position.y + dy, z: position.z });
    }
  }
  return cells;
}

/**
 * Responsável pela movimentação em tiles: colisão estática (mapa) e dinâmica
 * (entidades vivas), com suporte a footprint lógico (1×1 por padrão). Servidor
 * autoritativo — o cliente nunca move criaturas.
 *
 * Além da colisão, mantém um OccupancyGrid opcional para consultas O(1) e
 * reserva temporária de tiles de destino.
 */
export class MovementService {
  constructor(
    private readonly world: WorldMapData,
    private readonly resolveOccupied: OccupancyResolver = () => false,
    private readonly grid?: OccupancyGrid,
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

  /** Ocupação lógica (grid) do footprint, ignorando `exceptIds`. */
  isTileOccupied(position: Position, exceptIds?: Iterable<string>, footprint: Footprint = UNIT_FOOTPRINT): boolean {
    for (const cell of footprintCells(position, footprint)) {
      if (this.resolveOccupied(cell, exceptIds)) return true;
    }
    return false;
  }

  /** Reserva temporária do footprint por outra entidade. */
  isTileReserved(position: Position, exceptIds?: Iterable<string>, footprint: Footprint = UNIT_FOOTPRINT): boolean {
    if (!this.grid) return false;
    for (const cell of footprintCells(position, footprint)) {
      if (this.grid.isReserved(cell, exceptIds)) return true;
    }
    return false;
  }

  canOccupy(position: Position, exceptIds?: Iterable<string>, footprint: Footprint = UNIT_FOOTPRINT): boolean {
    for (const cell of footprintCells(position, footprint)) {
      if (!this.isWalkable(cell)) return false;
      if (this.resolveOccupied(cell, exceptIds)) return false;
      if (this.grid && this.grid.isReserved(cell, exceptIds)) return false;
    }
    return true;
  }

  canMove(from: Position, direction: Direction, exceptIds?: Iterable<string>, footprint: Footprint = UNIT_FOOTPRINT): boolean {
    const next = this.step(from, direction);
    return this.canOccupy(next, exceptIds, footprint);
  }

  // ---------------------------------------------------------- occupancy grid

  /** Ocupa o footprint (spawn/teleporte). No-op sem grid. */
  occupy(position: Position, id: string, footprint: Footprint = UNIT_FOOTPRINT): void {
    if (!this.grid) return;
    for (const cell of footprintCells(position, footprint)) this.grid.occupy(cell, id);
  }

  /** Libera toda ocupação/reserva da entidade. No-op sem grid. */
  releaseEntity(id: string): void {
    this.grid?.releaseEntity(id);
  }

  /** Reserva temporariamente o footprint para a entidade. Sem grid, sempre true. */
  reserve(position: Position, id: string, ttlMs: number, footprint: Footprint = UNIT_FOOTPRINT): boolean {
    if (!this.grid) return true;
    const cells = footprintCells(position, footprint);
    for (const cell of cells) {
      if (this.grid.isReserved(cell, [id]) || this.grid.isOccupied(cell, [id])) return false;
    }
    for (const cell of cells) this.grid.reserve(cell, id, ttlMs);
    return true;
  }

  /** Libera a reserva da entidade sobre o footprint. No-op sem grid. */
  releaseReservation(position: Position, id: string, footprint: Footprint = UNIT_FOOTPRINT): void {
    if (!this.grid) return;
    for (const cell of footprintCells(position, footprint)) this.grid.releaseReservation(cell, id);
  }

  /**
   * Move a entidade do footprint `from` para `to` de forma atômica: libera o
   * anterior, ocupa o novo e limpa a reserva do destino. No-op sem grid.
   */
  commitMove(id: string, from: Position, to: Position, footprint: Footprint = UNIT_FOOTPRINT): void {
    if (!this.grid) return;
    for (const cell of footprintCells(from, footprint)) this.grid.release(cell, id);
    for (const cell of footprintCells(to, footprint)) {
      this.grid.occupy(cell, id);
      this.grid.releaseReservation(cell, id);
    }
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

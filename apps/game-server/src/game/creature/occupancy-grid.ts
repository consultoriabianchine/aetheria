import { tileKey } from '@aetheria/shared';
import type { Position } from '@aetheria/types';

/**
 * Grade de ocupação do mundo: rastreia, por tile, quais entidades o ocupam e
 * quais tiles estão temporariamente reservados (destino de um movimento em
 * curso). Substitui varreduras O(N) por consultas O(1) por tile.
 *
 * Um tile pode conter múltiplas entidades (Set) — a colisão é resolvida por
 * `isOccupied`/`isReserved` ignorando os ids de `exceptIds`.
 */
export class OccupancyGrid {
  private occupied = new Map<string, Set<string>>();
  private reserved = new Map<string, { id: string; expiresAt: number }>();
  private entityTiles = new Map<string, Set<string>>();
  private entityReservation = new Map<string, string>();

  /** Marca um tile como ocupado por uma entidade. */
  occupy(position: Position, id: string): void {
    const key = tileKey(position.x, position.y, position.z);
    let set = this.occupied.get(key);
    if (!set) {
      set = new Set();
      this.occupied.set(key, set);
    }
    set.add(id);
    let tiles = this.entityTiles.get(id);
    if (!tiles) {
      tiles = new Set();
      this.entityTiles.set(id, tiles);
    }
    tiles.add(key);
  }

  /** Libera a ocupação de um tile específico pela entidade. */
  release(position: Position, id: string): void {
    const key = tileKey(position.x, position.y, position.z);
    const set = this.occupied.get(key);
    if (set) {
      set.delete(id);
      if (set.size === 0) this.occupied.delete(key);
    }
    this.entityTiles.get(id)?.delete(key);
  }

  /** Libera toda ocupação e reserva da entidade (morte/teleporte/remoção). */
  releaseEntity(id: string): void {
    const tiles = this.entityTiles.get(id);
    if (tiles) {
      for (const key of tiles) {
        const set = this.occupied.get(key);
        if (set) {
          set.delete(id);
          if (set.size === 0) this.occupied.delete(key);
        }
      }
      this.entityTiles.delete(id);
    }
    const reservedKey = this.entityReservation.get(id);
    if (reservedKey) {
      this.reserved.delete(reservedKey);
      this.entityReservation.delete(id);
    }
  }

  /** true se o tile possui alguma entidade viva (exceto as de `exceptIds`). */
  isOccupied(position: Position, exceptIds?: Iterable<string>): boolean {
    const set = this.occupied.get(tileKey(position.x, position.y, position.z));
    if (!set) return false;
    const except = new Set(exceptIds ?? []);
    for (const id of set) if (!except.has(id)) return true;
    return false;
  }

  /**
   * Reserva o tile para a entidade. Falha se outro já reservou ou se há outra
   * entidade ocupando o tile.
   */
  reserve(position: Position, id: string, ttlMs: number, now = Date.now()): boolean {
    const key = tileKey(position.x, position.y, position.z);
    const existing = this.reserved.get(key);
    if (existing && existing.id !== id && existing.expiresAt > now) return false;
    if (this.isOccupied(position, [id])) return false;
    this.reserved.set(key, { id, expiresAt: now + ttlMs });
    this.entityReservation.set(id, key);
    return true;
  }

  /** true se o tile está reservado por outra entidade (não expirada). */
  isReserved(position: Position, exceptIds?: Iterable<string>, now = Date.now()): boolean {
    const reserved = this.reserved.get(tileKey(position.x, position.y, position.z));
    if (!reserved) return false;
    const except = new Set(exceptIds ?? []);
    if (except.has(reserved.id)) return false;
    return reserved.expiresAt > now;
  }

  /** Libera a reserva da entidade sobre o tile. */
  releaseReservation(position: Position, id: string): void {
    const key = tileKey(position.x, position.y, position.z);
    const reserved = this.reserved.get(key);
    if (reserved && reserved.id === id) {
      this.reserved.delete(key);
      this.entityReservation.delete(id);
    }
  }

  /** Remove reservas expiradas (limpeza periódica). */
  expireReservations(now: number): void {
    for (const [key, reserved] of this.reserved) {
      if (reserved.expiresAt <= now) {
        this.reserved.delete(key);
        this.entityReservation.delete(reserved.id);
      }
    }
  }
}

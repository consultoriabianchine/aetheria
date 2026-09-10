import { describe, expect, it } from 'vitest';
import { OccupancyGrid } from '../src/game/creature/occupancy-grid';
import { MovementService } from '../src/game/creature/movement.service';
import type { WorldMapData } from '../src/game/engine/world-map';
import type { MapTile, Position } from '@aetheria/types';
import { tileKey } from '@aetheria/shared';

function makeWorld(width = 5, height = 5, z = 0): WorldMapData {
  const tiles: MapTile[] = [];
  const byKey = new Map<string, MapTile>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile: MapTile = { x, y, z, type: 0, walkable: true, blocksVision: false };
      tiles.push(tile);
      byKey.set(tileKey(x, y, z), tile);
    }
  }
  return { tiles, width, height, z, byKey };
}

const pos = (x: number, y: number, z = 0): Position => ({ x, y, z });

describe('OccupancyGrid', () => {
  it('ocupa e detecta ocupação', () => {
    const grid = new OccupancyGrid();
    grid.occupy(pos(2, 2), 'a');
    expect(grid.isOccupied(pos(2, 2))).toBe(true);
    expect(grid.isOccupied(pos(3, 3))).toBe(false);
  });

  it('ignora os ids de exceptIds na consulta de ocupação', () => {
    const grid = new OccupancyGrid();
    grid.occupy(pos(2, 2), 'a');
    expect(grid.isOccupied(pos(2, 2), ['a'])).toBe(false);
    expect(grid.isOccupied(pos(2, 2), ['b'])).toBe(true);
  });

  it('release libera apenas o tile indicado', () => {
    const grid = new OccupancyGrid();
    grid.occupy(pos(2, 2), 'a');
    grid.occupy(pos(3, 3), 'a');
    grid.release(pos(2, 2), 'a');
    expect(grid.isOccupied(pos(2, 2))).toBe(false);
    expect(grid.isOccupied(pos(3, 3))).toBe(true);
  });

  it('releaseEntity limpa toda ocupação e reserva da entidade', () => {
    const grid = new OccupancyGrid();
    grid.occupy(pos(2, 2), 'a');
    grid.reserve(pos(3, 3), 'a', 1000);
    grid.releaseEntity('a');
    expect(grid.isOccupied(pos(2, 2))).toBe(false);
    expect(grid.isReserved(pos(3, 3))).toBe(false);
  });

  it('primeira reserva vence; segunda falha', () => {
    const grid = new OccupancyGrid();
    expect(grid.reserve(pos(4, 4), 'a', 1000)).toBe(true);
    expect(grid.reserve(pos(4, 4), 'b', 1000)).toBe(false);
  });

  it('não reserva tile ocupado por outra entidade', () => {
    const grid = new OccupancyGrid();
    grid.occupy(pos(4, 4), 'a');
    expect(grid.reserve(pos(4, 4), 'b', 1000)).toBe(false);
  });

  it('isReserved ignora o próprio id e expira após o TTL', () => {
    const grid = new OccupancyGrid();
    grid.reserve(pos(4, 4), 'a', 1000, 0);
    expect(grid.isReserved(pos(4, 4), [], 500)).toBe(true);
    expect(grid.isReserved(pos(4, 4), ['a'], 500)).toBe(false);
    expect(grid.isReserved(pos(4, 4), [], 1001)).toBe(false);
  });

  it('releaseReservation libera apenas a própria reserva', () => {
    const grid = new OccupancyGrid();
    grid.reserve(pos(4, 4), 'a', 1000);
    grid.releaseReservation(pos(4, 4), 'a');
    expect(grid.isReserved(pos(4, 4))).toBe(false);
  });
});

describe('MovementService (com OccupancyGrid)', () => {
  it('canOccupy bloqueia tile reservado por outra entidade', () => {
    const world = makeWorld();
    const grid = new OccupancyGrid();
    const movement = new MovementService(world, (p, e) => grid.isOccupied(p, e), grid);
    grid.reserve(pos(2, 2), 'a', 1000);
    expect(movement.canOccupy(pos(2, 2), ['b'])).toBe(false);
    expect(movement.canOccupy(pos(2, 2), ['a'])).toBe(true);
  });

  it('commitMove ocupa o destino e libera a origem', () => {
    const world = makeWorld();
    const grid = new OccupancyGrid();
    const movement = new MovementService(world, (p, e) => grid.isOccupied(p, e), grid);
    grid.occupy(pos(2, 2), 'a');
    grid.reserve(pos(2, 3), 'a', 1000);
    movement.commitMove('a', pos(2, 2), pos(2, 3));
    expect(grid.isOccupied(pos(2, 2))).toBe(false);
    expect(grid.isOccupied(pos(2, 3))).toBe(true);
    expect(grid.isReserved(pos(2, 3))).toBe(false);
  });

  it('sem grid, reserve/commit são no-op e não quebram o movimento', () => {
    const movement = new MovementService(makeWorld());
    expect(movement.reserve(pos(2, 2), 'a', 1000)).toBe(true);
    expect(() => movement.commitMove('a', pos(2, 2), pos(2, 3))).not.toThrow();
  });

  it('footprint 2x2 ocupa/bloqueia todas as células do retângulo', () => {
    const world = makeWorld(6, 6);
    const grid = new OccupancyGrid();
    const movement = new MovementService(world, (p, e) => grid.isOccupied(p, e), grid);
    const footprint = { w: 2, h: 2 };
    movement.occupy(pos(2, 2), 'a', footprint);
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) {
      expect(movement.isTileOccupied(pos(x, y))).toBe(true);
    }
    expect(movement.isTileOccupied(pos(4, 2))).toBe(false);
    // Outra entidade não entra em nenhuma célula do footprint.
    expect(movement.canOccupy(pos(3, 3), ['b'])).toBe(false);
    expect(movement.canOccupy(pos(4, 4), ['b'])).toBe(true);
  });

  it('commitMove com footprint libera a origem e ocupa o destino completo', () => {
    const world = makeWorld(8, 8);
    const grid = new OccupancyGrid();
    const movement = new MovementService(world, (p, e) => grid.isOccupied(p, e), grid);
    const footprint = { w: 2, h: 2 };
    movement.occupy(pos(2, 2), 'a', footprint);
    movement.commitMove('a', pos(2, 2), pos(4, 4), footprint);
    expect(movement.isTileOccupied(pos(2, 2))).toBe(false);
    expect(movement.isTileOccupied(pos(4, 4))).toBe(true);
    expect(movement.isTileOccupied(pos(5, 5))).toBe(true);
  });
});

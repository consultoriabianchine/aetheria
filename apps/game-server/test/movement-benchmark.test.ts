import { describe, expect, it } from 'vitest';
import type { CreatureTarget } from '../src/game/creature/creature-ai.service';
import { CreatureAIService } from '../src/game/creature/creature-ai.service';
import { CreatureEntity } from '../src/game/creature/creature.entity';
import { MovementService } from '../src/game/creature/movement.service';
import { OccupancyGrid } from '../src/game/creature/occupancy-grid';
import type { WorldMapData } from '../src/game/engine/world-map';
import type { CreatureDefinition, MapTile } from '@aetheria/types';
import { tileKey } from '@aetheria/shared';

function makeWorld(width: number, height: number, z = 0): WorldMapData {
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

function makeDefinition(overrides: Partial<CreatureDefinition> = {}): CreatureDefinition {
  return {
    id: 'bench',
    name: 'Bench',
    slug: 'bench',
    description: '',
    type: 'humanoid',
    level: 1,
    health: 100,
    maxHealth: 100,
    attack: 10,
    defense: 0,
    experience: 25,
    movementSpeed: 200,
    attackSpeed: 1000,
    attackRange: 1,
    viewRange: 8,
    chaseRange: 12,
    fleeHealthPercent: 0,
    canWander: false,
    canChase: true,
    canFlee: false,
    returnToSpawn: false,
    footprintWidth: 1,
    footprintHeight: 1,
    loot: [],
    ...overrides,
  };
}

const enabled = process.env.BENCH === '1';

describe.skipIf(!enabled)('movement benchmark', () => {
  it('pack de 100 criaturas perseguindo 1 jogador', () => {
    const width = 48;
    const height = 32;
    const world = makeWorld(width, height);
    const grid = new OccupancyGrid();
    const movement = new MovementService(world, (p, e) => grid.isOccupied(p, e), grid);
    const player: CreatureTarget = {
      id: 'p1',
      position: { x: 8, y: 8, z: 0 },
      socketId: 's',
      health: 10_000,
      defense: 0,
      archetype: 'warrior',
    };
    let moves = 0;
    const ai = new CreatureAIService(
      {
        movement,
        getPlayers: () => [player],
        getPlayerById: (id) => (id === 'p1' ? player : null),
        broadcast: (event) => {
          if (event === 'creature.move') moves++;
        },
        onAttackPlayer: () => {},
      },
      { aggressive: true },
    );

    const count = 100;
    const creatures: CreatureEntity[] = [];
    for (let i = 0; i < count; i++) {
      const x = width - 4 - (i % 8);
      const y = 3 + Math.floor(i / 8) * 3;
      const position = { x, y, z: 0 };
      const creature = new CreatureEntity(`c${i}`, makeDefinition(), position);
      movement.occupy(position, creature.id);
      creatures.push(creature);
    }

    const ticks = 40;
    const start = performance.now();
    let now = 0;
    for (let t = 0; t < ticks; t++) {
      now += 50;
      for (const creature of creatures) ai.update(creature, now);
    }
    const elapsed = performance.now() - start;

    console.log(
      `[benchmark] criaturas=${count} ticks=${ticks} moves=${moves} ` +
        `tempo=${elapsed.toFixed(1)}ms ms/tick=${(elapsed / ticks).toFixed(2)} ` +
        `moves/s=${(moves / (elapsed / 1000)).toFixed(0)}`,
    );

    expect(moves).toBeGreaterThan(0);
  });
});

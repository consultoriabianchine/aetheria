import { describe, expect, it } from 'vitest';
import type { CombatAbilityDefinition, CreatureDefinition, PlayerCombatConfig, Position } from '@aetheria/types';
import { tileKey, tileDistance } from '@aetheria/shared';
import { PlayerCombatAIService } from '../src/game/combat/player-combat-ai';
import { CreatureManager } from '../src/game/creature/creature-manager.service';
import { MovementService } from '../src/game/creature/movement.service';
import type { WorldMapData } from '../src/game/engine/world-map';
import type { GamePlayer } from '../src/game/engine/world';
import type { HuntRun } from '../src/game/hunts/hunt-engine';
import type { MapTile } from '@aetheria/types';

function makeWorld(width = 12, height = 12, z = 0): WorldMapData {
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
    id: 'test',
    name: 'Test Creature',
    slug: 'test-creature',
    description: '',
    type: 'humanoid',
    level: 1,
    health: 100,
    maxHealth: 100,
    attack: 10,
    defense: 0,
    experience: 25,
    movementSpeed: 200,
    attackSpeed: 500,
    attackRange: 1,
    viewRange: 5,
    chaseRange: 8,
    fleeHealthPercent: 20,
    canWander: false,
    canChase: true,
    canFlee: false,
    returnToSpawn: true,
    loot: [],
    ...overrides,
  };
}

function makePlayer(archetype: GamePlayer['archetype'], combat: PlayerCombatConfig, position: Position): GamePlayer {
  return {
    id: 'player-1',
    archetype,
    position: { ...position },
    combat: { ...combat },
    facing: 'south',
    nextMoveAt: 0,
  } as unknown as GamePlayer;
}

function makeRun(width = 12, height = 12): { run: HuntRun; movement: MovementService; creatures: CreatureManager } {
  let creatures!: CreatureManager;
  const movement = new MovementService(makeWorld(width, height), (position, exceptIds) => {
    const except = new Set(exceptIds ?? []);
    for (const c of creatures.getAll()) {
      if (c.state === 'DEAD') continue;
      if (except.has(c.id)) continue;
      if (c.position.x === position.x && c.position.y === position.y && c.position.z === position.z) return true;
    }
    return false;
  });
  creatures = new CreatureManager(movement);
  const run = { movement, creatures, arena: { width, height } } as unknown as HuntRun;
  return { run, movement, creatures };
}

describe('PlayerCombatAIService.selectTarget', () => {
  it('seleciona pela distância (nearest/furthest)', () => {
    const { run, creatures } = makeRun();
    const near = creatures.spawnCreature(makeDefinition(), { x: 5, y: 6, z: 0 });
    const far = creatures.spawnCreature(makeDefinition(), { x: 5, y: 10, z: 0 });
    const ai = new PlayerCombatAIService();

    const pNear = makePlayer('warrior', { targeting: 'nearest', movement: 'maintainDistance' }, { x: 5, y: 5, z: 0 });
    expect(ai.selectTarget(run.creatures.getAll(), pNear)?.id).toBe(near.id);

    const pFar = makePlayer('warrior', { targeting: 'furthest', movement: 'maintainDistance' }, { x: 5, y: 5, z: 0 });
    expect(ai.selectTarget(run.creatures.getAll(), pFar)?.id).toBe(far.id);
  });

  it('seleciona por HP (lowestHp/highestHp)', () => {
    const { run, creatures } = makeRun();
    const low = creatures.spawnCreature(makeDefinition(), { x: 5, y: 6, z: 0 });
    const high = creatures.spawnCreature(makeDefinition(), { x: 5, y: 7, z: 0 });
    low.health = 10;
    high.health = 90;
    const ai = new PlayerCombatAIService();

    const pLow = makePlayer('mage', { targeting: 'lowestHp', movement: 'maintainDistance' }, { x: 5, y: 5, z: 0 });
    expect(ai.selectTarget(run.creatures.getAll(), pLow)?.id).toBe(low.id);

    const pHigh = makePlayer('mage', { targeting: 'highestHp', movement: 'maintainDistance' }, { x: 5, y: 5, z: 0 });
    expect(ai.selectTarget(run.creatures.getAll(), pHigh)?.id).toBe(high.id);
  });
});

describe('PlayerCombatAIService.update', () => {
  it('no modo parado apenas aponta para a maior concentração frontal', () => {
    const { run, creatures } = makeRun();
    creatures.spawnCreature(makeDefinition(), { x: 7, y: 5, z: 0 });
    creatures.spawnCreature(makeDefinition(), { x: 7, y: 6, z: 0 });
    creatures.spawnCreature(makeDefinition(), { x: 3, y: 5, z: 0 });
    const player = makePlayer('mage', { targeting: 'nearest', movement: 'hold', frontPositioning: true }, { x: 5, y: 5, z: 0 });
    const ability = { targetMode: 'directional', rangeTiles: 4, areaConfig: { shape: 'line', width: 3, height: 1 } } as CombatAbilityDefinition;
    const ai = new PlayerCombatAIService();
    ai.setPositioningAbilities(player.id, [ability]);

    ai.update(player, run, 0);

    expect(player.position).toEqual({ x: 5, y: 5, z: 0 });
    expect(player.facing).toBe('east');
  });

  it('não aponta diagonalmente ao otimizar o posicionamento frontal', () => {
    const { run, creatures } = makeRun();
    creatures.spawnCreature(makeDefinition(), { x: 7, y: 3, z: 0 });
    creatures.spawnCreature(makeDefinition(), { x: 7, y: 4, z: 0 });
    const player = makePlayer('mage', { targeting: 'nearest', movement: 'hold', frontPositioning: true }, { x: 5, y: 5, z: 0 });
    const ability = { targetMode: 'directional', rangeTiles: 4, areaConfig: { shape: 'line', width: 3, height: 1 } } as CombatAbilityDefinition;
    const ai = new PlayerCombatAIService();
    ai.setPositioningAbilities(player.id, [ability]);

    ai.update(player, run, 0);

    expect(['north', 'east', 'south', 'west']).toContain(player.facing);
  });

  it('avança até a distância configurada e para', () => {
    const { run, creatures } = makeRun();
    creatures.spawnCreature(makeDefinition(), { x: 5, y: 8, z: 0 });
    const player = makePlayer('warrior', { targeting: 'nearest', movement: 'maintainDistance', attackRange: 1 }, { x: 5, y: 5, z: 0 });
    const ai = new PlayerCombatAIService();

    for (let now = 0; now < 5000; now += 200) {
      ai.update(player, run, now);
    }
    expect(tileDistance(player.position, { x: 5, y: 8, z: 0 })).toBe(1);
  });

  it('recua quando o alvo entra na distância configurada', () => {
    const { run, creatures } = makeRun();
    creatures.spawnCreature(makeDefinition(), { x: 5, y: 6, z: 0 });
    const player = makePlayer('mage', { targeting: 'nearest', movement: 'maintainDistance', attackRange: 5 }, { x: 5, y: 5, z: 0 });
    const ai = new PlayerCombatAIService();

    const before = tileDistance(player.position, { x: 5, y: 6, z: 0 });
    ai.update(player, run, 0);
    expect(tileDistance(player.position, { x: 5, y: 6, z: 0 })).toBeGreaterThan(before);
  });

  it('hold não move', () => {
    const { run, creatures } = makeRun();
    creatures.spawnCreature(makeDefinition(), { x: 5, y: 8, z: 0 });
    const player = makePlayer('archer', { targeting: 'nearest', movement: 'hold' }, { x: 5, y: 5, z: 0 });
    const ai = new PlayerCombatAIService();

    ai.update(player, run, 0);
    expect(player.position).toEqual({ x: 5, y: 5, z: 0 });
  });

  it('respeita colisão de parede (não atravessa tile bloqueado)', () => {
    const world = makeWorld(5, 5);
    world.byKey.get(tileKey(5 - 2, 2, 0))!.walkable = false; // bloco ao norte da posição
    const movement = new MovementService(world);
    const creatures = new CreatureManager(movement);
    creatures.spawnCreature(makeDefinition(), { x: 2, y: 3, z: 0 });
    const run = { movement, creatures } as unknown as HuntRun;
    const player = makePlayer('mage', { targeting: 'nearest', movement: 'maintainDistance', attackRange: 5 }, { x: 2, y: 2, z: 0 });
    const ai = new PlayerCombatAIService();

    ai.update(player, run, 0);
    expect(movement.getTile(player.position)?.walkable).toBe(true);
  });

  it('desvia de parede (desliza em vez de travar)', () => {
    const world = makeWorld(5, 7);
    for (let y = 0; y < 7; y++) world.byKey.get(tileKey(0, y, 0))!.walkable = false; // parede oeste
    const movement = new MovementService(world);
    const creatures = new CreatureManager(movement);
    creatures.spawnCreature(makeDefinition(), { x: 2, y: 3, z: 0 });
    const run = { movement, creatures } as unknown as HuntRun;
    const player = makePlayer('archer', { targeting: 'nearest', movement: 'maintainDistance', attackRange: 5 }, { x: 1, y: 3, z: 0 });
    const ai = new PlayerCombatAIService();

    const moved = ai.update(player, run, 0);
    expect(moved).toBe(true);
    expect(player.position.x).toBe(1); // continua na parede, sem atravessá-la
    expect(player.position.y).not.toBe(3); // deslizou norte/sul
    expect(player.position).not.toEqual({ x: 2, y: 3, z: 0 }); // não avançou na ameaça
  });

  it('cercado por criaturas aguarda brecha (não move)', () => {
    const { run, creatures } = makeRun(3, 3);
    const ring: [number, number][] = [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1], [2, 2]];
    for (const [x, y] of ring) creatures.spawnCreature(makeDefinition(), { x, y, z: 0 });
    const player = makePlayer('mage', { targeting: 'nearest', movement: 'maintainDistance', attackRange: 5 }, { x: 1, y: 1, z: 0 });
    const ai = new PlayerCombatAIService();

    expect(ai.update(player, run, 0)).toBe(false);
    expect(player.position).toEqual({ x: 1, y: 1, z: 0 });
  });

  it('avança e recua para manter a distância configurada', () => {
    const { run, creatures } = makeRun(12, 12);
    creatures.spawnCreature(makeDefinition(), { x: 5, y: 6, z: 0 });
    const player = makePlayer('mage', { targeting: 'nearest', movement: 'maintainDistance', attackRange: 5 }, { x: 5, y: 5, z: 0 });
    const ai = new PlayerCombatAIService();

    for (let now = 0; now < 5000; now += 200) ai.update(player, run, now);
    const d = tileDistance(player.position, { x: 5, y: 6, z: 0 });
    expect(d).toBe(5);
  });

  it('recentraliza quando não há criaturas', () => {
    const { run } = makeRun(12, 12);
    const player = makePlayer('archer', { targeting: 'nearest', movement: 'maintainDistance' }, { x: 1, y: 1, z: 0 });
    const ai = new PlayerCombatAIService();
    const center = { x: 6, y: 6, z: 0 };

    ai.update(player, run, 0);
    expect(tileDistance(player.position, center)).toBeLessThan(tileDistance({ x: 1, y: 1, z: 0 }, center));
  });
});

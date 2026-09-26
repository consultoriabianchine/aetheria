import { describe, expect, it } from 'vitest';
import type { CreatureTarget } from '../src/game/creature/creature-ai.service';
import { CreatureAIService } from '../src/game/creature/creature-ai.service';
import { CreatureEntity } from '../src/game/creature/creature.entity';
import { MovementService } from '../src/game/creature/movement.service';
import { findPath } from '../src/game/creature/pathfinding';
import { Direction } from '../src/game/creature/direction';
import type { WorldMapData } from '../src/game/engine/world-map';
import type { CreatureDefinition, CombatArchetype, MapTile, Position } from '@aetheria/types';
import { tileKey, tileDistance } from '@aetheria/shared';

/** Mundo pequeno e aberto (tudo grama) para testes determinísticos. */
function makeWorld(width = 10, height = 10, z = 0): WorldMapData {
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
    movementSpeed: 1,
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

function makePlayer(id: string, position: Position, health = 100, archetype: CombatArchetype = 'warrior'): CreatureTarget {
  return { id, position, socketId: id + '-sock', health, defense: 0, archetype };
}

interface Harness {
  ai: CreatureAIService;
  movement: MovementService;
  creature: CreatureEntity;
  players: Map<string, CreatureTarget>;
  broadcasts: { event: string; data: Record<string, unknown> }[];
  attacks: { creature: CreatureEntity; target: CreatureTarget; amount: number; critical: boolean; now: number }[];
}

function makeHarness(
  def: CreatureDefinition,
  position: Position,
  players: CreatureTarget[] = [],
  options: { aggressive?: boolean; world?: WorldMapData; getCreatureAttackRange?: (c: CreatureEntity) => number } = {},
): Harness {
  const world = options.world ?? makeWorld();
  const movement = new MovementService(world);
  const creatures: CreatureEntity[] = [];
  const broadcasts: { event: string; data: Record<string, unknown> }[] = [];
  const attacks: Harness['attacks'] = [];
  const playersMap = new Map(players.map((p) => [p.id, p]));

  const ai = new CreatureAIService(
    {
      movement,
      getPlayers: () => playersMap.values(),
      getPlayerById: (id) => playersMap.get(id) ?? null,
      broadcast: (event, data) => broadcasts.push({ event, data: data as Record<string, unknown> }),
      onAttackPlayer: (c, t, amount, critical, now) => attacks.push({ creature: c, target: t, amount, critical, now }),
      getCreatureAttackRange: options.getCreatureAttackRange,
    },
    options,
  );

  const creature = new CreatureEntity('creature-1', def, position);
  creatures.push(creature);
  return { ai, movement, creature, players: playersMap, broadcasts, attacks };
}

function step(h: Harness, now: number) {
  h.ai.update(h.creature, now);
}

describe('CreatureAIService', () => {
  it('não atualiza criaturas mortas (DEAD)', () => {
    const h = makeHarness(makeDefinition(), { x: 5, y: 5, z: 0 });
    h.creature.state = 'DEAD';
    h.creature.health = 0;
    step(h, 1000);
    expect(h.broadcasts).toHaveLength(0);
    expect(h.creature.state).toBe('DEAD');
  });

  it('mantém IDLE sem jogador na visão', () => {
    const h = makeHarness(makeDefinition({ viewRange: 3 }), { x: 5, y: 5, z: 0 }, [
      makePlayer('p1', { x: 1, y: 1, z: 0 }),
    ]);
    step(h, 0);
    expect(h.creature.state).toBe('IDLE');
  });

  it('detecta jogador dentro do viewRange e muda para CHASE', () => {
    const h = makeHarness(makeDefinition(), { x: 5, y: 5, z: 0 }, [makePlayer('p1', { x: 5, y: 7, z: 0 })]);
    step(h, 0);
    expect(h.creature.state).toBe('CHASE');
    expect(h.creature.targetId).toBe('p1');
  });

  it('ignora jogadores em outro andar (z diferente)', () => {
    const h = makeHarness(makeDefinition(), { x: 5, y: 5, z: 0 }, [makePlayer('p1', { x: 5, y: 6, z: 1 })]);
    step(h, 0);
    expect(h.creature.state).toBe('IDLE');
  });

  it('persegue e ataca o jogador quando chega no alcance', () => {
    const h = makeHarness(makeDefinition({ attackRange: 1, movementSpeed: 1 }), { x: 5, y: 5, z: 0 }, [
      makePlayer('p1', { x: 5, y: 7, z: 0 }),
    ]);
    // Aproxima até ficar a 1 tile (y=6).
    for (let now = 0; now < 5000 && h.creature.state !== 'ATTACK'; now += 100) step(h, now);
    expect(h.creature.state).toBe('ATTACK');
    step(h, 999999);
    expect(h.attacks.length).toBeGreaterThan(0);
    expect(h.attacks[0].amount).toBeGreaterThanOrEqual(1);
    expect(h.attacks[0].target.id).toBe('p1');
    expect(h.broadcasts.some((b) => b.event === 'creature.attack')).toBe(true);
  });

  it('respeita o intervalo entre ataques (attackSpeed)', () => {
    const h = makeHarness(makeDefinition({ attackRange: 1, attackSpeed: 1000 }), { x: 5, y: 5, z: 0 }, [
      makePlayer('p1', { x: 5, y: 6, z: 0 }),
    ]);
    // Um estado por tick: IDLE→CHASE→ATTACK.
    step(h, 2000);
    expect(h.creature.state).toBe('CHASE');
    step(h, 2100);
    expect(h.creature.state).toBe('ATTACK');
    expect(h.attacks.length).toBe(0);
    // Tick 2500: primeiro ataque (2500 >= 0 + 1000).
    step(h, 2500);
    expect(h.attacks.length).toBe(1);
    // Tick 3100: ainda dentro do intervalo (3100 < 2500 + 1000).
    step(h, 3100);
    expect(h.attacks.length).toBe(1);
    // Tick 3600: segundo ataque.
    step(h, 3600);
    expect(h.attacks.length).toBe(2);
  });

  it('volta para CHASE se o alvo sair do alcance', () => {
    const h = makeHarness(makeDefinition({ attackRange: 1 }), { x: 5, y: 5, z: 0 }, [
      makePlayer('p1', { x: 5, y: 6, z: 0 }),
    ]);
    step(h, 0);
    step(h, 100);
    expect(h.creature.state).toBe('ATTACK');
    h.players.get('p1')!.position = { x: 5, y: 9, z: 0 };
    step(h, 200);
    expect(h.creature.state).toBe('CHASE');
  });

  it('limpa o alvo quando o jogador morre', () => {
    const h = makeHarness(makeDefinition(), { x: 5, y: 5, z: 0 }, [makePlayer('p1', { x: 5, y: 6, z: 0 })]);
    step(h, 0);
    expect(h.creature.targetId).toBe('p1');
    h.players.get('p1')!.health = 0;
    step(h, 100);
    expect(h.creature.targetId).toBeNull();
  });

  it('foge quando o HP cai abaixo do limite (canFlee)', () => {
    const def = makeDefinition({ canFlee: true, fleeHealthPercent: 50, attackRange: 1, canWander: false });
    const h = makeHarness(def, { x: 5, y: 5, z: 0 }, [makePlayer('p1', { x: 5, y: 6, z: 0 })]);
    h.creature.health = 30; // 30% < 50%
    step(h, 0);
    expect(h.creature.state).toBe('FLEE');
  });

  it('retorna ao CHASE quando o HP se recupera acima do limite', () => {
    const def = makeDefinition({ canFlee: true, fleeHealthPercent: 50, attackRange: 1, viewRange: 10 });
    const h = makeHarness(def, { x: 5, y: 5, z: 0 }, [makePlayer('p1', { x: 5, y: 6, z: 0 })]);
    h.creature.health = 30;
    step(h, 0);
    expect(h.creature.state).toBe('FLEE');
    h.creature.health = 80; // acima do limite
    step(h, 100);
    expect(h.creature.state).toBe('CHASE');
  });

  it('foge para longe da ameaça (distância aumenta)', () => {
    const def = makeDefinition({ canFlee: true, fleeHealthPercent: 50, attackRange: 1, movementSpeed: 1 });
    const h = makeHarness(def, { x: 5, y: 5, z: 0 }, [makePlayer('p1', { x: 5, y: 6, z: 0 })]);
    h.creature.health = 30;
    step(h, 0);
    expect(h.creature.state).toBe('FLEE');
    const threat = { x: 5, y: 6, z: 0 };
    const before = tileDistance(h.creature.position, threat);
    for (let now = 100; now < 5000 && h.creature.state === 'FLEE'; now += 100) step(h, now);
    expect(tileDistance(h.creature.position, threat)).toBeGreaterThan(before);
  });

  it('retorna ao spawn (RETURN) e volta a IDLE', () => {
    const h = makeHarness(makeDefinition({ viewRange: 5, chaseRange: 8 }), { x: 5, y: 5, z: 0 }, [
      makePlayer('p1', { x: 9, y: 8, z: 0 }),
    ]);
    // Persegue até longe do spawn.
    step(h, 0);
    expect(h.creature.state).toBe('CHASE');
    h.creature.position = { x: 9, y: 9, z: 0 };
    // Alvo desaparece (morte) longe do spawn → RETURN.
    h.players.get('p1')!.health = 0;
    step(h, 100);
    expect(h.creature.state).toBe('RETURN');
    for (let now = 200; now < 20000 && h.creature.state !== 'IDLE'; now += 100) step(h, now);
    expect(h.creature.state).toBe('IDLE');
    const dx = Math.abs(h.creature.position.x - h.creature.spawnPosition.x);
    const dy = Math.abs(h.creature.position.y - h.creature.spawnPosition.y);
    expect(Math.max(dx, dy)).toBeLessThanOrEqual(1);
  });

  it('facing acompanha a direção do movimento (creature.move)', () => {
    const h = makeHarness(makeDefinition({ movementSpeed: 1 }), { x: 5, y: 5, z: 0 }, [
      makePlayer('p1', { x: 5, y: 8, z: 0 }),
    ]);
    for (let now = 0; now < 500 && h.creature.state !== 'ATTACK'; now += 100) step(h, now);
    const move = h.broadcasts.find((b) => b.event === 'creature.move');
    expect(move).toBeDefined();
    const dir = move!.data.facing as Direction;
    expect(['south', 'southeast', 'southwest', 'north', 'northeast', 'northwest', 'east', 'west']).toContain(dir);
    expect(move!.data.creatureId).toBe('creature-1');
    expect(move!.data.to).toBeDefined();
  });

  it('vira para o alvo ao atacar (facing no creature.attack)', () => {
    const h = makeHarness(makeDefinition({ attackRange: 1, movementSpeed: 1 }), { x: 5, y: 5, z: 0 }, [
      makePlayer('p1', { x: 3, y: 5, z: 0 }),
    ]);
    for (let now = 0; now < 5000 && h.creature.state !== 'ATTACK'; now += 100) step(h, now);
    expect(h.creature.state).toBe('ATTACK');
    h.creature.facing = Direction.SOUTH;
    step(h, 999999);
    const atk = h.broadcasts.find((b) => b.event === 'creature.attack');
    expect(atk).toBeDefined();
    expect(atk!.data.facing).toBe('west');
  });

  it('para em attackRange sem pisar no tile do jogador', () => {
    const h = makeHarness(makeDefinition({ attackRange: 1, movementSpeed: 1 }), { x: 5, y: 5, z: 0 }, [
      makePlayer('p1', { x: 5, y: 8, z: 0 }),
    ]);
    for (let now = 0; now < 5000 && h.creature.state !== 'ATTACK'; now += 100) step(h, now);
    expect(h.creature.state).toBe('ATTACK');
    expect(h.creature.position).not.toEqual({ x: 5, y: 8, z: 0 });
    expect(tileDistance(h.creature.position, { x: 5, y: 8, z: 0 })).toBe(1);
  });

  describe('modo agressivo (hunts)', () => {
    it('detecta o jogador a qualquer distância, mesmo com viewRange pequeno', () => {
      const h = makeHarness(makeDefinition({ viewRange: 1 }), { x: 5, y: 5, z: 0 }, [
        makePlayer('p1', { x: 1, y: 1, z: 0 }),
      ], { aggressive: true });
      step(h, 0);
      expect(h.creature.state).toBe('CHASE');
      expect(h.creature.targetId).toBe('p1');
    });

    it('persegue mesmo quando a criatura não pode caçar (canChase=false)', () => {
      const h = makeHarness(makeDefinition({ canChase: false, canWander: false }), { x: 5, y: 5, z: 0 }, [
        makePlayer('p1', { x: 5, y: 8, z: 0 }),
      ], { aggressive: true });
      for (let now = 0; now < 5000 && h.creature.state !== 'ATTACK'; now += 100) step(h, now);
      expect(h.creature.state).toBe('ATTACK');
    });

    it('nunca foge mesmo com canFlee e HP baixo', () => {
      const h = makeHarness(makeDefinition({ canFlee: true, fleeHealthPercent: 100 }), { x: 5, y: 5, z: 0 }, [
        makePlayer('p1', { x: 5, y: 6, z: 0 }),
      ], { aggressive: true });
      step(h, 0);
      expect(h.creature.state).toBe('CHASE');
      step(h, 100);
      expect(h.creature.state).toBe('ATTACK');
      h.creature.health = 1;
      step(h, 200);
      expect(h.creature.state).toBe('ATTACK');
      expect(h.creature.state).not.toBe('FLEE');
    });

    it('não desiste da perseguição por distância ao spawn', () => {
      const h = makeHarness(makeDefinition({ chaseRange: 2 }), { x: 5, y: 5, z: 0 }, [
        makePlayer('p1', { x: 5, y: 9, z: 0 }),
      ], { aggressive: true });
      for (let now = 0; now < 20000 && h.creature.state !== 'ATTACK'; now += 100) step(h, now);
      expect(h.creature.state).toBe('ATTACK');
      expect(h.creature.state).not.toBe('RETURN');
    });
  });

  describe('prioridade de alvo', () => {
    it('prioriza Warrior sobre Archer e Mage (mesma distância)', () => {
      const h = makeHarness(makeDefinition(), { x: 5, y: 5, z: 0 }, [
        makePlayer('mage', { x: 2, y: 5, z: 0 }, 100, 'mage'),
        makePlayer('archer', { x: 8, y: 5, z: 0 }, 100, 'archer'),
        makePlayer('warrior', { x: 5, y: 8, z: 0 }, 100, 'warrior'),
      ], { aggressive: true });
      step(h, 0);
      expect(h.creature.targetId).toBe('warrior');
    });

    it('troca para Archer quando Warrior é inacessível', () => {
      const world = makeWorld(9, 9);
      for (let y = 0; y < 9; y++) world.byKey.get(tileKey(7, y, 0))!.walkable = false;
      const h = makeHarness(makeDefinition(), { x: 2, y: 4, z: 0 }, [
        makePlayer('warrior', { x: 8, y: 4, z: 0 }, 100, 'warrior'),
        makePlayer('archer', { x: 2, y: 8, z: 0 }, 100, 'archer'),
      ], { aggressive: true, world });
      step(h, 0);
      expect(h.creature.targetId).toBe('archer');
    });

    it('troca para Mage quando Warrior e Archer são inacessíveis', () => {
      const world = makeWorld(9, 9);
      for (let y = 0; y < 9; y++) world.byKey.get(tileKey(7, y, 0))!.walkable = false;
      for (let x = 0; x < 9; x++) world.byKey.get(tileKey(x, 1, 0))!.walkable = false;
      const h = makeHarness(makeDefinition(), { x: 2, y: 4, z: 0 }, [
        makePlayer('warrior', { x: 8, y: 4, z: 0 }, 100, 'warrior'),
        makePlayer('archer', { x: 2, y: 0, z: 0 }, 100, 'archer'),
        makePlayer('mage', { x: 2, y: 6, z: 0 }, 100, 'mage'),
      ], { aggressive: true, world });
      step(h, 0);
      expect(h.creature.targetId).toBe('mage');
    });

    it('mantém o alvo atual (stickiness) enquanto ele continua válido', () => {
      const h = makeHarness(makeDefinition(), { x: 5, y: 5, z: 0 }, [
        makePlayer('archer', { x: 8, y: 5, z: 0 }, 100, 'archer'),
        makePlayer('warrior', { x: 5, y: 9, z: 0 }, 100, 'warrior'),
      ], { aggressive: true });
      h.creature.targetId = 'archer';
      step(h, 0);
      expect(h.creature.targetId).toBe('archer');
    });
  });

  describe('ranged positioning', () => {
    it('ranged mantém distância preferida em vez de colar no alvo', () => {
      const h = makeHarness(makeDefinition({ attackRange: 5, movementSpeed: 1 }), { x: 5, y: 5, z: 0 }, [
        makePlayer('p1', { x: 5, y: 6, z: 0 }),
      ], { aggressive: true });
      for (let now = 0; now < 5000 && h.creature.state !== 'ATTACK'; now += 100) step(h, now);
      expect(h.creature.state).toBe('ATTACK');
      expect(tileDistance(h.creature.position, { x: 5, y: 6, z: 0 })).toBeGreaterThanOrEqual(3);
    });

    it('melee aproxima até ficar adjacente ao alvo', () => {
      const h = makeHarness(makeDefinition({ attackRange: 1, movementSpeed: 1 }), { x: 5, y: 5, z: 0 }, [
        makePlayer('p1', { x: 5, y: 9, z: 0 }),
      ], { aggressive: true });
      for (let now = 0; now < 5000 && h.creature.state !== 'ATTACK'; now += 100) step(h, now);
      expect(h.creature.state).toBe('ATTACK');
      expect(tileDistance(h.creature.position, { x: 5, y: 9, z: 0 })).toBe(1);
    });

    it('usa o alcance da magia para atacar sem transformar melee em ranged', () => {
      const h = makeHarness(makeDefinition({ attackRange: 1, movementSpeed: 1 }), { x: 5, y: 5, z: 0 }, [
        makePlayer('p1', { x: 5, y: 6, z: 0 }),
      ], { aggressive: true, getCreatureAttackRange: () => 6 });
      for (let now = 0; now < 5000 && h.creature.state !== 'ATTACK'; now += 100) step(h, now);
      expect(h.creature.state).toBe('ATTACK');
      expect(tileDistance(h.creature.position, { x: 5, y: 6, z: 0 })).toBe(1);
    });
  });
});

describe('MovementService', () => {
  const world = makeWorld(6, 6);
  const movement = new MovementService(world);

  it('inBounds respeita as dimensões do mundo', () => {
    expect(movement.inBounds({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(movement.inBounds({ x: 5, y: 5, z: 0 })).toBe(true);
    expect(movement.inBounds({ x: 6, y: 0, z: 0 })).toBe(false);
    expect(movement.inBounds({ x: 0, y: 1, z: 1 })).toBe(false);
  });

  it('step move 1 tile na direção', () => {
    expect(movement.step({ x: 3, y: 3, z: 0 }, Direction.NORTH)).toEqual({ x: 3, y: 2, z: 0 });
    expect(movement.step({ x: 3, y: 3, z: 0 }, Direction.EAST)).toEqual({ x: 4, y: 3, z: 0 });
    expect(movement.step({ x: 3, y: 3, z: 0 }, Direction.SOUTH_EAST)).toEqual({ x: 4, y: 4, z: 0 });
  });

  it('canMove/canOccupy consideram o resolutor de ocupação', () => {
    let occupied = false;
    const m = new MovementService(world, () => occupied);
    occupied = true;
    expect(m.canMove({ x: 3, y: 3, z: 0 }, Direction.EAST)).toBe(false);
    occupied = false;
    expect(m.canMove({ x: 3, y: 3, z: 0 }, Direction.EAST)).toBe(true);
  });

  it('nearestWalkable retorna a própria posição quando já é caminhável', () => {
    expect(movement.nearestWalkable({ x: 3, y: 3, z: 0 })).toEqual({ x: 3, y: 3, z: 0 });
  });

  it('nearestWalkable encontra o vizinho caminhável mais próximo', () => {
    const w = makeWorld(5, 5);
    const byKey = w.byKey;
    const block = (x: number, y: number) => {
      byKey.get(tileKey(x, y, w.z))!.walkable = false;
    };
    block(2, 2);
    const m = new MovementService(w);
    const found = m.nearestWalkable({ x: 2, y: 2, z: 0 });
    expect(found).toBeTruthy();
    expect(Math.max(Math.abs(found!.x - 2), Math.abs(found!.y - 2))).toBe(1);
  });

  it('A* não corta canto na diagonal (não atravessa entre dois obstáculos)', () => {
    const w = makeWorld(3, 3);
    const block = (x: number, y: number) => {
      w.byKey.get(tileKey(x, y, w.z))!.walkable = false;
    };
    block(1, 0);
    block(0, 1);
    const m = new MovementService(w);
    const path = findPath(m, { start: { x: 1, y: 1, z: 0 }, goal: { x: 0, y: 0, z: 0 } });
    expect(path).toBeNull();
  });
});

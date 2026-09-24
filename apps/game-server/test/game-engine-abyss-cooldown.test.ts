import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine/game-engine';
import { MemoryStore } from '../src/game/store/memory-store';

describe('GameEngine Abismo cooldown scheduling', () => {
  it('schedules the next individual spell cooldown in the Abyss', () => {
    const tiles = Array.from({ length: 64 * 64 }, (_, index) => ({ x: index % 64, y: Math.floor(index / 64), z: 7, type: 0, walkable: true, blocksVision: false }));
    const mapRegistry = { getMap: () => ({ id: 'map_mucxf0oc', name: 'Abyss', width: 64, height: 64, tiles }), getMapRender: () => null };
    const engine = new GameEngine(new MemoryStore(), undefined, mapRegistry as any);
    const internals = engine as any;
    const player = { id: 'character-abyss', targetId: null };
    internals.players.set(player.id, player);

    const run = internals.abyss.start('account-abyss', player.id, 1, 'mage', 0);
    run.abilities = [
      { abilityId: 11, level: 1, damageMultiplier: 1, cooldownMultiplier: 1, areaBonus: 0 },
      { abilityId: 12, level: 1, damageMultiplier: 1, cooldownMultiplier: 1, areaBonus: 0 },
    ];
    internals.abilityCooldowns.set(player.id, new Map([[11, 5_000], [12, 8_000]]));
    internals.attackGroupReadyAt.set(player.id, 20_000);

    internals.schedulePlayerAttackCheck(player, 1_000);

    expect(internals.combatEvents.peek().readyAt).toBe(5_000);
  });

  it('keeps group cooldown scheduling outside the Abyss', () => {
    const engine = new GameEngine(new MemoryStore());
    const internals = engine as any;
    const player = { id: 'character-hunt', targetId: 'target', attackCooldownUntil: 2_000 };
    internals.players.set(player.id, player);
    internals.attackGroupReadyAt.set(player.id, 7_000);

    internals.schedulePlayerAttackCheck(player, 1_000);

    expect(internals.combatEvents.peek().readyAt).toBe(2_000);
  });

  it('casts Abyss abilities without consuming mana', async () => {
    const tiles = Array.from({ length: 64 * 64 }, (_, index) => ({ x: index % 64, y: Math.floor(index / 64), z: 7, type: 0, walkable: true, blocksVision: false }));
    const mapRegistry = { getMap: () => ({ id: 'map_mucxf0oc', name: 'Abyss', width: 64, height: 64, tiles }), getMapRender: () => null };
    const engine = new GameEngine(new MemoryStore(), undefined, mapRegistry as any);
    const internals = engine as any;
    const player = {
      id: 'character-abyss-mana', accountId: 'account-abyss-mana', socketId: undefined,
      level: 1, archetype: 'mage', position: { x: 1, y: 1, z: 7 }, targetId: null,
      health: 10, maxHealth: 100, mana: 1, maxMana: 100,
      skills: { magic: 1 }, skillProgress: [],
    };
    internals.players.set(player.id, player);
    internals.abilityRegistry = { get: async () => ({
      abilityId: 99, slug: 'abyss-heal', name: 'Abyss Heal', enabled: true,
      ownerType: 'player', playerClass: 'all', category: 'heal', targetMode: 'single',
      rangeTiles: 1, manaCost: 100, cooldownMs: 1_000, cooldownGroup: 'healing',
      defaultParameters: { healBase: 10 },
    }) };
    internals.abyss.start('account-abyss-mana', player.id, 1, 'mage', 0).abilities = [{
      abilityId: 99, level: 1, damageMultiplier: 1, cooldownMultiplier: 1, areaBonus: 0,
    }];
    player.mana = 1;

    const cast = await internals.castAbility(player, 99, player.id, '');

    expect(cast).toBe(true);
    expect(player.mana).toBe(1);
  });
});

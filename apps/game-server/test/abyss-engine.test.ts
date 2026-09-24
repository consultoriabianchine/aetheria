import { describe, expect, it } from 'vitest';
import type { CombatAbilityDefinition } from '@aetheria/types';
import { AbyssEngine } from '../src/game/abyss/abyss-engine';
import { MemoryStore } from '../src/game/store/memory-store';
import { buildWorldMapData } from '../src/game/engine/world-map';

const abilities = [
  { abilityId: 1, name: 'Magic Missile', slug: 'magic-missile', category: 'attack', playerClass: 'mage', enabled: true },
  { abilityId: 2, name: 'Frost Nova', slug: 'frost-nova', category: 'area', playerClass: 'mage', enabled: true },
] as unknown as CombatAbilityDefinition[];

describe('AbyssEngine', () => {
  it('keeps run upgrades separate from account and character state', async () => {
    const events: { event: string; data: any }[] = [];
    const engine = new AbyssEngine(new MemoryStore(), { getAbilities: () => abilities, emit: (_id, event, data) => events.push({ event, data }) });
    const run = engine.start('account-1', 'character-1', 1, 'mage', 1000);

    engine.grantExperience(run.characterId, 100, 1001);
    const choices = events.find((event) => event.event === 'abyss.levelUp')?.data.choices;
    expect(choices).toHaveLength(3);
    expect(engine.chooseUpgrade(run.characterId, choices[1].id, 1002)).not.toBeNull();
    expect(engine.getRun(run.characterId)?.level).toBe(2);
    expect((await engine.getMeta('account-1')).fragments).toBe(0);
  });

  it('persists only run fragments after completion', async () => {
    const store = new MemoryStore();
    const events: string[] = [];
    const engine = new AbyssEngine(store, { getAbilities: () => abilities, emit: (_id, event) => events.push(event) });
    const run = engine.start('account-2', 'character-2', 1, 'mage', 0);
    run.fragments = 7;
    engine.tick(10 * 60 * 1000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toContain('abyss.completed');
    expect((await engine.getMeta('account-2')).fragments).toBe(7);
    expect(engine.getRun('character-2')).toBeNull();
  });

  it('loses temporary fragments when the run is defeated', async () => {
    const store = new MemoryStore();
    const engine = new AbyssEngine(store, { getAbilities: () => abilities, emit: () => {} });
    const run = engine.start('account-4', 'character-4', 1, 'mage', 0);
    run.fragments = 9;
    engine.defeat('character-4', 1000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await engine.getMeta('account-4')).fragments).toBe(0);
  });

  it('spawns existing creature definitions in an isolated manager', () => {
    const map = buildWorldMapData(Array.from({ length: 64 * 64 }, (_, index) => ({ x: index % 64, y: Math.floor(index / 64), z: 7, type: 0, walkable: true, blocksVision: false })), 64, 64, 7);
    const player = { id: 'character-3', accountId: 'account-3', name: 'Mage', archetype: 'mage', position: { x: 32, y: 32, z: 7 }, health: 100, defenseBase: 0, socketId: 'socket-3' } as any;
    const definition = { id: 'creature-1', name: 'Abyss Rat', slug: 'abyss-rat', type: 'beast', level: 1, health: 10, maxHealth: 10, attack: 1, defense: 0, experience: 25, movementSpeed: 1, attackSpeed: 1000, attackRange: 1, viewRange: 20, chaseRange: 20, fleeHealthPercent: 0, canWander: false, canChase: true, canFlee: false, returnToSpawn: false, footprintWidth: 1, footprintHeight: 1, loot: [] } as any;
    const events: { event: string; data: any }[] = [];
    const engine = new AbyssEngine(new MemoryStore(), { getAbilities: () => abilities, getMap: () => map, getCreatureDefinitions: () => [definition], getPlayer: () => player, emit: (eventCharacter, event, data) => events.push({ event, data }) });
    const run = engine.start('account-3', 'character-3', 1, 'mage', 0);
    engine.spawnInitialWave(run.characterId);
    expect(run.creatures?.size).toBeGreaterThan(0);
    const scaledCreature = [...run.creatures!.getAll()][0];
    expect(scaledCreature.definition.level).toBe(1);
    expect(scaledCreature.definition.health).toBe(82);
    expect(scaledCreature.definition.loot).toEqual([]);
    expect(run.movement?.isTileOccupied(player.position)).toBe(true);
    expect(engine.autoTarget('character-3')).not.toBeNull();
    for (const creature of [...run.creatures!.getAll()]) engine.onCreatureKilled('character-3', creature, 100);
    expect(events.some((entry) => entry.event === 'abyss.waveCompleted')).toBe(true);
    engine.tick(1700);
    expect(run.wave).toBe(2);
    expect(run.creatures?.size).toBe(3);
  });

  it('scales combat stats from the character level instead of catalog stats', () => {
    const map = buildWorldMapData(Array.from({ length: 64 * 64 }, (_, index) => ({ x: index % 64, y: Math.floor(index / 64), z: 7, type: 0, walkable: true, blocksVision: false })), 64, 64, 7);
    const player = { id: 'character-level-30', accountId: 'account-level-30', name: 'Veteran', level: 30, archetype: 'mage', position: { x: 32, y: 32, z: 7 }, health: 100, maxHealth: 100, mana: 100, maxMana: 100, defenseBase: 0, socketId: 'socket-level-30' } as any;
    const definition = { id: 'creature-level-1', name: 'Abyss Rat', slug: 'abyss-rat', type: 'beast', level: 1, health: 1, maxHealth: 1, attack: 1, defense: 1, experience: 1, movementSpeed: 1, attackSpeed: 1000, attackRange: 1, viewRange: 20, chaseRange: 20, fleeHealthPercent: 0, canWander: false, canChase: true, canFlee: false, returnToSpawn: false, footprintWidth: 1, footprintHeight: 1, loot: [{ itemId: 'catalog-item', chance: 1, minQuantity: 1, maxQuantity: 1 }] } as any;
    const engine = new AbyssEngine(new MemoryStore(), { getAbilities: () => abilities, getMap: () => map, getCreatureDefinitions: () => [definition], getPlayer: () => player, emit: () => {} });
    const run = engine.start('account-level-30', player.id, 1, 'mage', 0);
    engine.spawnInitialWave(run.characterId);
    const creature = [...run.creatures!.getAll()][0];

    expect(run.characterLevel).toBe(30);
    expect(creature.definition.level).toBe(30);
    expect(creature.definition.health).toBe(430);
    expect(creature.definition.attack).toBe(28);
    expect(creature.definition.loot).toEqual([]);
  });
});

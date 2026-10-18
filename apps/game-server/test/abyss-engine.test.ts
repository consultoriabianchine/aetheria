import { describe, expect, it } from 'vitest';
import type { CombatAbilityDefinition } from '@aetheria/types';
import { AbyssEngine } from '../src/game/abyss/abyss-engine';
import { MemoryStore } from '../src/game/store/memory-store';
import { buildWorldMapData } from '../src/game/engine/world-map';

const abilities = [
  { abilityId: 1, name: 'Magic Missile', slug: 'magic-missile', category: 'attack', playerClass: 'mage', ownerType: 'player', enabled: true },
  { abilityId: 2, name: 'Frost Nova', slug: 'frost-nova', category: 'area', playerClass: 'mage', ownerType: 'player', enabled: true },
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
    expect((await engine.getMeta('character-1')).fragments).toBe(0);
  });

  it('raises the level-up requirement as the run reaches later waves', () => {
    const engine = new AbyssEngine(new MemoryStore(), { getAbilities: () => abilities, emit: () => {} });
    const run = engine.start('account-progression', 'character-progression', 1, 'mage', 0);

    run.wave = 4;
    expect(engine.view(run).nextLevelExperience).toBe(180);
    engine.grantExperience(run.characterId, 179, 1);
    expect(run.level).toBe(1);
    engine.grantExperience(run.characterId, 1, 2);
    expect(run.level).toBe(2);
    engine.chooseUpgrade(run.characterId, run.choices[0].id, 3);
    run.wave = 7;
    expect(engine.view(run).nextLevelExperience).toBe(420);
  });

  it('applies passive upgrades and carries XP overflow into the next choice', () => {
    const engine = new AbyssEngine(new MemoryStore(), { getAbilities: () => abilities, emit: () => {} });
    const run = engine.start('account-passives', 'character-passives', 1, 'mage', 0);

    engine.grantExperience(run.characterId, 250, 1);
    expect(run.level).toBe(2);
    expect(run.experience).toBe(150);
    expect(run.status).toBe('level_up');

    const passive = run.choices.find((choice) => choice.kind === 'passive');
    expect(passive).toBeDefined();
    engine.chooseUpgrade(run.characterId, passive!.id, 2);
    expect(run.passiveMaxHealthMultiplier).toBe(1.08);
    expect(run.level).toBe(3);
    expect(run.status).toBe('level_up');
    expect(run.experience).toBe(0);
  });

  it('keeps fragment persistence and meta purchases atomic in the store', async () => {
    const store = new MemoryStore();
    await store.addAbyssFragments('character-atomic', 20);
    const unlocked = await store.unlockAbyssMeta('character-atomic', 'offense.damage', 10);

    expect(unlocked?.fragments).toBe(10);
    expect(unlocked?.unlockedNodes).toEqual(['offense.damage']);
    expect((await store.getAbyssMeta('character-atomic')).fragments).toBe(10);
  });

  it('calculates fragments as a percentage of creature experience', () => {
    const player = {
      id: 'character-fragments',
      abyssMeta: { characterId: 'character-fragments', fragments: 0, unlockedNodes: ['fortune.drop'], rerolls: 0, revives: 0 },
    } as any;
    const engine = new AbyssEngine(new MemoryStore(), { getAbilities: () => abilities, getPlayer: () => player, emit: () => {} });
    const run = engine.start('account-fragments', player.id, 1, 'mage', 0);
    run.wave = 7;
    const creature = { id: 'fragment-creature', definition: { experience: 83 } } as any;
    run.creatures = { getCreature: (id: string) => id === creature.id ? creature : undefined, removeCreature: () => {}, size: 1 } as any;

    engine.onCreatureKilled(run.characterId, creature, 1);

    expect(run.fragments).toBe(2);
  });

  it('keeps permanent fragments and unlocks isolated per character', async () => {
    const store = new MemoryStore();
    const engine = new AbyssEngine(store, { getAbilities: () => abilities, emit: () => {} });
    await store.saveAbyssMeta({ characterId: 'character-a', fragments: 25, unlockedNodes: [], rerolls: 0, revives: 0 });

    const unlocked = await engine.unlockMeta('character-a', 'offense.damage');

    expect(unlocked?.fragments).toBe(15);
    expect(unlocked?.unlockedNodes).toEqual(['offense.damage']);
    expect(unlocked?.bonuses).toEqual([{ id: 'offense.damage', branch: 'offense', name: 'Abyssal Edge', description: 'Aumenta o dano causado.', effect: '+3% dano' }]);
    expect((await engine.getMeta('character-b')).fragments).toBe(0);
    expect((await engine.getMeta('character-b')).unlockedNodes).toEqual([]);
  });

  it('applies permanent run modifiers for rare choices, fourth choices, rerolls and revives', () => {
    const events: { event: string; data: any }[] = [];
    const player = {
      id: 'character-meta',
      abyssMeta: { characterId: 'character-meta', fragments: 0, unlockedNodes: ['offense.rare', 'offense.choice4', 'fortune.reroll', 'defense.revive'], rerolls: 0, revives: 0 },
    } as any;
    const engine = new AbyssEngine(new MemoryStore(), { getAbilities: () => abilities, getPlayer: () => player, emit: (_id, event, data) => events.push({ event, data }) });
    const run = engine.start('account-meta', player.id, 1, 'mage', 0);

    engine.grantExperience(run.characterId, 100, 1);
    const levelUp = events.find((event) => event.event === 'abyss.levelUp')?.data;
    expect(levelUp.choices).toHaveLength(4);
    expect(levelUp.choices[0].rarity).toBe('rare');
    expect(run.rerollsRemaining).toBe(1);
    const rerolled = engine.rerollChoices(run.characterId, 2);
    expect(rerolled?.rerollsRemaining).toBe(0);
    expect(engine.chooseUpgrade(run.characterId, rerolled!.choices[0].id, 3)).not.toBeNull();
    expect(engine.consumeRevive(run.characterId)).toBe(true);
    expect(engine.consumeRevive(run.characterId)).toBe(false);
    expect(events.some((event) => event.event === 'abyss.revived')).toBe(true);
  });

  it('offers a spell selection before the first abyss wave', () => {
    const player = {
      id: 'character-element',
      abyssMeta: { characterId: 'character-element', fragments: 0, unlockedNodes: ['arcane.element'], rerolls: 0, revives: 0 },
    } as any;
    const engine = new AbyssEngine(new MemoryStore(), { getAbilities: () => abilities, getPlayer: () => player, emit: () => {} });
    const run = engine.start('account-element', player.id, 1, 'mage', 0);

    expect(run.status).toBe('level_up');
    expect(run.choices.length).toBeGreaterThan(0);
    expect(run.choices.every((choice) => choice.abilityId != null)).toBe(true);
    const selectedSpell = run.choices[0];
    engine.chooseUpgrade(run.characterId, selectedSpell.id, 1);
    expect(run.abilities.some((ability) => ability.abilityId === selectedSpell.abilityId)).toBe(true);
  });

  it('turns the elite chest meta bonus into a real reward', () => {
    const events: { event: string; data: any }[] = [];
    const player = {
      id: 'character-chest',
      abyssMeta: { characterId: 'character-chest', fragments: 0, unlockedNodes: ['fortune.eliteChest'], rerolls: 0, revives: 0 },
    } as any;
    const engine = new AbyssEngine(new MemoryStore(), {
      getAbilities: () => abilities,
      getPlayer: () => player,
      onEliteChest: () => ['Elite Chest'],
      emit: (_id, event, data) => events.push({ event, data }),
    });
    const run = engine.start('account-chest', player.id, 1, 'mage', 0);
    run.seed = 0;
    run.wavesCompleted = 0;

    engine.tick(10 * 60 * 1000);

    const result = events.find((event) => event.event === 'abyss.completed')?.data;
    expect(result.rewards).toContain('Elite Chest');
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
    expect((await engine.getMeta('character-2')).fragments).toBe(7);
    expect(engine.getRun('character-2')).toBeNull();
  });

  it('preserves temporary fragments when the run is defeated', async () => {
    const store = new MemoryStore();
    const engine = new AbyssEngine(store, { getAbilities: () => abilities, emit: () => {} });
    const run = engine.start('account-4', 'character-4', 1, 'mage', 0);
    run.fragments = 9;
    engine.defeat('character-4', 1000);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect((await engine.getMeta('character-4')).fragments).toBe(9);
  });

  it('does not emit a stale state after the run finishes during creature updates', () => {
    const events: string[] = [];
    const engine = new AbyssEngine(new MemoryStore(), { getAbilities: () => abilities, emit: (_id, event) => events.push(event) });
    const run = engine.start('account-5', 'character-5', 1, 'mage', 0);
    run.creatures = { updateCreatures: () => engine.defeat(run.characterId, 1000) } as never;
    run.ai = {} as never;

    engine.tick(1000);

    expect(events).toContain('abyss.defeated');
    expect(events).not.toContain('abyss.state');
    expect(engine.getRun(run.characterId)).toBeNull();
  });

  it('spawns existing creature definitions in an isolated manager', () => {
    const map = buildWorldMapData(Array.from({ length: 64 * 64 }, (_, index) => ({ x: index % 64, y: Math.floor(index / 64), z: 7, type: 0, walkable: true, blocksVision: false })), 64, 64, 7);
    const player = { id: 'character-3', accountId: 'account-3', name: 'Mage', archetype: 'mage', position: { x: 32, y: 32, z: 7 }, health: 100, maxHealth: 100, defenseBase: 0, socketId: 'socket-3', abyssMeta: { characterId: 'character-3', fragments: 0, unlockedNodes: ['defense.shrine', 'fortune.drop'], rerolls: 0, revives: 0 } } as any;
    const definition = { id: 'creature-1', name: 'Abyss Rat', slug: 'abyss-rat', type: 'beast', level: 1, health: 10, maxHealth: 10, attack: 1, defense: 0, experience: 25, movementSpeed: 1, attackSpeed: 1000, attackRange: 1, viewRange: 20, chaseRange: 20, fleeHealthPercent: 0, canWander: false, canChase: true, canFlee: false, returnToSpawn: false, footprintWidth: 1, footprintHeight: 1, loot: [] } as any;
    const events: { event: string; data: any }[] = [];
    const engine = new AbyssEngine(new MemoryStore(), { getAbilities: () => abilities, getMap: () => map, getCreatureDefinitions: () => [definition], getPlayer: () => player, emit: (eventCharacter, event, data) => events.push({ event, data }) });
    const run = engine.start('account-3', 'character-3', 1, 'mage', 0);
    player.health = 50;
    engine.spawnInitialWave(run.characterId);
    expect(run.creatures?.size).toBeGreaterThan(0);
    const scaledCreature = [...run.creatures!.getAll()][0];
    expect(scaledCreature.definition.level).toBe(1);
    expect(scaledCreature.definition.health).toBe(82);
    expect(scaledCreature.definition.experience).toBe(15);
    expect(scaledCreature.definition.loot).toEqual([]);
    expect(run.movement?.isTileOccupied(player.position)).toBe(true);
    expect(engine.autoTarget('character-3')).not.toBeNull();
    for (const creature of [...run.creatures!.getAll()]) engine.onCreatureKilled('character-3', creature, 100);
    expect(events.some((entry) => entry.event === 'abyss.waveCompleted')).toBe(true);
    expect(run.fragments).toBe(2);
    expect(player.health).toBe(70);
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
    expect(creature.definition.experience).toBe(15);
    expect(creature.definition.loot).toEqual([]);
  });
});

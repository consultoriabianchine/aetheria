import { describe, expect, it } from 'vitest';
import { ARCHETYPES, INVENTORY_SIZE, LOOT_POUCH_SIZE } from '@aetheria/config';
import type { CombatArchetype } from '@aetheria/types';
import { GameEngine } from '../src/game/engine/game-engine';
import { MemoryStore } from '../src/game/store/memory-store';

type Emitted = { socketId: string; event: string; data: unknown };
type LoginResult = { ok: true; token: string; accountId: string };

const cases: { archetype: CombatArchetype; name: string }[] = [
  { archetype: 'mage', name: 'Mage Hero' },
  { archetype: 'warrior', name: 'Warrior Hero' },
  { archetype: 'archer', name: 'Archer Hero' },
];

describe('character creation', () => {
  it.each(cases)('creates %s with the configured starter equipment and empty inventory', async ({ archetype, name }) => {
    const store = new MemoryStore();
    const engine = new GameEngine(store);
    const emitted: Emitted[] = [];
    engine.setEmitFn((socketId, event, data) => emitted.push({ socketId, event, data }));

    await engine.handleLogin('s1', `${archetype}-user`, 'secret');
    const login = emitted.find((e) => e.event === 'auth.loginResult')?.data as LoginResult;

    await engine.handleCreateCharacter('s1', login.token, name, archetype);

    const characters = await store.listCharacters(login.accountId);
    expect(characters).toHaveLength(1);
    expect(characters[0].equipment).toMatchObject(ARCHETYPES[archetype].initialEquipment);
    expect(characters[0].inventory).toHaveLength(INVENTORY_SIZE);
    expect(characters[0].inventory.every((slot) => slot === null)).toBe(true);
    expect(characters[0].lootPouchSize).toBe(LOOT_POUCH_SIZE);
    expect(characters[0].lootPouch).toHaveLength(LOOT_POUCH_SIZE);
    expect(characters[0].lootPouch.every((slot) => slot === null)).toBe(true);
  });
});

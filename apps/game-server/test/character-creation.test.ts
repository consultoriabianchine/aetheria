import { describe, expect, it } from 'vitest';
import { INVENTORY_SIZE } from '@aetheria/config';
import type { CombatArchetype } from '@aetheria/types';
import { GameEngine } from '../src/game/engine/game-engine';
import { MemoryStore } from '../src/game/store/memory-store';

type Emitted = { socketId: string; event: string; data: unknown };
type LoginResult = { ok: true; token: string; accountId: string };

const cases: { archetype: CombatArchetype; name: string; expected: Record<string, { itemId: string; quantity: number }> }[] = [
  {
    archetype: 'mage',
    name: 'Mage Hero',
    expected: {
      weapon: { itemId: 'apprentice-staff', quantity: 1 },
      offhand: { itemId: 'novice-spellbook', quantity: 1 },
      armor: { itemId: 'apprentice-robe', quantity: 1 },
      boots: { itemId: 'cloth-boots', quantity: 1 },
    },
  },
  {
    archetype: 'warrior',
    name: 'Warrior Hero',
    expected: {
      weapon: { itemId: 'iron-sword', quantity: 1 },
      offhand: { itemId: 'training-shield', quantity: 1 },
      helmet: { itemId: 'leather-helmet', quantity: 1 },
      armor: { itemId: 'leather-armor', quantity: 1 },
      legs: { itemId: 'leather-legs', quantity: 1 },
      boots: { itemId: 'leather-boots', quantity: 1 },
    },
  },
  {
    archetype: 'archer',
    name: 'Archer Hero',
    expected: {
      weapon: { itemId: 'hunter-bow', quantity: 1 },
      ammo: { itemId: 'iron-arrow', quantity: 100 },
      armor: { itemId: 'leather-armor', quantity: 1 },
      legs: { itemId: 'leather-legs', quantity: 1 },
      boots: { itemId: 'leather-boots', quantity: 1 },
    },
  },
];

describe('character creation', () => {
  it.each(cases)('creates %s with the configured starter equipment and empty inventory', async ({ archetype, name, expected }) => {
    const store = new MemoryStore();
    const engine = new GameEngine(store);
    const emitted: Emitted[] = [];
    engine.setEmitFn((socketId, event, data) => emitted.push({ socketId, event, data }));

    await engine.handleLogin('s1', `${archetype}-user`, 'secret');
    const login = emitted.find((e) => e.event === 'auth.loginResult')?.data as LoginResult;

    await engine.handleCreateCharacter('s1', login.token, name, archetype);

    const characters = await store.listCharacters(login.accountId);
    expect(characters).toHaveLength(1);
    expect(characters[0].equipment).toMatchObject(expected);
    expect(characters[0].inventory).toHaveLength(INVENTORY_SIZE);
    expect(characters[0].inventory.every((slot) => slot === null)).toBe(true);
  });
});

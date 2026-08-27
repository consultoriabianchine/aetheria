import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/game/engine/game-engine';
import { MemoryStore } from '../src/game/store/memory-store';

type Emitted = { socketId: string; event: string; data: unknown };
type LoginResult = { ok: true; token: string; accountId: string };

interface EngineStorage {
  gold: number;
  unlockedPartySlots: number;
  party: string[];
}

describe('account storage (unificado)', () => {
  it('compartilha gold e inventário entre personagens da mesma conta', async () => {
    const store = new MemoryStore();
    const engine = new GameEngine(store);
    const emitted: Emitted[] = [];
    engine.setEmitFn((socketId, event, data) => emitted.push({ socketId, event, data }));

    await engine.handleLogin('s1', 'shared-user', 'secret');
    const login = emitted.find((e) => e.event === 'auth.loginResult')?.data as LoginResult;

    await engine.handleCreateCharacter('s1', login.token, 'Hero One', 'warrior');
    await engine.handleCreateCharacter('s1', login.token, 'Hero Two', 'mage');

    const characters = await store.listCharacters(login.accountId);
    expect(characters).toHaveLength(2);

    const storage = await store.getAccountStorage(login.accountId);
    expect(storage).not.toBeNull();
    storage!.gold = 999;
    await store.saveAccountStorage(storage!);

    const readBack = await store.getAccountStorage(login.accountId);
    expect(readBack!.gold).toBe(999);
  });

  it('desbloqueia slot e convoca companheiro para a party', async () => {
    const store = new MemoryStore();
    const engine = new GameEngine(store);
    const emitted: Emitted[] = [];
    engine.setEmitFn((socketId, event, data) => emitted.push({ socketId, event, data }));

    await engine.handleLogin('s1', 'party-user', 'secret');
    const login = emitted.find((e) => e.event === 'auth.loginResult')?.data as LoginResult;

    await engine.handleCreateCharacter('s1', login.token, 'Leader', 'warrior');
    await engine.handleCreateCharacter('s1', login.token, 'Companion', 'mage');
    const characters = await store.listCharacters(login.accountId);
    const leader = characters.find((c) => c.name === 'Leader')!;
    const companion = characters.find((c) => c.name === 'Companion')!;

    await engine.handleSelectCharacter('s1', login.token, leader.id);

    const engineStorage = (engine as unknown as { accountStorage: Map<string, EngineStorage> }).accountStorage.get(login.accountId)!;
    engineStorage.gold = 10_000;

    await engine.handlePartyUnlockSlot('s1', login.token);
    expect(engineStorage.unlockedPartySlots).toBe(2);

    await engine.handlePartySummon('s1', login.token, companion.id);

    const partyStates = emitted.filter((e) => e.event === 'party.state');
    const last = partyStates[partyStates.length - 1]?.data as { members: { id: string }[] };
    expect(last.members.map((m) => m.id)).toContain(leader.id);
    expect(last.members.map((m) => m.id)).toContain(companion.id);
  });
});

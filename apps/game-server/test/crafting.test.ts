import { afterEach, describe, expect, it } from 'vitest';
import type { CraftRecipe } from '@aetheria/types';
import { GameEngine } from '../src/game/engine/game-engine';
import { setCraftRecipeCatalog } from '../src/game/engine/craft-registry';
import { MemoryStore } from '../src/game/store/memory-store';

type Emitted = { event: string; data: any };

const recipe: CraftRecipe = {
  id: 'test-recipe',
  slug: 'test-recipe',
  name: 'Espada de Teste',
  description: 'Receita de teste',
  profession: 'forging',
  requiredLevel: 1,
  station: 'forge',
  outputItemId: 'iron-sword',
  outputQuantity: 1,
  goldCost: 100,
  experience: 25,
  qualityMin: 100,
  qualityMax: 100,
  allowedIntents: ['offense'],
  resonanceTags: ['physical'],
  ingredients: [
    { itemId: 'iron-ore', quantity: 3, role: 'base' },
    { itemId: 'coal', quantity: 1, role: 'catalyst' },
    { itemId: 'wood', quantity: 1, role: 'material' },
  ],
  status: 'published',
  version: 1,
};

afterEach(() => setCraftRecipeCatalog([]));

describe('Forja de Ressonância', () => {
  it('valida materiais, consome a mochila e gera item assinado', async () => {
    setCraftRecipeCatalog([recipe]);
    const store = new MemoryStore();
    const engine = new GameEngine(store);
    const emitted: Emitted[] = [];
    engine.setEmitFn((_socketId, event, data) => emitted.push({ event, data }));

    await engine.handleLogin('s1', 'crafter', 'secret');
    const login = emitted.find((entry) => entry.event === 'auth.loginResult')!.data as { token: string; accountId: string };
    await engine.handleCreateCharacter('s1', login.token, 'Artesão', 'warrior');
    const character = (await store.listCharacters(login.accountId))[0];
    const storage = (await store.getAccountStorage(login.accountId))!;
    storage.inventory[0] = { itemId: 'iron-ore', quantity: 3 };
    storage.inventory[1] = { itemId: 'coal', quantity: 1 };
    storage.inventory[2] = { itemId: 'wood', quantity: 1 };
    await store.saveAccountStorage(storage);
    await engine.handleSelectCharacter('s1', login.token, character.id);
    const liveStorage = (engine as any).accountStorage.get(login.accountId);
    liveStorage.inventory[0] = { itemId: 'iron-ore', quantity: 3 };
    liveStorage.inventory[1] = { itemId: 'coal', quantity: 1 };
    liveStorage.inventory[2] = { itemId: 'wood', quantity: 1 };

    await engine.handleCraftCommit('s1', recipe.id, 'offense');

    const result = emitted.find((entry) => entry.event === 'craft.completed')!.data as { quality: number };
    expect(result.quality).toBe(100);
    const saved = (await store.getAccountStorage(login.accountId))!;
    expect(saved.inventory.some((stack) => stack?.itemId === 'iron-ore')).toBe(false);
    expect(saved.inventory.some((stack) => stack?.itemId === 'coal')).toBe(false);
    expect(saved.inventory.some((stack) => stack?.itemId === 'wood')).toBe(false);
    const crafted = saved.inventory.find((stack) => stack?.itemId === 'iron-sword');
    expect(crafted?.instanceId).toBeTruthy();
    expect(crafted?.recipeId).toBe(recipe.id);
    expect(crafted?.crafterId).toBe(character.id);
    expect(saved.gold).toBe(4_900);
    expect((await store.listCraftingSkills(character.id))[0]).toMatchObject({ profession: 'forging', level: 1, experience: 25 });
  });

  it('não consome materiais quando falta algum requisito', async () => {
    setCraftRecipeCatalog([recipe]);
    const store = new MemoryStore();
    const engine = new GameEngine(store);
    const emitted: Emitted[] = [];
    engine.setEmitFn((_socketId, event, data) => emitted.push({ event, data }));
    await engine.handleLogin('s1', 'missing-material', 'secret');
    const login = emitted.find((entry) => entry.event === 'auth.loginResult')!.data as { token: string; accountId: string };
    await engine.handleCreateCharacter('s1', login.token, 'Sem Material', 'warrior');
    const character = (await store.listCharacters(login.accountId))[0];
    const storage = (await store.getAccountStorage(login.accountId))!;
    storage.inventory[0] = { itemId: 'iron-ore', quantity: 3 };
    await store.saveAccountStorage(storage);
    await engine.handleSelectCharacter('s1', login.token, character.id);
    (engine as any).accountStorage.get(login.accountId).inventory[0] = { itemId: 'iron-ore', quantity: 3 };

    await engine.handleCraftCommit('s1', recipe.id, 'offense');

    expect(emitted.some((entry) => entry.event === 'craft.completed')).toBe(false);
    expect((await store.getAccountStorage(login.accountId))!.inventory[0]).toEqual({ itemId: 'iron-ore', quantity: 3 });
  });
});

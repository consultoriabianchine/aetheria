import { randomUUID } from 'node:crypto';
import { ACCOUNT_CONFIG, INVENTORY_SIZE, LOOT_POUCH_SIZE } from '@aetheria/config';
import type { HuntProgress, ItemStack } from '@aetheria/types';
import type { Store, StoredAccountStorage, StoredCharacter, AccountRecord } from './store';

const BASE_SKILLS = { melee: 10, distance: 10, magic: 10 };

/** Store em memória — usado quando USE_IN_MEMORY=true (dev sem PostgreSQL). */
export class MemoryStore implements Store {
  private accounts = new Map<string, AccountRecord>();
  private byUsername = new Map<string, string>();
  private characters = new Map<string, StoredCharacter>();
  private huntProgress = new Map<string, HuntProgress>();
  private accountStorage = new Map<string, StoredAccountStorage>();

  async findAccountByUsername(username: string): Promise<AccountRecord | null> {
    const id = this.byUsername.get(username.toLowerCase());
    return id ? this.accounts.get(id) ?? null : null;
  }

  async createAccount(username: string, passwordHash: string): Promise<AccountRecord> {
    const account: AccountRecord = { id: randomUUID(), username, passwordHash };
    this.accounts.set(account.id, account);
    this.byUsername.set(username.toLowerCase(), account.id);
    return account;
  }

  async listCharacters(accountId: string): Promise<StoredCharacter[]> {
    return [...this.characters.values()].filter((c) => c.accountId === accountId);
  }

  async createCharacter(accountId: string, data: Omit<StoredCharacter, 'id' | 'accountId'>): Promise<StoredCharacter> {
    const character: StoredCharacter = {
      id: randomUUID(),
      accountId,
      ...data,
    };
    this.characters.set(character.id, character);
    return character;
  }

  async findCharacterById(id: string): Promise<StoredCharacter | null> {
    return this.characters.get(id) ?? null;
  }

  async getAccountStorage(accountId: string): Promise<StoredAccountStorage | null> {
    return this.accountStorage.get(accountId) ?? null;
  }

  async saveAccountStorage(storage: StoredAccountStorage): Promise<void> {
    this.accountStorage.set(storage.accountId, structuredClone(storage));
  }

  private readonly weaponOverrides = new Map<string, import('@aetheria/types').WeaponElementOverride>();

  async saveCharacter(character: StoredCharacter): Promise<void> {
    this.characters.set(character.id, structuredClone(character));
  }

  async getWeaponElementOverride(characterId: string) {
    const override = this.weaponOverrides.get(characterId);
    return override && (override.paused || override.expiresAt > Date.now()) ? { ...override } : null;
  }

  async saveWeaponElementOverride(characterId: string, override: import('@aetheria/types').WeaponElementOverride): Promise<void> {
    this.weaponOverrides.set(characterId, { ...override });
  }

  async clearWeaponElementOverride(characterId: string): Promise<void> {
    this.weaponOverrides.delete(characterId);
  }


  async getHuntProgress(characterId: string, huntId: string): Promise<HuntProgress | null> {
    return this.huntProgress.get(`${characterId}:${huntId}`) ?? null;
  }

  async listHuntProgress(characterId: string): Promise<HuntProgress[]> {
    const out: HuntProgress[] = [];
    for (const [key, value] of this.huntProgress) {
      if (key.startsWith(`${characterId}:`)) out.push(value);
    }
    return out;
  }

  async recordHuntCompletion(characterId: string, huntId: string, clearTimeMs: number): Promise<HuntProgress> {
    const key = `${characterId}:${huntId}`;
    const existing = this.huntProgress.get(key);
    const now = Date.now();
    const bestClearTimeMs =
      existing?.bestClearTimeMs == null || clearTimeMs < existing.bestClearTimeMs ? clearTimeMs : existing.bestClearTimeMs;
    const isBest = bestClearTimeMs === clearTimeMs;
    const next: HuntProgress = {
      huntId,
      completionCount: (existing?.completionCount ?? 0) + 1,
      firstClearAt: existing?.firstClearAt ?? now,
      firstClearTimeMs: existing?.firstClearTimeMs ?? clearTimeMs,
      bestClearTimeMs,
      bestClearAt: isBest && existing?.bestClearAt == null ? now : existing?.bestClearAt ?? (isBest ? now : null),
      favorite: existing?.favorite ?? false,
    };
    this.huntProgress.set(key, next);
    return next;
  }

  async setHuntFavorite(characterId: string, huntId: string, favorite: boolean): Promise<HuntProgress> {
    const key = `${characterId}:${huntId}`;
    const existing = this.huntProgress.get(key);
    const next: HuntProgress = {
      huntId,
      completionCount: existing?.completionCount ?? 0,
      firstClearAt: existing?.firstClearAt ?? null,
      firstClearTimeMs: existing?.firstClearTimeMs ?? null,
      bestClearTimeMs: existing?.bestClearTimeMs ?? null,
      bestClearAt: existing?.bestClearAt ?? null,
      favorite,
    };
    this.huntProgress.set(key, next);
    return next;
  }

  static blankInventory(): (ItemStack | null)[] {
    return new Array(INVENTORY_SIZE).fill(null);
  }

  static blankLootPouch(): (ItemStack | null)[] {
    return new Array(LOOT_POUCH_SIZE).fill(null);
  }

  static blankAccountStorage(accountId: string): StoredAccountStorage {
    return {
      accountId,
      gold: ACCOUNT_CONFIG.initialGold,
      inventory: MemoryStore.blankInventory(),
      lootPouchSize: LOOT_POUCH_SIZE,
      lootPouch: MemoryStore.blankLootPouch(),
      unlockedPartySlots: 1,
      party: [],
    };
  }
}

export { BASE_SKILLS };

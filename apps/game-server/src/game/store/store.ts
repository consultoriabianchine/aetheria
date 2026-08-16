import type { CharacterEquipment, CharacterSkills, ItemStack, Position } from '@aetheria/types';

export interface AccountRecord {
  id: string;
  username: string;
  passwordHash: string;
}

export interface StoredCharacter {
  id: string;
  accountId: string;
  name: string;
  level: number;
  experience: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  position: Position;
  skills: CharacterSkills;
  inventory: (ItemStack | null)[];
  equipment: CharacterEquipment;
}

export const STORE = Symbol('STORE');

export interface Store {
  findAccountByUsername(username: string): Promise<AccountRecord | null>;
  createAccount(username: string, passwordHash: string): Promise<AccountRecord>;
  listCharacters(accountId: string): Promise<StoredCharacter[]>;
  createCharacter(accountId: string, data: Omit<StoredCharacter, 'id' | 'accountId'>): Promise<StoredCharacter>;
  findCharacterById(id: string): Promise<StoredCharacter | null>;
  saveCharacter(character: StoredCharacter): Promise<void>;
}
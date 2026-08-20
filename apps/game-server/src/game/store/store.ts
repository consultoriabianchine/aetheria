import type { CharacterEquipment, CharacterSkills, CombatArchetype, HuntProgress, ItemStack, PlayerAppearance, Position } from '@aetheria/types';

export interface AccountRecord {
  id: string;
  username: string;
  passwordHash: string;
}

export interface StoredCharacter {
  id: string;
  accountId: string;
  name: string;
  archetype: CombatArchetype;
  gold: number;
  level: number;
  experience: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  position: Position;
  skills: CharacterSkills;
  skillProgress: { skillType: keyof CharacterSkills; level: number; experience: number }[];
  inventory: (ItemStack | null)[];
  lootPouchSize: number;
  lootPouch: (ItemStack | null)[];
  equipment: CharacterEquipment;
  appearance?: PlayerAppearance;
}

export type PromotionError =
  | 'CHARACTER_NOT_FOUND'
  | 'CHARACTER_NOT_OWNED'
  | 'PROMOTION_LEVEL_REQUIRED'
  | 'PROMOTION_NOT_ENOUGH_GOLD'
  | 'ALREADY_PROMOTED';

export const STORE = Symbol('STORE');

export interface Store {
  findAccountByUsername(username: string): Promise<AccountRecord | null>;
  createAccount(username: string, passwordHash: string): Promise<AccountRecord>;
  listCharacters(accountId: string): Promise<StoredCharacter[]>;
  createCharacter(accountId: string, data: Omit<StoredCharacter, 'id' | 'accountId'>): Promise<StoredCharacter>;
  findCharacterById(id: string): Promise<StoredCharacter | null>;
  saveCharacter(character: StoredCharacter): Promise<void>;
  /** Progresso de uma Hunt para o personagem (ou null se nunca concluída). */
  getHuntProgress(characterId: string, huntId: string): Promise<HuntProgress | null>;
  /** Progresso de todas as Hunts do personagem. */
  listHuntProgress(characterId: string): Promise<HuntProgress[]>;
  /** Registra uma conclusão (idempotente por transação da run): contagem +1 e speedrun. */
  recordHuntCompletion(characterId: string, huntId: string, clearTimeMs: number): Promise<HuntProgress>;
}

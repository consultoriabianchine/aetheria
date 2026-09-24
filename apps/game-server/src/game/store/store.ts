import type { CharacterEquipment, CharacterSkills, CombatArchetype, HuntProgress, ItemStack, PlayerAppearance, PlayerCombatConfig, Position, WeaponElementOverride } from '@aetheria/types';

export interface AccountRecord {
  id: string;
  username: string;
  passwordHash: string;
}

export interface StoredCharacterEffect {
  type: 'weapon_element_override';
  override: WeaponElementOverride;
}

export interface StoredCharacter {
  id: string;
  accountId: string;
  name: string;
  archetype: CombatArchetype;
  level: number;
  experience: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  position: Position;
  skills: CharacterSkills;
  skillProgress: { skillType: keyof CharacterSkills; level: number; experience: number }[];
  equipment: CharacterEquipment;
  appearance?: PlayerAppearance;
  combat?: PlayerCombatConfig;
}

/** Storage compartilhado da conta (gold + inventário + loot pouch + party). */
export interface StoredAccountStorage {
  accountId: string;
  gold: number;
  inventory: (ItemStack | null)[];
  lootPouchSize: number;
  lootPouch: (ItemStack | null)[];
  unlockedPartySlots: number;
  /** IDs dos personagens convocados (formação persistida). */
  party: string[];
}

export interface AbyssMetaProgression {
  accountId: string;
  fragments: number;
  unlockedNodes: string[];
  rerolls: number;
  revives: number;
}

export interface AbyssRunHistory {
  accountId: string;
  characterId: string;
  result: 'completed' | 'defeated' | 'abandoned';
  durationMs: number;
  level: number;
  torment: number;
  fragments: number;
  rewards: string[];
  seed: number;
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
  getAccountStorage(accountId: string): Promise<StoredAccountStorage | null>;
  saveAccountStorage(storage: StoredAccountStorage): Promise<void>;
  getWeaponElementOverride(characterId: string): Promise<WeaponElementOverride | null>;
  saveWeaponElementOverride(characterId: string, override: WeaponElementOverride): Promise<void>;
  clearWeaponElementOverride(characterId: string): Promise<void>;
  /** Progresso de uma Hunt para o personagem (ou null se nunca concluída). */
  getHuntProgress(characterId: string, huntId: string): Promise<HuntProgress | null>;
  /** Progresso de todas as Hunts do personagem. */
  listHuntProgress(characterId: string): Promise<HuntProgress[]>;
  /** Registra uma conclusão (idempotente por transação da run): contagem +1 e speedrun. */
  recordHuntCompletion(characterId: string, huntId: string, clearTimeMs: number): Promise<HuntProgress>;
  /** Marca/desmarca uma Hunt como favorita (persistido por personagem). */
  setHuntFavorite(characterId: string, huntId: string, favorite: boolean): Promise<HuntProgress>;
  getAbyssMeta(accountId: string): Promise<AbyssMetaProgression>;
  saveAbyssMeta(meta: AbyssMetaProgression): Promise<void>;
  recordAbyssRun(history: AbyssRunHistory): Promise<void>;
}

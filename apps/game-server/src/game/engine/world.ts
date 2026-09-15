import type {
  CharacterEquipment,
  CharacterSkills,
  CombatArchetype,
  Direction,
  ItemDefinition,
  ItemStack,
  NpcDialogue,
  PlayerAppearance,
  PlayerCombatConfig,
  Position,
  WeaponElementOverride,
} from '@aetheria/types';
import type { StoredAccountStorage, StoredCharacter } from '../store/store';
import { ARCHETYPES, INVENTORY_SIZE, LOOT_POUCH_SIZE, PLAYER_AI, PLAYER_SPEED, SPEED_PER_LEVEL, playerMoveInterval } from '@aetheria/config';
import { calculateMaxHp, calculateMaxMana } from '../stats/stat-engine';

export interface NpcEntity {
  id: string;
  name: string;
  position: Position;
  dialogue: NpcDialogue;
}

export interface GroundItem {
  id: string;
  itemId: string;
  name: string;
  quantity: number;
  position: Position;
  expiresAt: number;
}

export class GamePlayer {
  id: string;
  accountId: string;
  name: string;
  archetype: CombatArchetype;
  position: Position;
  level = 1;
  experience = 0;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  baseMaxHealth: number;
  baseMaxMana: number;
  skills: CharacterSkills;
  skillProgress: { skillType: keyof CharacterSkills; level: number; experience: number }[] = [];
  equipment: CharacterEquipment;
  appearance: PlayerAppearance | undefined;
  combat: PlayerCombatConfig;
  facing: Direction = 'south';
  attackBase: number;
  defenseBase: number;
  speed: number;
  moveIntervalMs: number;
  moveDir: Direction | null = null;
  nextMoveAt = 0;
  attackCooldownUntil = 0;
  targetId: string | null = null;
  socketId: string | null = null;
  lastChatAt = 0;
  lastSavedAt = 0;
  lastRegenAt = 0;
  weaponElementOverride: WeaponElementOverride | undefined;

  constructor(character: StoredCharacter) {
    this.id = character.id;
    this.accountId = character.accountId;
    this.name = character.name;
    this.archetype = character.archetype;
    this.position = { ...character.position };
    this.level = character.level;
    this.experience = character.experience;
    this.maxHealth = character.maxHealth;
    this.health = character.health;
    this.maxMana = character.maxMana;
    this.mana = character.mana;
    this.baseMaxHealth = character.maxHealth;
    this.baseMaxMana = character.maxMana;
    this.skills = { ...character.skills };
    this.skillProgress = character.skillProgress.map((progress) => ({ ...progress }));
    this.equipment = {
      helmet: character.equipment.helmet ? { ...character.equipment.helmet } : undefined,
      armor: character.equipment.armor ? { ...character.equipment.armor } : undefined,
      legs: character.equipment.legs ? { ...character.equipment.legs } : undefined,
      boots: character.equipment.boots ? { ...character.equipment.boots } : undefined,
      ring: character.equipment.ring ? { ...character.equipment.ring } : undefined,
      necklace: character.equipment.necklace ? { ...character.equipment.necklace } : undefined,
      relic: character.equipment.relic ? { ...character.equipment.relic } : undefined,
      weapon: character.equipment.weapon ? { ...character.equipment.weapon } : undefined,
      offhand: character.equipment.offhand ? { ...character.equipment.offhand } : undefined,
      ammo: character.equipment.ammo ? { ...character.equipment.ammo } : undefined,
    };
    this.appearance = character.appearance ? { ...character.appearance } : undefined;
    const profile = PLAYER_AI[character.archetype];
    this.combat = character.combat ? { ...character.combat } : { targeting: profile.targeting, movement: profile.movement };
    this.attackBase = character.level + 8;
    this.defenseBase = 5 + Math.floor(character.level / 2);
    this.speed = PLAYER_SPEED[character.archetype] + SPEED_PER_LEVEL * Math.max(0, character.level - 1);
    this.moveIntervalMs = playerMoveInterval(this.speed);
    this.lastRegenAt = Date.now();
  }

  /** Recalcula velocidade (base + level + equipamento) e o intervalo de passo. */
  recomputeSpeed(getItem: (itemId: string) => ItemDefinition | undefined) {
    let speed = PLAYER_SPEED[this.archetype] + SPEED_PER_LEVEL * Math.max(0, this.level - 1);
    for (const stack of Object.values(this.equipment)) {
      if (!stack) continue;
      speed += getItem(stack.itemId)?.combatStats?.speed ?? 0;
    }
    this.speed = speed;
    this.moveIntervalMs = playerMoveInterval(speed);
  }

  /** Recalcula vida/mana máximas (base + level + equipamento) e ajusta os valores atuais. */
  recomputeVitals(getItem: (itemId: string) => ItemDefinition | undefined) {
    const archetype = ARCHETYPES[this.archetype];
    const baseMaxHealth = calculateMaxHp(this.level, archetype);
    const baseMaxMana = calculateMaxMana(this.level, archetype);
    let maxHealth = baseMaxHealth;
    let maxMana = baseMaxMana;
    for (const stack of Object.values(this.equipment)) {
      if (!stack) continue;
      const combat = getItem(stack.itemId)?.combatStats;
      maxHealth += combat?.maxHp ?? 0;
      maxMana += combat?.maxMana ?? 0;
    }
    this.baseMaxHealth = baseMaxHealth;
    this.baseMaxMana = baseMaxMana;
    this.maxHealth = Math.max(1, Math.round(maxHealth));
    this.maxMana = Math.max(0, Math.round(maxMana));
    this.health = Math.min(this.health, this.maxHealth);
    this.mana = Math.min(this.mana, this.maxMana);
  }

  toStored(): StoredCharacter {
    return {
      id: this.id,
      accountId: this.accountId,
      name: this.name,
      archetype: this.archetype,
      level: this.level,
      experience: this.experience,
      health: this.health,
      maxHealth: this.baseMaxHealth,
      mana: this.mana,
      maxMana: this.baseMaxMana,
      position: { ...this.position },
      skills: { ...this.skills },
      skillProgress: this.skillProgress.map((progress) => ({ ...progress })),
      equipment: this.toEquipment(),
      appearance: this.appearance ? { ...this.appearance } : undefined,
      combat: { ...this.combat },
    };
  }

  private toEquipment(): CharacterEquipment {
    const eq: CharacterEquipment = {};
    for (const slot of ['helmet', 'armor', 'legs', 'boots', 'ring', 'necklace', 'relic', 'weapon', 'offhand', 'ammo'] as const) {
      const item = this.equipment[slot];
      if (item) eq[slot] = { ...item };
    }
    return eq;
  }
}

/** Storage compartilhado da conta (gold + backpack + loot pouch) em memória. */
export class AccountStorageState {
  accountId: string;
  gold: number;
  inventory: (ItemStack | null)[];
  lootPouchSize: number;
  lootPouch: (ItemStack | null)[];
  unlockedPartySlots: number;
  party: string[];

  constructor(storage: StoredAccountStorage) {
    this.accountId = storage.accountId;
    this.gold = storage.gold;
    this.inventory = storage.inventory.map((s) => (s ? { ...s } : null));
    this.lootPouchSize = Math.max(LOOT_POUCH_SIZE, storage.lootPouchSize ?? LOOT_POUCH_SIZE, storage.lootPouch?.length ?? 0);
    this.lootPouch = Array.from({ length: this.lootPouchSize }, (_, index) => {
      const stack = storage.lootPouch?.[index] ?? null;
      return stack ? { ...stack } : null;
    });
    this.unlockedPartySlots = storage.unlockedPartySlots ?? 1;
    this.party = [...(storage.party ?? [])];
  }

  static blank(accountId: string): AccountStorageState {
    return new AccountStorageState({
      accountId,
      gold: 0,
      inventory: new Array(INVENTORY_SIZE).fill(null),
      lootPouchSize: LOOT_POUCH_SIZE,
      lootPouch: new Array(LOOT_POUCH_SIZE).fill(null),
      unlockedPartySlots: 1,
      party: [],
    });
  }

  toStored(): StoredAccountStorage {
    return {
      accountId: this.accountId,
      gold: this.gold,
      inventory: this.inventory.map((s) => (s ? { ...s } : null)),
      lootPouchSize: this.lootPouchSize,
      lootPouch: this.lootPouch.map((s) => (s ? { ...s } : null)),
      unlockedPartySlots: this.unlockedPartySlots,
      party: [...this.party],
    };
  }
}

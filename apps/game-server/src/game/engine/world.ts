import type {
  CharacterEquipment,
  CharacterSkills,
  CombatArchetype,
  Direction,
  ItemStack,
  NpcDialogue,
  PlayerAppearance,
  Position,
} from '@aetheria/types';
import type { StoredCharacter } from '../store/store';
import { LOOT_POUCH_SIZE } from '@aetheria/config';

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
  gold: number;
  position: Position;
  level = 1;
  experience = 0;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  skills: CharacterSkills;
  skillProgress: { skillType: keyof CharacterSkills; level: number; experience: number }[] = [];
  inventory: (ItemStack | null)[];
  lootPouchSize: number;
  lootPouch: (ItemStack | null)[];
  equipment: CharacterEquipment;
  appearance: PlayerAppearance | undefined;
  attackBase: number;
  defenseBase: number;
  moveDir: Direction | null = null;
  nextMoveAt = 0;
  attackCooldownUntil = 0;
  targetId: string | null = null;
  socketId: string | null = null;
  lastChatAt = 0;
  lastSavedAt = 0;
  lastRegenAt = 0;

  constructor(character: StoredCharacter) {
    this.id = character.id;
    this.accountId = character.accountId;
    this.name = character.name;
    this.archetype = character.archetype;
    this.gold = character.gold;
    this.position = { ...character.position };
    this.level = character.level;
    this.experience = character.experience;
    this.maxHealth = character.maxHealth;
    this.health = character.health;
    this.maxMana = character.maxMana;
    this.mana = character.mana;
    this.skills = { ...character.skills };
    this.skillProgress = character.skillProgress.map((progress) => ({ ...progress }));
    this.inventory = character.inventory.map((s) => (s ? { ...s } : null));
    this.lootPouchSize = Math.max(LOOT_POUCH_SIZE, character.lootPouchSize ?? LOOT_POUCH_SIZE, character.lootPouch?.length ?? 0);
    this.lootPouch = Array.from({ length: this.lootPouchSize }, (_, index) => {
      const stack = character.lootPouch?.[index] ?? null;
      return stack ? { ...stack } : null;
    });
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
    this.attackBase = character.level + 8;
    this.defenseBase = 5 + Math.floor(character.level / 2);
    this.lastRegenAt = Date.now();
  }

  toStored(): StoredCharacter {
    return {
      id: this.id,
      accountId: this.accountId,
      name: this.name,
      archetype: this.archetype,
      gold: this.gold,
      level: this.level,
      experience: this.experience,
      health: this.health,
      maxHealth: this.maxHealth,
      mana: this.mana,
      maxMana: this.maxMana,
      position: { ...this.position },
      skills: { ...this.skills },
      skillProgress: this.skillProgress.map((progress) => ({ ...progress })),
      inventory: this.inventory.map((s) => (s ? { ...s } : null)),
      lootPouchSize: this.lootPouchSize,
      lootPouch: this.lootPouch.map((s) => (s ? { ...s } : null)),
      equipment: this.toEquipment(),
      appearance: this.appearance ? { ...this.appearance } : undefined,
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

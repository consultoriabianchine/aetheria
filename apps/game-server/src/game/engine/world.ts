import type {
  CharacterEquipment,
  CharacterSkills,
  Direction,
  ItemStack,
  NpcDialogue,
  Position,
} from '@aetheria/types';
import type { StoredCharacter } from '../store/store';

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
  position: Position;
  level = 1;
  experience = 0;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  skills: CharacterSkills;
  inventory: (ItemStack | null)[];
  equipment: CharacterEquipment;
  attackBase: number;
  defenseBase: number;
  moveDir: Direction | null = null;
  nextMoveAt = 0;
  attackCooldownUntil = 0;
  targetId: string | null = null;
  socketId: string | null = null;
  lastChatAt = 0;
  lastSavedAt = 0;

  constructor(character: StoredCharacter) {
    this.id = character.id;
    this.accountId = character.accountId;
    this.name = character.name;
    this.position = { ...character.position };
    this.level = character.level;
    this.experience = character.experience;
    this.maxHealth = character.maxHealth;
    this.health = character.health;
    this.maxMana = character.maxMana;
    this.mana = character.mana;
    this.skills = { ...character.skills };
    this.inventory = character.inventory.map((s) => (s ? { ...s } : null));
    this.equipment = {
      head: character.equipment.head ? { ...character.equipment.head } : undefined,
      armor: character.equipment.armor ? { ...character.equipment.armor } : undefined,
      legs: character.equipment.legs ? { ...character.equipment.legs } : undefined,
      boots: character.equipment.boots ? { ...character.equipment.boots } : undefined,
      weapon: character.equipment.weapon ? { ...character.equipment.weapon } : undefined,
      shield: character.equipment.shield ? { ...character.equipment.shield } : undefined,
      ring: character.equipment.ring ? { ...character.equipment.ring } : undefined,
      amulet: character.equipment.amulet ? { ...character.equipment.amulet } : undefined,
    };
    this.attackBase = character.level + 8;
    this.defenseBase = 5 + Math.floor(character.level / 2);
  }

  toStored(): StoredCharacter {
    return {
      id: this.id,
      accountId: this.accountId,
      name: this.name,
      level: this.level,
      experience: this.experience,
      health: this.health,
      maxHealth: this.maxHealth,
      mana: this.mana,
      maxMana: this.maxMana,
      position: { ...this.position },
      skills: { ...this.skills },
      inventory: this.inventory.map((s) => (s ? { ...s } : null)),
      equipment: this.toEquipment(),
    };
  }

  private toEquipment(): CharacterEquipment {
    const eq: CharacterEquipment = {};
    for (const slot of ['head', 'armor', 'legs', 'boots', 'weapon', 'shield', 'ring', 'amulet'] as const) {
      const item = this.equipment[slot];
      if (item) eq[slot] = { ...item };
    }
    return eq;
  }
}
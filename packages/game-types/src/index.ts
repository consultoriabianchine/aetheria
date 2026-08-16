/** Posição no mundo em coordenadas de tile. */
export interface Position {
  x: number;
  y: number;
  z: number;
}

/** Direções de movimento suportadas (8 sentidos). */
export type Direction =
  | 'north'
  | 'northeast'
  | 'east'
  | 'southeast'
  | 'south'
  | 'southwest'
  | 'west'
  | 'northwest';

export type EntityKind = 'player' | 'monster' | 'npc' | 'item';

/** Entidade base do mundo. */
export interface BaseEntity {
  id: string;
  kind: EntityKind;
  name: string;
  position: Position;
}

/** Tile do mapa. */
export interface MapTile {
  x: number;
  y: number;
  z: number;
  type: number;
  walkable: boolean;
  blocksVision: boolean;
}

export interface CharacterStats {
  level: number;
  experience: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  attack: number;
  defense: number;
  speed: number;
}

export type SkillName = 'sword' | 'axe' | 'club' | 'distance' | 'magic' | 'defense';

export interface CharacterSkills {
  sword: number;
  axe: number;
  club: number;
  distance: number;
  magic: number;
  defense: number;
}

export type EquipmentSlot =
  | 'head'
  | 'armor'
  | 'legs'
  | 'boots'
  | 'weapon'
  | 'shield'
  | 'ring'
  | 'amulet';

export type ItemType =
  | 'helmet'
  | 'armor'
  | 'legs'
  | 'boots'
  | 'weapon'
  | 'shield'
  | 'ring'
  | 'amulet'
  | 'consumable'
  | 'loot'
  | 'other';

/** Definição estática de um item. */
export interface ItemDefinition {
  id: string;
  name: string;
  type: ItemType;
  weight: number;
  stackable: boolean;
  attack: number;
  defense: number;
  image: string;
  category: string;
  slot?: EquipmentSlot;
}

/** Item dentro do inventário. */
export interface ItemStack {
  itemId: string;
  quantity: number;
}

export interface CharacterEquipment {
  head?: ItemStack;
  armor?: ItemStack;
  legs?: ItemStack;
  boots?: ItemStack;
  weapon?: ItemStack;
  shield?: ItemStack;
  ring?: ItemStack;
  amulet?: ItemStack;
}

/** Resumo do personagem (inventário + equipamento). */
export interface CharacterInventory {
  slots: (ItemStack | null)[];
  equipment: CharacterEquipment;
}

export interface CharacterSummary {
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
}

export interface LootItem {
  itemId: string;
  quantity: number;
  weight: number;
}

export type MonsterState = 'IDLE' | 'WANDER' | 'CHASE' | 'ATTACK' | 'RETURN' | 'DEAD';

export interface MonsterTemplate {
  id: string;
  name: string;
  level: number;
  maxHealth: number;
  attack: number;
  defense: number;
  speed: number;
  attackRange: number;
  attackInterval: number;
  experience: number;
  aggroRadius: number;
  leashRadius: number;
  loot: LootItem[];
}

export interface NpcDialogue {
  id: string;
  title: string;
  lines: string[];
}

export interface NpcTemplate {
  id: string;
  name: string;
  dialogue: NpcDialogue;
}
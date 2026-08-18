import type { PlayerAppearance } from './outfit';

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

export type SkillType = 'sword' | 'axe' | 'club' | 'distance' | 'magic' | 'shielding';

export interface CharacterSkills {
  sword: number;
  axe: number;
  club: number;
  distance: number;
  magic: number;
  shielding: number;
}

export type VocationId = 'knight' | 'paladin' | 'sorcerer' | 'druid';

export type CombatRole = 'tank' | 'ranged' | 'caster' | 'support';

export type CombatDistance = 'melee' | 'close' | 'ranged';

export type WeaponType = 'sword' | 'axe' | 'club' | 'bow' | 'crossbow' | 'wand' | 'rod';

export interface TrainingRates {
  magic: number;
  melee: number;
  distance: number;
  shielding: number;
}

export interface RegenerationConfig {
  hpPerSecond: number;
  manaPerSecond: number;
}

export interface PromotionConfig {
  requiredLevel: number;
  goldCost: number;
  regenerationMultiplier: number;
}

export interface VocationDefinition {
  id: VocationId;
  name: string;
  promotedName: string;
  role: CombatRole;
  hpPerLevel: number;
  manaPerLevel: number;
  damageReduction: number;
  initialWeapon: string;
  initialOffhand?: string;
  primarySkill: SkillType;
  canUseShield: boolean;
  preferredDistance: CombatDistance;
  allowedWeapons: WeaponType[];
  trainingRates: TrainingRates;
  regeneration: RegenerationConfig;
  promotion: PromotionConfig;
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
  vocation: VocationId;
  promoted: boolean;
  promotedName: string;
  gold: number;
  level: number;
  experience: number;
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  position: Position;
  skills: CharacterSkills;
  appearance?: PlayerAppearance;
}

export type MonsterState = 'IDLE' | 'WANDER' | 'CHASE' | 'ATTACK' | 'RETURN' | 'DEAD';

/** Estados da máquina de estados das criaturas. */
export type CreatureState = 'IDLE' | 'WANDER' | 'CHASE' | 'ATTACK' | 'FLEE' | 'RETURN' | 'DEAD';

/** Categoria de criatura (ex.: humanoid). */
export type CreatureType = 'humanoid' | 'beast' | 'demon' | 'undead' | 'animal';

/** Definição de loot de uma criatura (chance em % por kill). */
export interface CreatureLootDefinition {
  itemId: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
}

/** Definição estática de uma criatura (persistida em creature_definitions). */
export interface CreatureDefinition {
  id: string;
  /** ID numérico permanente (creature_definitions.creature_id). */
  creatureId?: number;
  name: string;
  slug: string;
  description: string;
  type: CreatureType;
  level: number;
  health: number;
  maxHealth: number;
  attack: number;
  defense: number;
  experience: number;
  movementSpeed: number;
  attackSpeed: number;
  attackRange: number;
  viewRange: number;
  chaseRange: number;
  fleeHealthPercent: number;
  canWander: boolean;
  canChase: boolean;
  canFlee: boolean;
  returnToSpawn: boolean;
  loot: CreatureLootDefinition[];
}

/** Ponto de spawn de uma criatura (persistido em creature_spawns). */
export interface CreatureSpawnDefinition {
  creatureDefinitionId: string;
  mapId: string;
  x: number;
  y: number;
  z: number;
  respawnTime: number;
  maxInstances: number;
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

// ---------------------------------------------------------------------------
// Hunts (M3)
// ---------------------------------------------------------------------------

export type ArenaSide = 'left' | 'right';

export type HuntRunStatus = 'active' | 'completed' | 'wiped' | 'returning_to_city' | 'restarting';

export type WaveState = 'not_started' | 'spawning' | 'combat' | 'cleared' | 'transitioning';

export interface HuntMonsterEntry {
  monsterId: string;
  weight: number;
}

export interface BossStatMultipliers {
  hp: number;
  damage: number;
  xp: number;
}

export interface HuntBossDefinition {
  monsterId: string;
  name: string;
  statMultipliers: BossStatMultipliers;
}

export interface HuntTheme {
  element?: string;
  recommendedResistance?: string;
}

/** Definição estática de uma Hunt (catálogo data-driven em @aetheria/config). */
export interface HuntDefinition {
  id: string;
  name: string;
  ladderPosition: number;
  suggestedLevel: number;
  combatScore?: number;
  basePackSize: number;
  maxPackSize: number;
  monsters: HuntMonsterEntry[];
  boss: HuntBossDefinition;
  arenaId: string;
  /** Dimensões custom da masmorra (opcional — sobrescrevem o tamanho da arena). */
  arenaWidth?: number;
  arenaHeight?: number;
  /** Mapa custom (criado na Central de Comando) — substitui a arena procedural. */
  mapId?: string;
  theme?: HuntTheme;
  enabled: boolean;
}

/** Definição estática de uma arena (grid retangular determinístico). */
export interface ArenaDefinition {
  id: string;
  width: number;
  height: number;
  partySpawnSide: ArenaSide;
  monsterSpawnSide: ArenaSide;
}

/** Progresso de um personagem em uma Hunt (persistido em hunt_progress). */
export interface HuntProgress {
  huntId: string;
  completionCount: number;
  firstClearAt: number | null;
  firstClearTimeMs: number | null;
  bestClearTimeMs: number | null;
  bestClearAt: number | null;
}

/** Entrada do catálogo de Hunts enviada ao cliente (lista do ladder). */
export interface HuntListEntry {
  id: string;
  name: string;
  ladderPosition: number;
  suggestedLevel: number;
  combatScore?: number;
  basePackSize: number;
  maxPackSize: number;
  monsters: { id: string; name: string }[];
  boss: { monsterId: string; name: string };
  arenaId: string;
  theme?: HuntTheme;
  enabled: boolean;
  completionCount: number;
  firstClearTimeMs: number | null;
  bestClearTimeMs: number | null;
}

/** Visão pública de uma run de Hunt em andamento. */
export interface HuntRunView {
  huntId: string;
  huntName: string;
  wave: number;
  status: HuntRunStatus;
  loopEnabled: boolean;
  monsterCount: number;
  isBoss: boolean;
  startedAt: number;
  waveStartedAt: number;
}

export * from './animation';
export * from './outfit';
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

export type CombatArchetype = 'mage' | 'warrior' | 'archer';

export type DamageType = 'physical' | 'fire' | 'ice' | 'energy' | 'earth' | 'holy' | 'death' | 'arcane';

export type CombatSkill = 'melee' | 'distance' | 'magic';

export type SkillType = CombatSkill;

export interface CharacterSkills {
  melee: number;
  distance: number;
  magic: number;
}

export type WeaponType = 'staff' | 'sword' | 'axe' | 'club' | 'bow' | 'crossbow';

export type AmmoType = 'arrow' | 'bolt';

export type ProjectileDirection = 'north' | 'northEast' | 'east' | 'southEast' | 'south' | 'southWest' | 'west' | 'northWest';

export interface ItemProjectileVisual {
  sprite: string;
  spriteAssetId?: number;
  frameWidth: number;
  frameHeight: number;
  frames: Record<ProjectileDirection, number>;
  speedPxPerSecond?: number;
  offsetX?: number;
  offsetY?: number;
}

export interface ItemImpactVisual {
  sprite: string;
  spriteAssetId?: number;
  frameWidth: number;
  frameHeight: number;
  frames: number[];
  fps?: number;
}

export interface ItemVisualEffects {
  projectile?: ItemProjectileVisual;
  impact?: ItemImpactVisual;
}

export interface RegenerationConfig {
  hpPerSecond: number;
  manaPerSecond: number;
}

export interface ArchetypeDefinition {
  id: CombatArchetype;
  name: string;
  hpPerLevel: number;
  manaPerLevel: number;
  initialWeapon: string;
  initialOffhand?: string;
  initialAmmo?: string;
  primarySkill: SkillType;
  allowedWeapons: WeaponType[];
  regeneration: RegenerationConfig;
}

export type EquipmentSlot =
  | 'helmet'
  | 'armor'
  | 'legs'
  | 'boots'
  | 'ring'
  | 'necklace'
  | 'relic'
  | 'weapon'
  | 'offhand'
  | 'ammo';

export type ItemType =
  | 'helmet'
  | 'armor'
  | 'legs'
  | 'boots'
  | 'weapon'
  | 'ring'
  | 'necklace'
  | 'relic'
  | 'offhand'
  | 'ammo'
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
  combatStats?: ItemCombatStats;
  weapon?: WeaponDefinition;
  ammo?: AmmoDefinition;
  visual?: ItemVisualEffects;
}

export interface ItemCombatStats {
  attackPower?: number;
  magicPower?: number;
  armor?: number;
  defense?: number;
  maxHp?: number;
  maxMana?: number;
  criticalChance?: number;
  criticalDamage?: number;
  accuracy?: number;
  dodge?: number;
  attackSpeedModifier?: number;
  skillBonuses?: Partial<Record<CombatSkill, number>>;
  resistances?: Partial<Record<DamageType, number>>;
}

export interface WeaponDefinition {
  itemId: string;
  weaponType: WeaponType;
  attackPower: number;
  magicPower?: number;
  damageType?: DamageType;
  range: number;
  attackIntervalMs?: number;
  twoHanded?: boolean;
  allowedAmmoType?: AmmoType;
}

export interface AmmoDefinition {
  itemId: string;
  ammoType: AmmoType;
  attackPower: number;
  elementalPower?: number;
  damageType?: DamageType;
}

/** Item dentro do inventário. */
export interface ItemStack {
  itemId: string;
  quantity: number;
}

export interface CharacterEquipment {
  helmet?: ItemStack;
  armor?: ItemStack;
  legs?: ItemStack;
  boots?: ItemStack;
  ring?: ItemStack;
  necklace?: ItemStack;
  relic?: ItemStack;
  weapon?: ItemStack;
  offhand?: ItemStack;
  ammo?: ItemStack;
}

export interface CharacterCombatStats {
  level: number;
  maxHp: number;
  maxMana: number;
  armor: number;
  defense: number;
  meleeSkill: number;
  distanceSkill: number;
  magicLevel: number;
  criticalChance: number;
  criticalDamage: number;
  accuracy: number;
  dodge: number;
  resistances: Record<DamageType, number>;
}

export interface CombatFormulaProfile {
  basePowerSource: 'weapon' | 'weapon_plus_ammo' | 'magic_weapon';
  scalingSkill: CombatSkill;
  skillCoefficient: number;
  levelCoefficient: number;
}

export interface DamageComponent {
  damageType: DamageType;
  amount: number;
}

export interface DamageEvent {
  sourceId: string;
  targetId: string;
  damageType: DamageType;
  rawDamage: number;
  mitigatedDamage: number;
  finalDamage: number;
  critical: boolean;
  timestamp: number;
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

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

export type CombatTargetingMode = 'nearest' | 'furthest' | 'lowestHp' | 'highestHp';

export type CombatMovementMode = 'kite' | 'hold' | 'engage';

export interface PlayerCombatConfig {
  targeting: CombatTargetingMode;
  movement: CombatMovementMode;
  /** Distância de ataque desejada (tiles). Sobrescreve o alcance de kite/engage. */
  attackRange?: number;
}

export type DamageType = 'physical' | 'fire' | 'ice' | 'energy' | 'earth' | 'holy' | 'death' | 'arcane';

export const DAMAGE_TYPES: readonly DamageType[] = ['physical', 'fire', 'ice', 'energy', 'earth', 'holy', 'death', 'arcane'] as const;

export type AbilityOwnerType = 'player' | 'monster' | 'both';
export type PlayerAbilityClass = CombatArchetype | 'all';
export type AbilityCategory = 'attack' | 'area' | 'rune' | 'heal' | 'support';
export type AbilityTargetMode = 'self' | 'single_enemy' | 'single_ally' | 'area_enemy' | 'area_ally' | 'directional' | 'ground';
export type AbilityPowerSource = 'fixed' | 'weapon' | 'weapon_ammo' | 'magic_weapon' | 'monster_parameters';
export type AbilityCooldownGroup = 'attack' | 'healing' | 'support';
export type AbilityAreaShape = 'square' | 'circle' | 'wave' | 'cone' | 'cross' | 'line';

export interface AbilityAreaConfig {
  shape: AbilityAreaShape;
  width: number;
  height: number;
  supportsOverride?: boolean;
  centerOnCaster?: boolean;
}

export interface AbilityParameterDefinition {
  key: string;
  label: string;
  min?: number;
  max?: number;
  defaultValue?: number;
}

export interface AbilityUseConditions {
  minTargets?: number;
  selfHpBelowPercent?: number;
  targetHpBelowPercent?: number;
  minDistance?: number;
  maxDistance?: number;
}

export interface CombatAbilityDefinition {
  abilityId: number;
  slug: string;
  name: string;
  description?: string;
  icon?: string;
  ownerType: AbilityOwnerType;
  playerClass?: PlayerAbilityClass;
  category: AbilityCategory;
  targetMode: AbilityTargetMode;
  damageType?: DamageType;
  powerSource: AbilityPowerSource;
  cooldownMs: number;
  cooldownGroup: AbilityCooldownGroup;
  rangeTiles: number;
  manaCost?: number;
  levelRequirement?: number;
  areaConfig?: AbilityAreaConfig;
  shootTypeId?: number | null;
  effectTypeId?: number | null;
  visual?: ItemVisualEffects;
  animationId?: number;
  formulaProfileId?: number;
  allowedParameters: AbilityParameterDefinition[];
  defaultParameters?: Record<string, number>;
  conditions?: AbilityUseConditions;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MonsterAbilityAssignment {
  monsterId: number;
  abilityId: number;
  enabled: boolean;
  priority: number;
  chance: number;
  cooldownOverrideMs?: number;
  /**
   * Parâmetros da magia no contexto da criatura. Para `power_source:
   * monster_parameters`, as chaves convencionais são `minDamage` e `maxDamage`
   * (dano bruto base, sorteado uniformemente entre os dois) e opcionalmente
   * `flatPower`/`powerMultiplier` para escalar o dano.
   */
  parameters?: Record<string, number>;
  conditions?: AbilityUseConditions;
}

/** Magia de criatura resolvida para uso em runtime (ability + parâmetros). */
export interface ResolvedMonsterSpell {
  ability: CombatAbilityDefinition;
  priority: number;
  chance: number;
  cooldownOverrideMs?: number;
  parameters?: Record<string, number>;
}

export interface AttackRotationSlot {
  position: 1 | 2 | 3 | 4;
  abilityId?: number;
  enabled: boolean;
  minTargets?: number;
}

export interface HealingTrigger {
  target: 'self' | 'lowest_party_member' | 'specific_party_role';
  hpBelowPercent: number;
  mpBelowPercent: number;
  potionId?: string;
}

export interface HealingRotationSlot {
  position: 1 | 2 | 3 | 4;
  abilityId?: number;
  enabled: boolean;
  trigger: HealingTrigger;
}

export interface AbilityCooldownState {
  attackGroupReadyAt: number;
  healingGroupReadyAt: number;
  abilityReadyAt: Record<number, number>;
}

export interface DamageAffinity {
  modifier: number;
  immune: boolean;
}

export type DamageAffinities = Record<DamageType, DamageAffinity>;

export type DamageTypeSource = 'fixed' | 'weapon' | 'weapon_ammo';

export interface WeaponElementOverride {
  damageType: DamageType;
  appliedAt: number;
  expiresAt: number;
  paused?: boolean;
  remainingMs?: number;
}

export function emptyDamageAffinities(): DamageAffinities {
  return Object.fromEntries(DAMAGE_TYPES.map((damageType) => [damageType, { modifier: 0, immune: false }])) as DamageAffinities;
}

export function normalizeDamageAffinities(value: unknown): DamageAffinities {
  const result = emptyDamageAffinities();
  if (!value || typeof value !== 'object') return result;
  for (const damageType of DAMAGE_TYPES) {
    const affinity = (value as Record<string, unknown>)[damageType];
    if (typeof affinity === 'number' && Number.isFinite(affinity)) result[damageType].modifier = affinity;
    else if (affinity && typeof affinity === 'object') {
      const modifier = (affinity as Record<string, unknown>).modifier;
      const immune = (affinity as Record<string, unknown>).immune;
      if (typeof modifier === 'number' && Number.isFinite(modifier)) result[damageType].modifier = modifier;
      if (typeof immune === 'boolean') result[damageType].immune = immune;
    }
  }
  return result;
}


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

/** Tipo de tiro registrável (catálogo de projéteis). */
export interface ShootTypeDefinition {
  id: number;
  slug: string;
  name: string;
  description?: string;
  projectile: ItemProjectileVisual;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Tipo de efeito registrável (catálogo de impactos ao acertar). */
export interface EffectTypeDefinition {
  id: number;
  slug: string;
  name: string;
  description?: string;
  impact: ItemImpactVisual;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
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
  initialEquipment: CharacterEquipment;
  primarySkill: SkillType;
  magicTrainingMultiplier: number;
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
  sellValue: number;
  slot?: EquipmentSlot;
  combatStats?: ItemCombatStats;
  weapon?: WeaponDefinition;
  ammo?: AmmoDefinition;
  visual?: ItemVisualEffects;
  /** Referências ao catálogo de tipos de tiro/efeito (fallback: visual inline). */
  shootTypeId?: number;
  effectTypeId?: number;
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
  speed?: number;
  skillBonuses?: Partial<Record<CombatSkill, number>>;
  resistances?: Partial<Record<DamageType, number>>;
  damageBonus?: Partial<Record<DamageType, number>>;
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
  speed: number;
  resistances: Record<DamageType, number>;
  damageBonuses: Record<DamageType, number>;
  damageAffinities?: DamageAffinities;
}

/** Stats de combate de um personagem, prontos para exibição no cliente. */
export interface CombatStatsView {
  armor: number;
  defense: number;
  criticalChance: number;
  criticalDamage: number;
  accuracy: number;
  dodge: number;
  speed: number;
  resistances: Record<DamageType, number>;
  damageBonuses: Record<DamageType, number>;
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
  lootPouchSize: number;
  lootPouch: (ItemStack | null)[];
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
  skillProgress?: { skillType: keyof CharacterSkills; level: number; experience: number }[];
  speed?: number;
  movementSpeed?: number;
  appearance?: PlayerAppearance;
  combat?: PlayerCombatConfig;
  equipment?: CharacterEquipment;
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
  /** Footprint em tiles (configuração explícita — nunca inferir do sprite). */
  footprintWidth: number;
  footprintHeight: number;
  loot: CreatureLootDefinition[];
  damageAffinities?: DamageAffinities;
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
  slug?: string;
  ladderPosition: number;
  suggestedLevel: number;
  combatScore?: number;
  /** Dificuldade visual (1–5 estrelas), separada do nível recomendado. */
  difficultyRating?: number | null;
  /** Indicador de eficiência para farm de XP (0–5); null = sem estimativa. */
  xpRating?: number | null;
  /** Indicador de eficiência para farm de loot/gold (0–5); null = sem estimativa. */
  lootRating?: number | null;
  /** Tags de busca (elementos, tipo de criatura, bioma, etc.). */
  tags?: string[];
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
  /** Hunt marcada como favorita pelo jogador (persistida por personagem). */
  favorite: boolean;
}

/** Entrada do catálogo de Hunts enviada ao cliente (lista do ladder). */
export interface HuntListEntry {
  id: string;
  name: string;
  slug?: string;
  ladderPosition: number;
  suggestedLevel: number;
  combatScore?: number;
  difficultyRating: number | null;
  xpRating: number | null;
  lootRating: number | null;
  tags: string[];
  basePackSize: number;
  maxPackSize: number;
  monsters: { id: string; creatureId: number | null; slug: string; name: string }[];
  boss: { monsterId: string; creatureId: number | null; name: string };
  arenaId: string;
  theme?: HuntTheme;
  enabled: boolean;
  completionCount: number;
  firstClearAt: number | null;
  firstClearTimeMs: number | null;
  bestClearTimeMs: number | null;
  favorite: boolean;
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
export * from './tileset';
export * from './outfit';

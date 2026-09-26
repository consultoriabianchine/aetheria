import type { ArchetypeDefinition, CombatArchetype, DamageType, NpcTemplate, PlayerCombatConfig } from '@aetheria/types';
import type { AbyssMetaNode } from '@aetheria/types';

export const ABYSS_MAP_ID = 'map_mucxf0oc';
export const TRAINING_HUNT_ID = 'hunt_muhu5tbv';
export const TRAINING_HUNT_ATTACK_SPEED_MULTIPLIER = 2;

export const ABYSS_SCALING_CONFIG = {
  waveLevelStep: 0.5,
  tormentLevelStep: 1,
  baseHealth: 70,
  healthPerLevel: 12,
  baseAttack: 4,
  attackPerLevel: 0.8,
  baseDefense: 2,
  defensePerLevel: 0.35,
  baseExperience: 20,
  experiencePerLevel: 8,
  baseMovementSpeed: 400,
  movementSpeedReductionPerLevel: 2,
  baseAttackSpeed: 1800,
  attackSpeedReductionPerLevel: 8,
  bossHealthMultiplier: 2,
  bossAttackMultiplier: 1.3,
  bossDefenseMultiplier: 1.2,
  bossExperienceMultiplier: 2,
} as const;

export const ABYSS_META_NODES = [
  { id: 'offense.damage', branch: 'offense', name: 'Abyssal Edge', cost: 10, prerequisite: undefined },
  { id: 'offense.critical', branch: 'offense', name: 'Critical Instinct', cost: 15, prerequisite: 'offense.damage' },
  { id: 'offense.rare', branch: 'offense', name: 'Rare Omens', cost: 25, prerequisite: 'offense.critical' },
  { id: 'offense.choice4', branch: 'offense', name: 'Fourth Path', cost: 40, prerequisite: 'offense.rare' },
  { id: 'defense.hp', branch: 'defense', name: 'Abyssal Vitality', cost: 10, prerequisite: undefined },
  { id: 'defense.armor', branch: 'defense', name: 'Blackened Armor', cost: 15, prerequisite: 'defense.hp' },
  { id: 'defense.revive', branch: 'defense', name: 'Second Breath', cost: 35, prerequisite: 'defense.armor' },
  { id: 'defense.shrine', branch: 'defense', name: 'Healing Shrine', cost: 40, prerequisite: 'defense.revive' },
  { id: 'arcane.power', branch: 'arcane', name: 'Arcane Core', cost: 10, prerequisite: undefined },
  { id: 'arcane.elemental', branch: 'arcane', name: 'Elemental Mastery', cost: 15, prerequisite: 'arcane.power' },
  { id: 'arcane.evolutions', branch: 'arcane', name: 'Evolving Spellcraft', cost: 25, prerequisite: 'arcane.elemental' },
  { id: 'arcane.element', branch: 'arcane', name: 'Elemental Attunement', cost: 40, prerequisite: 'arcane.evolutions' },
  { id: 'fortune.gold', branch: 'fortune', name: 'Gilded Fate', cost: 10, prerequisite: undefined },
  { id: 'fortune.drop', branch: 'fortune', name: 'Abundant Ruin', cost: 15, prerequisite: 'fortune.gold' },
  { id: 'fortune.eliteChest', branch: 'fortune', name: 'Elite Omen', cost: 25, prerequisite: 'fortune.drop' },
  { id: 'fortune.reroll', branch: 'fortune', name: 'Fortune Reborn', cost: 40, prerequisite: 'fortune.eliteChest' },
] as const satisfies readonly AbyssMetaNode[];

/** Dimensões e andar inicial do mundo. */
export const MAP_WIDTH = 64;
export const MAP_HEIGHT = 64;
export const MAP_Z = 7;

/** Códigos de tile (compartilhados com o cliente para renderização). */
export const TILE = {
  GRASS: 0,
  PATH: 1,
  WATER: 2,
  TREE: 3,
  ROCK: 4,
  WALL: 5,
} as const;

/** Tileset padrão (seed) — ids reservados 1..6 para os tiles base. */
export const DEFAULT_TILESET_ID = 1;
export const DEFAULT_TILESET_SLUG = 'aetheria-default-tiles';

/** Mapeia o código legado (0..5) para o tileId do tileset padrão. */
export const LEGACY_TILE_TO_DEFAULT_ID: Record<number, number> = {
  [TILE.GRASS]: 1,
  [TILE.PATH]: 2,
  [TILE.WATER]: 3,
  [TILE.TREE]: 4,
  [TILE.ROCK]: 5,
  [TILE.WALL]: 6,
} as const;

/** Área de interesse transmitida para o cliente. */
export const VIEW_DISTANCE_X = 15;
export const VIEW_DISTANCE_Y = 11;

export const COMBAT_TEXT_THEME: Record<DamageType | 'healing', string> = {
  physical: '#E8E8E8',
  fire: '#FF5A36',
  ice: '#55DFFF',
  energy: '#A86CFF',
  earth: '#7ED957',
  holy: '#FFD84D',
  death: '#C65AFF',
  arcane: '#4FD9FF',
  healing: '#55FF72',
};

export const COMBAT_TEXT_XP_COLOR = '#FFFFFF';
export const COMBAT_TEXT_MANA_COLOR = '#C084FC';

export const COMBAT_TEXT_ANIMATION = {
  normalDuration: 800,
  criticalDuration: 800,
  normalRise: 35,
  criticalRise: 45,
} as const;

// ---------------------------------------------------------------------------
// Tipografia do mundo (nomes, dano, cura, XP, gold, palavras de magia)

/** Stack de fonte dos textos sobre o mundo (Tahoma → Verdana → Arial → sans-serif). */
export const WORLD_TEXT_FONT = 'Tahoma, Verdana, Arial, sans-serif';

/** Cores dos textos sobre o mundo (nomes e recompensas). */
export const WORLD_TEXT_COLORS = {
  playerName: '#FFFFFF',
  partyMemberName: '#67E36F',
  monsterName: '#59E36B',
  bossName: '#FF4A4A',
  npcName: '#F0C14B',
  xp: '#FFFFFF',
  gold: '#FFD84D',
} as const;

/** Tema central de tipografia do mundo — fonte única para nome/dano/cura/XP/gold. */
export const WORLD_TEXT_THEME = {
  fontFamily: WORLD_TEXT_FONT,
  fontWeight: 700,
  stroke: {
    color: '#000000',
    width: 2,
  },
  sizes: {
    entityName: 11,
    monsterName: 10,
    bossName: 12,
    damage: 11,
    criticalDamage: 14,
    healing: 11,
    xp: 11,
    gold: 11,
    spellWords: 13,
  },
} as const;

// ---------------------------------------------------------------------------
// HUD de criaturas (nome, barra de vida, floating text)

/**
 * Posicionamento/animação do HUD que acompanha criaturas (nome, HP, dano).
 * Fonte única — não espalhar valores mágicos pelo renderer.
 * O HUD ancora no "render bounds" visual do sprite, nunca no footprint lógico.
 */
export const CREATURE_HUD_CONFIG = {
  /** Distância vertical do nome acima do topo do sprite (px). */
  nameMargin: 3,
  /** Distância da barra de vida acima do topo do sprite (px). */
  healthBarMargin: 2,
  /** Distância da barra de vida acima do topo do corpo real (px). */
  bodyTopMargin: 3,
  /** Altura da barra de vida (px). */
  healthBarHeight: 4,
  /** Largura mínima/máxima da barra de vida de criaturas normais (px). */
  minHealthBarWidth: 22,
  maxHealthBarWidth: 56,
  /** Largura máxima da barra de vida de bosses (px) — regra explícita. */
  bossMaxHealthBarWidth: 88,
  /** Fração da altura do corpo onde o dano/cura "nasce" (0=topo, 1=base). */
  damageTextHeightRatio: 0.35,
} as const;

/** Largura da barra de vida proporcional ao sprite, limitada por min/max. */
export function calculateCreatureHealthBarWidth(spriteWidth: number, isBoss = false): number {
  const max = isBoss ? CREATURE_HUD_CONFIG.bossMaxHealthBarWidth : CREATURE_HUD_CONFIG.maxHealthBarWidth;
  return Math.min(max, Math.max(CREATURE_HUD_CONFIG.minHealthBarWidth, Math.round(spriteWidth * 0.6)));
}

/** Intervalo de movimento de referência (ms por tile, com speed = 1). */
export const BASE_MOVE_INTERVAL_MS = 250;

/** Intervalo de movimento do jogador (ms por tile). Múltiplo do TICK_MS para
 *  passos uniformes (sem "anda-e-para"). */
export const MOVE_INTERVAL_MS = BASE_MOVE_INTERVAL_MS;

/** Tick do servidor (ms). */
export const TICK_MS = 50;

/** Arredonda um intervalo para múltiplo do TICK_MS (passos uniformes). */
export function snapToTick(ms: number): number {
  return Math.max(TICK_MS, Math.round(ms / TICK_MS) * TICK_MS);
}

/** Intervalo de movimento (ms/tile) a partir da velocidade do personagem. */
export function playerMoveInterval(speed: number): number {
  return snapToTick(BASE_MOVE_INTERVAL_MS / Math.max(0.5, speed));
}

/** Velocidade base por vocação (mages/archers mais rápidos que warriors). */
export const PLAYER_SPEED = {
  warrior: 0.5,
  mage: 0.57,
  archer: 0.55,
} as const;

/** Bônus de velocidade por nível acima do 1º. */
export const SPEED_PER_LEVEL = 0.01;

/** Stats base do jogador. */
export const BASE_PLAYER = {
  health: 150,
  mana: 60,
  attack: 8,
  defense: 5,
  speed: 1,
  skill: 10,
};

// ---------------------------------------------------------------------------
// Vocações (M1)

/** Valores globais do motor de vocações. */
export const GAME_CONFIG = {
  baseHp: 100,
  baseMana: 50,
  combatDistance: {
    melee: 1,
    close: 3,
    ranged: 5,
  },
} as const;

/** Arquétipos oficiais do Aetheria Idle. */
export const ARCHETYPES: Record<CombatArchetype, ArchetypeDefinition> = {
  mage: {
    id: 'mage',
    name: 'Mage',
    hpPerLevel: 5,
    manaPerLevel: 30,
    initialEquipment: {
      weapon: { itemId: 'apprentice-staff', quantity: 1 },
      offhand: { itemId: 'novice-spellbook', quantity: 1 },
      helmet: { itemId: 'leather-helmet', quantity: 1 },
      armor: { itemId: 'apprentice-robe', quantity: 1 },
      legs: { itemId: 'leather-legs', quantity: 1 },
      boots: { itemId: 'leather-boots', quantity: 1 },
    },
    primarySkill: 'magic',
    magicTrainingMultiplier: 1.2,
    allowedWeapons: ['staff'],
    regeneration: { hpPerSecond: 1, manaPerSecond: 3 },
  },
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    hpPerLevel: 15,
    manaPerLevel: 5,
    initialEquipment: {
      weapon: { itemId: 'iron-sword', quantity: 1 },
      offhand: { itemId: 'training-shield', quantity: 1 },
      helmet: { itemId: 'leather-helmet', quantity: 1 },
      armor: { itemId: 'leather-armor', quantity: 1 },
      legs: { itemId: 'leather-legs', quantity: 1 },
      boots: { itemId: 'leather-boots', quantity: 1 },
    },
    primarySkill: 'melee',
    magicTrainingMultiplier: 0.4,
    allowedWeapons: ['sword', 'axe', 'club'],
    regeneration: { hpPerSecond: 2, manaPerSecond: 1 },
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    hpPerLevel: 10,
    manaPerLevel: 15,
    initialEquipment: {
      weapon: { itemId: 'hunter-bow', quantity: 1 },
      ammo: { itemId: 'arrow', quantity: 100 },
      armor: { itemId: 'leather-armor', quantity: 1 },
      legs: { itemId: 'leather-legs', quantity: 1 },
      boots: { itemId: 'leather-boots', quantity: 1 },
    },
    primarySkill: 'distance',
    magicTrainingMultiplier: 0.9,
    allowedWeapons: ['bow', 'crossbow'],
    regeneration: { hpPerSecond: 1.5, manaPerSecond: 2 },
  },
};

// ---------------------------------------------------------------------------
// IA de combate do personagem (Hunts)

export type CombatAIProfile = PlayerCombatConfig & {
  defaultDistance: number;
};

/** Comportamento padrão por classe. Pode ser sobrescrito por personagem (combat). */
export const PLAYER_AI: Record<CombatArchetype, CombatAIProfile> = {
  warrior: { targeting: 'nearest', movement: 'maintainDistance', defaultDistance: 1 },
  mage: { targeting: 'lowestHp', movement: 'maintainDistance', defaultDistance: 5 },
  archer: { targeting: 'nearest', movement: 'maintainDistance', defaultDistance: 6 },
};

export const WEAPON_ELEMENT_OVERRIDE_CONFIG = {
  defaultDurationMs: 180_000,
  enabled: true,
} as const;

export const COMBAT_FORMULA_CONFIG = {
  levelScalingPerLevel: 0.005,
  meleeScalingPerSkill: 0.01,
  distanceScalingPerSkill: 0.01,
  magicScalingPerLevel: 0.015,
  manaAbilityMagicContribution: 0.25,
  physicalDefenseBaseConstant: 100,
  physicalDefenseLevelConstant: 10,
  baseCriticalChance: 0.05,
  baseCriticalDamage: 1.5,
  maxCriticalChance: 0.8,
  baseHitChance: 0.95,
  minHitChance: 0.05,
  maxHitChance: 1,
  maxResistance: 0.75,
  minDamageTakenModifier: -1,
  maxDamageTakenModifier: 2,
  damageVarianceMin: 0.95,
  damageVarianceMax: 1.05,
  consumableAmmo: false,
  baseAttackGroupMs: 2000,
} as const;

export const SKILL_PROGRESSION_CONFIG = {
  melee: { base: 75, quadratic: 15, actionGain: 4.0 },
  distance: { base: 75, quadratic: 15, actionGain: 4.0 },
  magic: { base: 100, quadratic: 25, actionGain: 1.5, manaGainMultiplier: 0.15, minimumGain: 1 },
} as const;

/** Multiplicadores de treino por nível da skill. */
export const SKILL_EXPERIENCE_STAGES = {
  melee: [
    { minLevel: 1, maxLevel: 50, multiplier: 10 },
    { minLevel: 51, maxLevel: 100, multiplier: 5 },
    { minLevel: 101, maxLevel: 150, multiplier: 3 },
    { minLevel: 151, maxLevel: 200, multiplier: 2 },
    { minLevel: 201, maxLevel: Infinity, multiplier: 1 },
  ],
  distance: [
    { minLevel: 1, maxLevel: 50, multiplier: 10 },
    { minLevel: 51, maxLevel: 100, multiplier: 5 },
    { minLevel: 101, maxLevel: 150, multiplier: 3 },
    { minLevel: 151, maxLevel: 200, multiplier: 2 },
    { minLevel: 201, maxLevel: Infinity, multiplier: 1 },
  ],
  magic: [
    { minLevel: 1, maxLevel: 50, multiplier: 8 },
    { minLevel: 51, maxLevel: 100, multiplier: 4 },
    { minLevel: 101, maxLevel: 150, multiplier: 2 },
    { minLevel: 151, maxLevel: Infinity, multiplier: 1 },
  ],
} as const;

export function skillExperienceMultiplierForLevel(skill: 'melee' | 'distance' | 'magic', level: number): number {
  const normalizedLevel = Math.max(1, Math.floor(level));
  return SKILL_EXPERIENCE_STAGES[skill].find((stage) => normalizedLevel <= stage.maxLevel)?.multiplier ?? 1;
}

/** Número máximo de personagens por conta. */
export const MAX_CHARACTERS_PER_ACCOUNT = 3;

/** Gold recebido uma única vez quando o storage de uma conta é criado. */
export const ACCOUNT_CONFIG = {
  initialGold: 5_000,
} as const;

/** Configuração do sistema de party (personagens da conta no campo de batalha). */
export const PARTY_CONFIG = {
  baseSlots: 1,
  maxSlots: 3,
  unlockCost: (currentSlots: number) => (currentSlots >= 2 ? 20_000 : 5_000),
} as const;

/** Distribuição de XP entre membros vivos da party. */
export const PARTY_XP_CONFIG = {
  bonusPerExtraMember: 0.10,
} as const;

/** Número de slots do inventário. */
export const INVENTORY_SIZE = 20;

/** Número de slots da Bolsa de Loot. */
export const LOOT_POUCH_SIZE = 10;

/** Configuração de expansão da Bolsa de Loot. */
export const LOOT_POUCH_EXPANSION = {
  slotsPerUpgrade: 1,
  maxSize: 60,
  goldCost: (currentSize: number) => Math.max(1000, currentSize * 250),
} as const;

/** XP necessário para subir do nível atual para o próximo (tabela do Tibia: 50L² - 150L + 200). */
export function xpForLevel(level: number): number {
  return 50 * level * level - 150 * level + 200;
}

/** Multiplicadores de XP da progressão permanente por faixa de nível. */
export const EXPERIENCE_STAGES = [
  { minLevel: 1, maxLevel: 50, multiplier: 100 },
  { minLevel: 51, maxLevel: 100, multiplier: 50 },
  { minLevel: 101, maxLevel: 150, multiplier: 20 },
  { minLevel: 151, maxLevel: 200, multiplier: 10 },
  { minLevel: 201, maxLevel: 300, multiplier: 5 },
  { minLevel: 301, maxLevel: Infinity, multiplier: 2 },
] as const;

export function experienceMultiplierForLevel(level: number): number {
  const normalizedLevel = Math.max(1, Math.floor(level));
  return EXPERIENCE_STAGES.find((stage) => normalizedLevel <= stage.maxLevel)?.multiplier ?? 1;
}

export function scaledExperienceForLevel(amount: number, level: number): number {
  return Math.max(0, Math.round(amount * experienceMultiplierForLevel(level)));
}

/** Nome original do jogo/mundo. */
export const GAME_NAME = 'Aetheria Online';

/** Seed do gerador procedural do mapa (estável entre servidor/cliente — o servidor envia o mapa). */
export const MAP_SEED = 0xA3E7;

export const SPAWN_POINT = { x: 32, y: 32, z: MAP_Z };

/** NPCs do MVP. */
export const NPC_TEMPLATES: Record<string, NpcTemplate> = {};

/** Tempo de respawn padrão de criaturas (ms). */
export const MONSTER_RESPAWN_MS = 8000;

// ---------------------------------------------------------------------------
// Sprites de criaturas (Central de Comando)

/** Padrão oficial de sprite (32×32), fonte única — não espalhar `32` pelo código. */
export const SPRITE_CONFIG = {
  defaultWidth: 32,
  defaultHeight: 32,
  /** Ancoragem default (centro-inferior do tile). */
  defaultAnchor: { x: 16, y: 32 },
  /** Footprint default em tiles (1×1). */
  defaultFootprintWidth: 1,
  defaultFootprintHeight: 1,
  /** Offset visual default (sem deslocamento). */
  defaultOffsetX: 0,
  defaultOffsetY: 0,
} as const;

/** Tamanho do tile em pixels (grid fixo do tilemap). */
export const TILE_SIZE_PX = 32;

// ---------------------------------------------------------------------------
// Outfits / aparência do jogador

/** Paleta central de cores (índice estável — não reordenar após uso). */
export const APPEARANCE_PALETTE = [
  '#d8e0ea', '#f0f0f0', '#c0c0c0', '#808080', '#404040', '#1a1a1a',
  '#7f3f2f', '#c96f4a', '#e8b48a', '#f0d8b0', '#d8b060', '#b08840',
  '#c02020', '#e06040', '#f0a060', '#f0e060', '#e0c020', '#b0a020',
  '#40a040', '#60c060', '#a0e080', '#208040', '#206060', '#40a0c0',
  '#80d0e0', '#4060c0', '#3040a0', '#6040a0', '#a060c0', '#e080c0',
  '#c04080', '#e0a0a0',
] as const;

export const APPEARANCE_COLOR_SLOTS = ['head', 'primary', 'secondary', 'detail'] as const;

/** Outfit padrão global (fallback quando o atual é desativado). */
export const DEFAULT_PLAYER_OUTFIT_SLUG = 'outfit_128';
export const DEFAULT_PLAYER_OUTFIT_ID = 2;

// ---------------------------------------------------------------------------
// IA de criaturas

/** Intervalo mínimo entre recálculos de pathfinding na perseguição (ms). */
export const PATH_RECALCULATION_INTERVAL = 500;

/** Chance por tick de uma criatura IDLE iniciar WANDER. */
export const WANDER_CHANCE_PER_TICK = 0.12;

/** Distância mínima/máxima (Chebyshev) para escolher um ponto de WANDER. */
export const WANDER_MIN_DIST = 2;
export const WANDER_MAX_DIST = 5;

/** Nº máximo de passos de um WANDER (impede vagar indefinidamente). */
export const WANDER_MAX_STEPS = 5;

/** Distância preferida ao fugir do alvo (tiles). */
export const FLEE_PREFERRED_DIST = 6;

/** Limite de passos presos consecutivos antes de forçar recálculo do caminho. */
export const CREATURE_STUCK_LIMIT = 2;

/** TTL da reserva temporária de tile (segurança contra deadlock de reserva). */
export const TILE_RESERVE_TTL_MS = 1000;

/** Jitter máximo (ms) do offset de decisão por criatura no spawn. */
export const DECISION_JITTER_MS = 80;

/** Jitter máximo (ms) do intervalo de repath por criatura. */
export const REPATH_JITTER_MS = 80;

/** Prioridade base de alvo por classe (Warrior > Archer > Mage). */
export const TARGET_PRIORITY: Record<CombatArchetype, number> = {
  warrior: 300,
  archer: 200,
  mage: 100,
};

/** Bônus de stickiness aplicado ao alvo atual (evita troca nervosa). */
export const TARGET_STICKINESS_BONUS = 150;

/** Penalidade aplicada a alvos sem caminho alcançável. */
export const TARGET_UNREACHABLE_PENALTY = 400;

/** Tempo (ms) bloqueado antes de reavaliar o alvo atual. */
export const BLOCKED_RETARGET_THRESHOLD_MS = 800;

/** Distância preferida (mín/máx, tiles) para criaturas ranged. */
export const RANGED_PREFERRED_MIN = 3;
export const RANGED_PREFERRED_MAX = 5;

/** Quantos tiles o alvo precisa se mover para forçar recálculo do caminho. */
export const PATH_RECALC_TARGET_DELTA = 3;

/** Regeneração de HP por tick enquanto a criatura está IDLE (fração do maxHealth). */
export const CREATURE_REGENERATION_PER_TICK = 0.02;

/** Quando true, eventos de criatura incluem dados de debug (path). */
export function debugCreatures(): boolean {
  return process.env.DEBUG_CREATURES === 'true';
}

/** Tempo que o loot fica no chão (ms). */
export const LOOT_LIFETIME_MS = 60000;

/** Distância máxima para interagir com um NPC. */
export const NPC_INTERACT_RANGE = 3;

/** Raio máximo de coleta de loot do chão. */
export const PICKUP_RANGE = 1.5;

/** Canais de chat disponíveis. */
export const CHAT_CHANNELS = ['local', 'world'] as const;

/** Limite de caracteres por mensagem e intervalo anti-spam. */
export const CHAT_MAX_LENGTH = 120;
export const CHAT_MIN_INTERVAL_MS = 1500;

// ---------------------------------------------------------------------------
// Hunts (M3)

/** Configuração global do motor de Hunts (fonte única — sem magic numbers). */
export const HUNT_CONFIG = {
  waveCount: 10,
  bossWave: 10,
  defaultBasePackSize: 4,
  maxPackSize: 9,
  boss: {
    hpMultiplier: 3,
    damageMultiplier: 1.5,
    xpMultiplier: 2.5,
  },
  wipe: {
    minPenaltyLevel: 50,
    goldPerLevel: 500,
    respawnMs: 2500,
  },
  waveTransitionMs: 1500,
  /** Recompensas em ouro (moeda do personagem) por clear de hunt. */
  gold: {
    clearBonus: (suggestedLevel: number) => 100 + suggestedLevel * 5,
  },
} as const;

/** Tamanho do pack de monstros para uma wave (1–9). */
export function calculatePackSize(basePackSize: number, maxPackSize: number, wave: number): number {
  return Math.min(maxPackSize, basePackSize + Math.floor((wave - 1) / 2));
}

/** Lado da escada de saída da arena (alterna a cada wave). */
export function getStairSide(wave: number): 'left' | 'right' {
  return wave % 2 === 1 ? 'left' : 'right';
}

/**
 * Dificuldade visual (1–5 estrelas) derivada do nível recomendado — usada como
 * fallback quando a Hunt não possui `difficultyRating` explícito.
 */
export function difficultyRatingFromLevel(suggestedLevel: number): number {
  if (suggestedLevel < 5) return 1;
  if (suggestedLevel < 10) return 2;
  if (suggestedLevel < 20) return 3;
  if (suggestedLevel < 35) return 4;
  return 5;
}

/**
 * Dificuldade visual (1–5) derivada do combat score de uma Hunt — alternativa
 * ao fallback por nível, para catálogos que só possuem `combatScore`.
 */
export function difficultyRatingFromScore(score: number): number {
  if (score <= 0) return 1;
  if (score < 250_000) return 1;
  if (score < 1_000_000) return 2;
  if (score < 5_000_000) return 3;
  if (score < 20_000_000) return 4;
  return 5;
}

/** Faixas de nível recomendado para o filtro lateral da Central de Hunts. */
export const LEVEL_RANGE_FILTERS: { id: string; label: string; min: number; max: number | null }[] = [
  { id: 'all', label: 'Todas', min: 0, max: null },
  { id: '1-19', label: '1–19', min: 1, max: 19 },
  { id: '20-49', label: '20–49', min: 20, max: 49 },
  { id: '50-99', label: '50–99', min: 50, max: 99 },
  { id: '100-149', label: '100–149', min: 100, max: 149 },
  { id: '150-199', label: '150–199', min: 150, max: 199 },
  { id: '200-249', label: '200–249', min: 200, max: 249 },
  { id: '250-299', label: '250–299', min: 250, max: 299 },
  { id: '300-349', label: '300–349', min: 300, max: 349 },
  { id: '350-399', label: '350–399', min: 350, max: 399 },
  { id: '400-499', label: '400–499', min: 400, max: 499 },
  { id: '500+', label: '500+', min: 500, max: null },
];

/** Arenas disponíveis (grids determinísticos). */
export const ARENAS: Record<string, import('@aetheria/types').ArenaDefinition> = {
  arena_small: { id: 'arena_small', width: 32, height: 24, partySpawnSide: 'left', monsterSpawnSide: 'right' },
  arena_basic: { id: 'arena_basic', width: 42, height: 28, partySpawnSide: 'left', monsterSpawnSide: 'right' },
  arena_wide: { id: 'arena_wide', width: 54, height: 28, partySpawnSide: 'left', monsterSpawnSide: 'right' },
};

/** Catálogo de Hunts (ladder inicial). IDs estáveis; nomes originais de Aetheria. */
export const HUNT_CATALOG: import('@aetheria/types').HuntDefinition[] = [
  {
    id: 'goblin_warren',
    name: 'Toca dos Goblins',
    ladderPosition: 1,
    suggestedLevel: 1,
    basePackSize: 4,
    maxPackSize: 9,
    monsters: [{ monsterId: 'goblin', weight: 1 }],
    boss: { monsterId: 'goblin', name: 'Goblin Chefe', statMultipliers: { hp: 3, damage: 1.5, xp: 2.5 } },
    arenaId: 'arena_small',
    theme: { element: 'physical' },
    enabled: true,
  },
  {
    id: 'elf_outpost',
    name: 'Posto de Guarda Élfico',
    ladderPosition: 2,
    suggestedLevel: 4,
    basePackSize: 4,
    maxPackSize: 9,
    monsters: [
      { monsterId: 'elf', weight: 60 },
      { monsterId: 'goblin', weight: 40 },
    ],
    boss: { monsterId: 'elf', name: 'Matriarca Élfica', statMultipliers: { hp: 3, damage: 1.5, xp: 2.5 } },
    arenaId: 'arena_basic',
    theme: { element: 'physical' },
    enabled: true,
  },
  {
    id: 'troll_cave',
    name: 'Caverna dos Trolls',
    ladderPosition: 3,
    suggestedLevel: 6,
    basePackSize: 4,
    maxPackSize: 9,
    monsters: [
      { monsterId: 'troll', weight: 65 },
      { monsterId: 'goblin', weight: 35 },
    ],
    boss: { monsterId: 'troll', name: 'Troll da Rocha', statMultipliers: { hp: 3, damage: 1.5, xp: 2.5 } },
    arenaId: 'arena_basic',
    theme: { element: 'physical' },
    enabled: true,
  },
  {
    id: 'dwarf_forge',
    name: 'Forja Anã',
    ladderPosition: 4,
    suggestedLevel: 9,
    basePackSize: 4,
    maxPackSize: 9,
    monsters: [
      { monsterId: 'dwarf', weight: 65 },
      { monsterId: 'troll', weight: 35 },
    ],
    boss: { monsterId: 'dwarf', name: 'Mestre Ferreiro', statMultipliers: { hp: 3, damage: 1.5, xp: 2.5 } },
    arenaId: 'arena_wide',
    theme: { element: 'physical' },
    enabled: true,
  },
  {
    id: 'orc_camp',
    name: 'Acampamento Orc',
    ladderPosition: 5,
    suggestedLevel: 12,
    basePackSize: 4,
    maxPackSize: 9,
    monsters: [
      { monsterId: 'orc', weight: 60 },
      { monsterId: 'dwarf', weight: 40 },
    ],
    boss: { monsterId: 'orc', name: 'Orc Chefe de Guerra', statMultipliers: { hp: 3, damage: 1.5, xp: 2.5 } },
    arenaId: 'arena_wide',
    theme: { element: 'physical' },
    enabled: true,
  },
  {
    id: 'minotaur_labyrinth',
    name: 'Labirinto do Minotauro',
    ladderPosition: 6,
    suggestedLevel: 15,
    basePackSize: 4,
    maxPackSize: 9,
    monsters: [
      { monsterId: 'minotaur', weight: 60 },
      { monsterId: 'orc', weight: 40 },
    ],
    boss: { monsterId: 'minotaur', name: 'Minotauro Ancestral', statMultipliers: { hp: 3, damage: 1.5, xp: 2.5 } },
    arenaId: 'arena_basic',
    theme: { element: 'physical' },
    enabled: true,
  },
  {
    id: 'troll_masmorra',
    name: 'Masmorra dos Trolls',
    ladderPosition: 7,
    suggestedLevel: 6,
    basePackSize: 4,
    maxPackSize: 9,
    monsters: [{ monsterId: 'troll', weight: 1 }],
    boss: { monsterId: 'troll', name: 'Troll da Rocha Rei', statMultipliers: { hp: 3, damage: 1.5, xp: 2.5 } },
    arenaId: 'arena_basic',
    arenaWidth: 24,
    arenaHeight: 16,
    theme: { element: 'physical' },
    enabled: true,
  },
  {
    id: 'dwarf_masmorra',
    name: 'Masmorra dos Anões',
    ladderPosition: 8,
    suggestedLevel: 9,
    basePackSize: 4,
    maxPackSize: 9,
    monsters: [{ monsterId: 'dwarf', weight: 1 }],
    boss: { monsterId: 'dwarf', name: 'Rei Anão da Forja', statMultipliers: { hp: 3, damage: 1.5, xp: 2.5 } },
    arenaId: 'arena_wide',
    arenaWidth: 36,
    arenaHeight: 22,
    theme: { element: 'physical' },
    enabled: true,
  },
];

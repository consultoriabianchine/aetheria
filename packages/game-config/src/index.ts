import type { ArchetypeDefinition, CombatArchetype, NpcTemplate } from '@aetheria/types';

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

/** Área de interesse transmitida para o cliente. */
export const VIEW_DISTANCE_X = 15;
export const VIEW_DISTANCE_Y = 11;

/** Intervalo de movimento do jogador (ms por tile). Múltiplo do TICK_MS para
 *  passos uniformes (sem "anda-e-para"): um passo a cada tick do servidor. */
export const MOVE_INTERVAL_MS = 200;

/** Tick do servidor (ms). */
export const TICK_MS = 200;

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
    allowedWeapons: ['bow', 'crossbow'],
    regeneration: { hpPerSecond: 1.5, manaPerSecond: 2 },
  },
};

export const COMBAT_FORMULA_CONFIG = {
  levelScalingPerLevel: 0.005,
  meleeScalingPerSkill: 0.01,
  distanceScalingPerSkill: 0.01,
  magicScalingPerLevel: 0.015,
  physicalDefenseBaseConstant: 100,
  physicalDefenseLevelConstant: 10,
  baseCriticalChance: 0.05,
  baseCriticalDamage: 1.5,
  maxCriticalChance: 0.8,
  baseHitChance: 0.95,
  minHitChance: 0.05,
  maxHitChance: 1,
  maxResistance: 0.75,
  damageVarianceMin: 0.95,
  damageVarianceMax: 1.05,
  consumableAmmo: false,
  baseAttackGroupMs: 2000,
} as const;

export const SKILL_PROGRESSION_CONFIG = {
  melee: { base: 100, quadratic: 25, actionGain: 1 },
  distance: { base: 100, quadratic: 25, actionGain: 1 },
  magic: { base: 150, quadratic: 40, manaGainMultiplier: 0.1, minimumGain: 1 },
} as const;

/** Número de slots do inventário. */
export const INVENTORY_SIZE = 24;

/** Número de slots da Bolsa de Loot. */
export const LOOT_POUCH_SIZE = 10;

/** Configuração de expansão da Bolsa de Loot. */
export const LOOT_POUCH_EXPANSION = {
  slotsPerUpgrade: 5,
  maxSize: 60,
  goldCost: (currentSize: number) => Math.max(1000, currentSize * 250),
} as const;

/** XP necessário para subir do nível atual para o próximo. */
export function xpForLevel(level: number): number {
  return level * 100;
}

/** Nome original do jogo/mundo. */
export const GAME_NAME = 'Aetheria Online';

/** Seed do gerador procedural do mapa (estável entre servidor/cliente — o servidor envia o mapa). */
export const MAP_SEED = 0xA3E7;

export const SPAWN_POINT = { x: 32, y: 32, z: MAP_Z };

/** NPCs do MVP. */
export const NPC_TEMPLATES: Record<string, NpcTemplate> = {
  guardian: {
    id: 'guardian',
    name: 'Guardião Aether',
    dialogue: {
      id: 'guardian',
      title: 'Guardião Aether',
      lines: [
        'Bem-vindo a Aetheria, viajante.',
        'As criaturas ao leste são fracas — o Lobo da Névoa ao sul exige mais coragem.',
        'Derrote os Goblins Rastejadores para ganhar experiência e saque.',
      ],
    },
  },
};

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
} as const;

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
  /** Recompensas em ouro (moeda do personagem) por kill/boss/clear. */
  gold: {
    perKill: (level: number) => Math.max(1, Math.round(level * 2)),
    boss: (level: number) => Math.max(1, Math.round(level * 10)),
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

/** Arenas disponíveis (grids determinísticos). */
export const ARENAS: Record<string, import('@aetheria/types').ArenaDefinition> = {
  arena_small: { id: 'arena_small', width: 20, height: 16, partySpawnSide: 'left', monsterSpawnSide: 'right' },
  arena_basic: { id: 'arena_basic', width: 26, height: 20, partySpawnSide: 'left', monsterSpawnSide: 'right' },
  arena_wide: { id: 'arena_wide', width: 34, height: 18, partySpawnSide: 'left', monsterSpawnSide: 'right' },
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

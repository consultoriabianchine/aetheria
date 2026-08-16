import type { MonsterTemplate, NpcTemplate } from '@aetheria/types';

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

/** Intervalo de movimento (ms por tile). */
export const MOVE_INTERVAL_MS = 250;

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

/** Número de slots do inventário. */
export const INVENTORY_SIZE = 24;

/** XP necessário para subir do nível atual para o próximo. */
export function xpForLevel(level: number): number {
  return level * 100;
}

/** Nome original do jogo/mundo. */
export const GAME_NAME = 'Aetheria Online';

/** Seed do gerador procedural do mapa (estável entre servidor/cliente — o servidor envia o mapa). */
export const MAP_SEED = 0xA3E7;

export const SPAWN_POINT = { x: 32, y: 32, z: MAP_Z };

/** Templates de monstros do MVP (nomes e atributos originais). */
export const MONSTER_TEMPLATES: Record<string, MonsterTemplate> = {
  goblin: {
    id: 'goblin',
    name: 'Goblin Rastejador',
    level: 1,
    maxHealth: 40,
    attack: 5,
    defense: 2,
    speed: 1,
    attackRange: 1,
    attackInterval: 1200,
    experience: 12,
    aggroRadius: 6,
    leashRadius: 12,
    loot: [
      { itemId: 'gold', quantity: 1, weight: 40 },
      { itemId: 'i-tear-of-forest', quantity: 1, weight: 15 },
      { itemId: 'short-sword', quantity: 1, weight: 8 },
    ],
  },
  wolf: {
    id: 'wolf',
    name: 'Lobo da Névoa',
    level: 2,
    maxHealth: 55,
    attack: 8,
    defense: 3,
    speed: 1,
    attackRange: 1,
    attackInterval: 1000,
    experience: 20,
    aggroRadius: 7,
    leashRadius: 14,
    loot: [
      { itemId: 'gold', quantity: 1, weight: 45 },
      { itemId: 'i-wolf-pelt', quantity: 1, weight: 20 },
      { itemId: 'dagger', quantity: 1, weight: 10 },
    ],
  },
};

/** Pontos de spawn de monstros (áreas). */
export const MONSTER_SPAWNS = [
  { templateId: 'goblin', x: 24, y: 26, z: MAP_Z },
  { templateId: 'goblin', x: 27, y: 23, z: MAP_Z },
  { templateId: 'goblin', x: 26, y: 30, z: MAP_Z },
  { templateId: 'goblin', x: 20, y: 28, z: MAP_Z },
  { templateId: 'wolf', x: 40, y: 38, z: MAP_Z },
  { templateId: 'wolf', x: 44, y: 42, z: MAP_Z },
  { templateId: 'wolf', x: 41, y: 46, z: MAP_Z },
];

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

/** Tempo de respawn de monstros (ms). */
export const MONSTER_RESPAWN_MS = 8000;

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
import type { NpcTemplate } from '@aetheria/types';

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
import { z } from 'zod';

/**
 * Modelo data-driven de animação de criaturas (Central de Comando).
 * A spritesheet é recortada em uma grade (spriteWidth × spriteHeight) e cada
 * AnimationSequence referencia frames por índice (row-major, começando em 0).
 */

export const ANIMATION_DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
export type AnimationDirection = (typeof ANIMATION_DIRECTIONS)[number];

export const CREATURE_ANIMATION_TYPES = ['idle', 'walk', 'attack', 'cast', 'hit', 'death', 'spawn'] as const;
export type CreatureAnimationType = (typeof CREATURE_ANIMATION_TYPES)[number];

export type PlaybackMode = 'normal' | 'pingpong';

export type AnimationMarkerEvent = 'hit' | 'projectile' | 'sound' | 'effect';

/** Ponto de ancoragem do sprite (default: centro-inferior do tile). */
export interface SpriteAnchor {
  x: number;
  y: number;
}

/** Ponto de fixação visual (coordenadas locais do sprite, origem topo-esquerdo). */
export interface SpriteSocket {
  x: number;
  y: number;
}

/**
 * Sockets opcionais para efeitos: feet (pés), center (centro do corpo),
 * head (topo) e projectileOrigin (origem de projéteis — default = center).
 */
export interface VisualSockets {
  feet?: SpriteSocket;
  center?: SpriteSocket;
  head?: SpriteSocket;
  projectileOrigin?: SpriteSocket;
}

/** Retângulo virtual de um frame dentro da spritesheet. */
export interface SpriteFrame {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Marcador de sincronização visual (não-autoritativo). */
export interface AnimationMarker {
  frameIndex: number;
  event: AnimationMarkerEvent;
}

/** Referência de frame com duração opcional (futuro). */
export interface AnimationFrameReference {
  frame: number;
  durationMs?: number;
}

/**
 * Caixa visual estável da criatura (máximo das animações), distinta do frame
 * atual da spritesheet e do footprint lógico. Usada como âncora do HUD
 * (nome, barra de vida, status, floating text) para evitar "jitter" quando
 * animações têm tamanhos diferentes (ex.: walk 64×64, attack 96×64).
 */
export interface CreatureVisualBounds {
  width: number;
  height: number;
}

/** Sequência de uma animação para uma direção. */
export interface AnimationSequence {
  animation: CreatureAnimationType;
  direction: AnimationDirection;
  frames: number[];
  frameDurationMs: number;
  loop: boolean;
  playbackMode?: PlaybackMode;
  holdLastFrameMs?: number;
}

/** Configuração de animação de uma criatura (persistida em JSONB validado). */
export interface CreatureAnimationConfig {
  version: number;
  spriteWidth: number;
  spriteHeight: number;
  sheetColumns: number;
  sheetRows: number;
  anchor?: SpriteAnchor;
  /** Deslocamento visual do sprite relativo à base (pés). Default 0. */
  offsetX?: number;
  offsetY?: number;
  sockets?: VisualSockets;
  /** Caixa visual estável (máximo das animações) para ancorar o HUD. */
  visualBounds?: CreatureVisualBounds;
  /**
   * Corpo real visível da criatura (exclui pixels transparentes do frame).
   * Ancora nome/HP/dano. Ex.: sprite 64×64 com corpo de 40×40.
   */
  bodyWidth?: number;
  bodyHeight?: number;
  /**
   * Deslocamento fino do HUD (nome/HP/dano) relativo ao corpo, para alinhar
   * com a cabeça/corpo visível. Em px, assinado: X>0 = direita, Y>0 = baixo.
   */
  bodyOffsetX?: number;
  bodyOffsetY?: number;
  animations: AnimationSequence[];
}

// ---------------------------------------------------------------------------
// Zod (validação compartilhada servidor + admin)
// ---------------------------------------------------------------------------

const spriteAnchorSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const spriteSocketSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const visualSocketsSchema = z.object({
  feet: spriteSocketSchema.optional(),
  center: spriteSocketSchema.optional(),
  head: spriteSocketSchema.optional(),
  projectileOrigin: spriteSocketSchema.optional(),
});

const creatureVisualBoundsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const animationSequenceSchema = z.object({
  animation: z.enum(CREATURE_ANIMATION_TYPES),
  direction: z.enum(ANIMATION_DIRECTIONS),
  frames: z.array(z.number().int().nonnegative()),
  frameDurationMs: z.number().int().positive(),
  loop: z.boolean(),
  playbackMode: z.enum(['normal', 'pingpong']).optional(),
  holdLastFrameMs: z.number().int().nonnegative().optional(),
});

/** Valida a configuração de animação (sem o campo version, gerido pelo server). */
export const creatureAnimationConfigSchema = z.object({
  spriteWidth: z.number().int().positive(),
  spriteHeight: z.number().int().positive(),
  sheetColumns: z.number().int().positive(),
  sheetRows: z.number().int().positive(),
  anchor: spriteAnchorSchema.optional(),
  offsetX: z.number().int().optional(),
  offsetY: z.number().int().optional(),
  sockets: visualSocketsSchema.optional(),
  visualBounds: creatureVisualBoundsSchema.optional(),
  bodyWidth: z.number().int().positive().optional(),
  bodyHeight: z.number().int().positive().optional(),
  bodyOffsetX: z.number().int().optional(),
  bodyOffsetY: z.number().int().optional(),
  animations: z.array(animationSequenceSchema),
});

export type CreatureAnimationConfigInput = z.infer<typeof creatureAnimationConfigSchema>;

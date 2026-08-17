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
  animations: AnimationSequence[];
}

// ---------------------------------------------------------------------------
// Zod (validação compartilhada servidor + admin)
// ---------------------------------------------------------------------------

const spriteAnchorSchema = z.object({
  x: z.number(),
  y: z.number(),
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
  animations: z.array(animationSequenceSchema),
});

export type CreatureAnimationConfigInput = z.infer<typeof creatureAnimationConfigSchema>;

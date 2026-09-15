import type { EffectTypeDefinition, ItemImpactVisual, ItemProjectileVisual, ProjectileDirection, ShootTypeDefinition } from '@aetheria/types';
import type { PrismaService } from '../../prisma/prisma.service';

let shootTypes = new Map<number, ShootTypeDefinition>();
let effectTypes = new Map<number, EffectTypeDefinition>();

/** Carrega o catálogo de tipos de tiro/efeito (cache compartilhado servidor/admin). */
export async function loadShootEffectCatalog(prisma: PrismaService | undefined): Promise<void> {
  if (!prisma) {
    shootTypes = new Map();
    effectTypes = new Map();
    return;
  }
  const [shoots, effects] = await Promise.all([
    prisma.shootType.findMany({ orderBy: { name: 'asc' } }),
    prisma.effectType.findMany({ orderBy: { name: 'asc' } }),
  ]);
  shootTypes = new Map(shoots.map((row) => [row.id, toShootDefinition(row as never)]));
  effectTypes = new Map(effects.map((row) => [row.id, toEffectDefinition(row as never)]));
}

export function getShootType(id: number | undefined): ShootTypeDefinition | undefined {
  if (!id) return undefined;
  return shootTypes.get(id);
}

export function getEffectType(id: number | undefined): EffectTypeDefinition | undefined {
  if (!id) return undefined;
  return effectTypes.get(id);
}

export function listShootTypes(): ShootTypeDefinition[] {
  return [...shootTypes.values()];
}

export function listEffectTypes(): EffectTypeDefinition[] {
  return [...effectTypes.values()];
}

function toShootDefinition(row: {
  id: number; slug: string; name: string; description: string | null; sprite: string;
  spriteAssetId: number | null; frameWidth: number; frameHeight: number;
  frames: Record<string, number>; speedPxPerSecond: number | null; offsetX: number | null; offsetY: number | null;
  enabled: boolean; createdAt: Date; updatedAt: Date;
}): ShootTypeDefinition {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    projectile: {
      sprite: row.sprite ?? '',
      spriteAssetId: row.spriteAssetId ?? undefined,
      frameWidth: row.frameWidth,
      frameHeight: row.frameHeight,
      frames: row.frames as Record<ProjectileDirection, number>,
      speedPxPerSecond: row.speedPxPerSecond ?? undefined,
      offsetX: row.offsetX ?? undefined,
      offsetY: row.offsetY ?? undefined,
    },
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toEffectDefinition(row: {
  id: number; slug: string; name: string; description: string | null; sprite: string;
  spriteAssetId: number | null; frameWidth: number; frameHeight: number;
  frames: number[]; fps: number | null; enabled: boolean; createdAt: Date; updatedAt: Date;
}): EffectTypeDefinition {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description ?? undefined,
    impact: {
      sprite: row.sprite ?? '',
      spriteAssetId: row.spriteAssetId ?? undefined,
      frameWidth: row.frameWidth,
      frameHeight: row.frameHeight,
      frames: row.frames ?? [],
      fps: row.fps ?? undefined,
    },
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

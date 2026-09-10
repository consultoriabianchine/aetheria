import type { ItemImpactVisual, ItemProjectileVisual, ItemVisualEffects } from '@aetheria/types';

export function isProjectileVisual(value: unknown): value is ItemProjectileVisual {
  if (typeof value !== 'object' || value === null) return false;
  const visual = value as { sprite?: unknown; spriteAssetId?: unknown };
  return (typeof visual.sprite === 'string' && visual.sprite.trim().length > 0) || (typeof visual.spriteAssetId === 'number' && visual.spriteAssetId > 0);
}

export function isImpactVisual(value: unknown): value is ItemImpactVisual {
  if (typeof value !== 'object' || value === null) return false;
  const visual = value as { sprite?: unknown; spriteAssetId?: unknown };
  return (typeof visual.sprite === 'string' && visual.sprite.trim().length > 0) || (typeof visual.spriteAssetId === 'number' && visual.spriteAssetId > 0);
}

/** Normaliza um visual de projétil/impacto, mantendo apenas os campos válidos. */
export function normalizeVisual(visual: ItemVisualEffects | null | undefined): ItemVisualEffects | undefined {
  if (!visual) return undefined;
  const next: ItemVisualEffects = {};
  if (isProjectileVisual(visual.projectile)) next.projectile = visual.projectile;
  if (isImpactVisual(visual.impact)) next.impact = visual.impact;
  return Object.keys(next).length ? next : undefined;
}

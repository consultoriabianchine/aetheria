import type { Position, SpriteAnchor, VisualSockets } from '@aetheria/types';

/**
 * Posição-base (pés) de uma entidade a partir do tile lógico.
 * Referência: centro inferior do tile. O sprite é desenhado relativamente a
 * esse ponto — nunca usar o canto superior esquerdo como posição principal.
 */
export function tileBase(position: Pick<Position, 'x' | 'y'>, tileSize = 32): { x: number; y: number } {
  return { x: position.x * tileSize + tileSize / 2, y: position.y * tileSize + tileSize };
}

/** Ancoragem default (bottom-center) quando nenhuma é configurada. */
export function resolveAnchor(spriteWidth: number, spriteHeight: number, anchor?: SpriteAnchor | null): SpriteAnchor {
  if (anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) return { x: anchor.x, y: anchor.y };
  return { x: spriteWidth / 2, y: spriteHeight };
}

/** Origin normalizado do Phaser (0..1) a partir do anchor em px. */
export function anchorOrigin(anchor: SpriteAnchor, spriteWidth: number, spriteHeight: number): { x: number; y: number } {
  return {
    x: spriteWidth > 0 ? anchor.x / spriteWidth : 0.5,
    y: spriteHeight > 0 ? anchor.y / spriteHeight : 1,
  };
}

/** Sockets visuais (feet/center/head/projectileOrigin) com defaults derivados. */
export function resolveSockets(spriteWidth: number, spriteHeight: number, sockets?: VisualSockets | null): Required<VisualSockets> {
  const center = { x: spriteWidth / 2, y: spriteHeight / 2 };
  return {
    feet: sockets?.feet ?? { x: spriteWidth / 2, y: spriteHeight },
    center: sockets?.center ?? sockets?.projectileOrigin ?? center,
    head: sockets?.head ?? { x: spriteWidth / 2, y: 0 },
    projectileOrigin: sockets?.projectileOrigin ?? sockets?.center ?? center,
  };
}

/** Topo visual do sprite (para healthbar/nome), baseado no anchor e offset. */
export function spriteTopPx(baseY: number, anchorY: number, offsetY = 0): number {
  return baseY + offsetY - anchorY;
}

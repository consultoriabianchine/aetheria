import { describe, expect, it } from 'vitest';
import { anchorOrigin, resolveAnchor, resolveSockets, spriteTopPx, tileBase } from '@aetheria/shared';

describe('entity-anchor (posicionamento de sprites)', () => {
  it('calcula a base (pés) a partir do tile lógico', () => {
    expect(tileBase({ x: 10, y: 5 }, 32)).toEqual({ x: 10 * 32 + 16, y: 5 * 32 + 32 });
  });

  it('usa anchor bottom-center por default', () => {
    expect(resolveAnchor(64, 64)).toEqual({ x: 32, y: 64 });
    expect(resolveAnchor(32, 32)).toEqual({ x: 16, y: 32 });
  });

  it('respeita anchor customizado', () => {
    expect(resolveAnchor(96, 64, { x: 48, y: 64 })).toEqual({ x: 48, y: 64 });
  });

  it('converte anchor em origin normalizado do Phaser', () => {
    expect(anchorOrigin({ x: 32, y: 64 }, 64, 64)).toEqual({ x: 0.5, y: 1 });
    expect(anchorOrigin({ x: 48, y: 96 }, 96, 96)).toEqual({ x: 0.5, y: 1 });
  });

  it('resolve sockets com defaults (feet/center/head/projectileOrigin)', () => {
    const sockets = resolveSockets(64, 64);
    expect(sockets.feet).toEqual({ x: 32, y: 64 });
    expect(sockets.center).toEqual({ x: 32, y: 32 });
    expect(sockets.head).toEqual({ x: 32, y: 0 });
    expect(sockets.projectileOrigin).toEqual({ x: 32, y: 32 });
  });

  it('calcula o topo visual pelo anchor (healthbar/nome)', () => {
    expect(spriteTopPx(320, 64, 0)).toBe(256);
    expect(spriteTopPx(320, 32, 0)).toBe(288);
  });
});

import { describe, expect, it } from 'vitest';
import { creatureAnimationConfigSchema } from '@aetheria/types';

const base = {
  spriteWidth: 32,
  spriteHeight: 32,
  sheetColumns: 4,
  sheetRows: 2,
  animations: [{ animation: 'walk', direction: 'south', frames: [{ frameIndex: 0, maskFrameIndex: 1 }, { frameIndex: 2, maskFrameIndex: 3 }], frameDurationMs: 120, loop: true }],
};

describe('animation frame masks', () => {
  it('accepts explicit visual and mask frame pairs', () => {
    const result = creatureAnimationConfigSchema.parse({ ...base, supportsColorization: true, colorMaskMode: 'paired_frames' });
    expect(result.animations[0].frames[0]).toMatchObject({ frameIndex: 0, maskFrameIndex: 1 });
  });

  it('normalizes legacy numeric frames without inventing masks', () => {
    const result = creatureAnimationConfigSchema.parse({ ...base, animations: [{ ...base.animations[0], frames: [4, 6] }] });
    expect(result.animations[0].frames).toEqual([{ frameIndex: 4 }, { frameIndex: 6 }]);
  });

  it('allows colorization to be disabled with incomplete mappings', () => {
    expect(() => creatureAnimationConfigSchema.parse({ ...base, supportsColorization: false, colorMaskMode: 'none', animations: [{ ...base.animations[0], frames: [{ frameIndex: 0 }] }] })).not.toThrow();
  });

  it('supports complete walk mappings in every direction', () => {
    const directions = ['north', 'east', 'south', 'west'] as const;
    const animations = directions.map((direction) => ({
      animation: 'walk' as const,
      direction,
      frames: Array.from({ length: 8 }, (_, index) => ({ frameIndex: index * 2, maskFrameIndex: index * 2 + 1 })),
      frameDurationMs: 120,
      loop: true,
    }));
    const result = creatureAnimationConfigSchema.parse({ ...base, supportsColorization: true, colorMaskMode: 'paired_frames', animations });
    expect(result.animations).toHaveLength(4);
    expect(result.animations.every((sequence) => sequence.frames.every((frame) => 'maskFrameIndex' in frame))).toBe(true);
  });
});

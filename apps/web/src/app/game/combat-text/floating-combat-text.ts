import type Phaser from 'phaser';
import type { DamageType } from '@aetheria/types';

export type CombatTextType = 'damage' | 'healing' | 'xp' | 'gold';

export interface FloatingCombatText {
  id: number;
  entityId: string;
  value: number;
  type: CombatTextType;
  damageType?: DamageType;
  critical: boolean;
  worldX: number;
  worldY: number;
  createdAt: number;
  duration: number;
  riseDistance: number;
  text: Phaser.GameObjects.Text | null;
}

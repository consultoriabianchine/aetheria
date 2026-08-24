import type Phaser from 'phaser';
import { COMBAT_TEXT_ANIMATION, COMBAT_TEXT_THEME } from '@aetheria/config';
import type { DamageType } from '@aetheria/types';
import { CombatTextPool } from './combat-text-pool';
import type { FloatingCombatText } from './floating-combat-text';

export interface CombatTextDamageEvent {
  targetId: string;
  amount: number;
  damageType?: DamageType;
  critical: boolean;
  delayMs?: number;
}

export interface CombatTextHealEvent {
  targetId: string;
  amount: number;
  critical: boolean;
  delayMs?: number;
}

interface WorldPosition {
  x: number;
  y: number;
  spriteHeight: number;
}

export class CombatTextManager {
  private readonly active: FloatingCombatText[] = [];
  private readonly entityStacks = new Map<string, number>();
  private nextId = 1;
  private readonly pool: CombatTextPool;

  constructor(private readonly scene: Phaser.Scene, private readonly positionOf: (entityId: string) => WorldPosition | null) {
    this.pool = new CombatTextPool(scene);
  }

  spawnDamage(event: CombatTextDamageEvent) {
    this.spawn(event.targetId, event.amount, 'damage', event.damageType ?? 'physical', event.critical, event.delayMs);
  }

  spawnHealing(event: CombatTextHealEvent) {
    this.spawn(event.targetId, event.amount, 'healing', undefined, event.critical, event.delayMs);
  }

  update(now: number) {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      const progress = Math.min(1, (now - item.createdAt) / item.duration);
      if (progress >= 1) {
        this.pool.release(item);
        this.active.splice(i, 1);
        continue;
      }
      const eased = 1 - Math.pow(1 - progress, 2);
      const fade = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const scale = item.critical
        ? progress < 0.1 ? 0.7 + progress * 5.5 : progress < 0.225 ? 1.25 - (progress - 0.1) * 2 : 1
        : 1 - progress * 0.05;
      item.text?.setPosition(item.worldX + item.offsetX, item.worldY - item.offsetY - item.riseDistance * eased)
        .setAlpha(fade)
        .setScale(scale);
    }
  }

  clear() {
    for (const item of this.active) this.pool.release(item);
    this.active.length = 0;
    this.entityStacks.clear();
  }

  private spawn(entityId: string, value: number, type: 'damage' | 'healing', damageType: DamageType | undefined, critical: boolean, delayMs = 0) {
    const position = this.positionOf(entityId);
    if (!position || value < 0) return;
    const create = () => {
      const stack = this.entityStacks.get(entityId) ?? 0;
      const offset = COMBAT_TEXT_ANIMATION.spawnOffsets[stack % COMBAT_TEXT_ANIMATION.spawnOffsets.length];
      this.entityStacks.set(entityId, stack + 1);
      const item: FloatingCombatText = {
        id: this.nextId++, entityId, value, type, damageType, critical,
        worldX: position.x, worldY: position.y - position.spriteHeight * 0.5,
        offsetX: offset, offsetY: stack % 3 * 4, createdAt: this.scene.time.now,
        duration: critical ? COMBAT_TEXT_ANIMATION.criticalDuration : COMBAT_TEXT_ANIMATION.normalDuration,
        riseDistance: critical ? COMBAT_TEXT_ANIMATION.criticalRise : COMBAT_TEXT_ANIMATION.normalRise,
        text: null,
      };
      const text = this.pool.acquire();
      text.setText(`${type === 'healing' ? '+' : '-'}${new Intl.NumberFormat('pt-BR').format(value)}`)
        .setFontSize(`${critical ? COMBAT_TEXT_ANIMATION.criticalFontSize : COMBAT_TEXT_ANIMATION.normalFontSize}px`)
        .setColor(COMBAT_TEXT_THEME[type === 'healing' ? 'healing' : damageType ?? 'physical'])
        .setPosition(item.worldX + offset, item.worldY - item.offsetY)
        .setOrigin(0.5)
        .setDepth(120)
        .setVisible(true)
        .setActive(true);
      item.text = text;
      this.active.push(item);
      if (this.active.filter((entry) => entry.entityId === entityId).length > COMBAT_TEXT_ANIMATION.maxVisiblePerEntity) {
        const oldest = this.active.findIndex((entry) => entry.entityId === entityId);
        if (oldest >= 0) this.pool.release(this.active.splice(oldest, 1)[0]);
      }
    };
    if (delayMs > 0) this.scene.time.delayedCall(delayMs, create);
    else create();
  }
}

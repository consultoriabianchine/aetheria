import type Phaser from 'phaser';
import { COMBAT_TEXT_ANIMATION, COMBAT_TEXT_MANA_COLOR, COMBAT_TEXT_THEME, COMBAT_TEXT_XP_COLOR, WORLD_TEXT_COLORS, WORLD_TEXT_THEME } from '@aetheria/config';
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
  resource?: 'hp' | 'mp';
  delayMs?: number;
}

export interface CombatTextXpEvent {
  targetId: string;
  amount: number;
}

export interface CombatTextGoldEvent {
  targetId: string;
  amount: number;
  /** Posição no mundo (px) — quando presente, ignora o targetId (ex.: gold da criatura morta). */
  position?: { x: number; y: number };
}

interface WorldPosition {
  x: number;
  y: number;
}

export class CombatTextManager {
  private readonly active: FloatingCombatText[] = [];
  private nextId = 1;
  private readonly pool: CombatTextPool;

  constructor(private readonly scene: Phaser.Scene, private readonly positionOf: (entityId: string) => WorldPosition | null) {
    this.pool = new CombatTextPool(scene);
  }

  spawnDamage(event: CombatTextDamageEvent) {
    this.spawn(event.targetId, event.amount, 'damage', event.damageType ?? 'physical', event.critical, event.delayMs);
  }

  spawnHealing(event: CombatTextHealEvent) {
    this.spawn(event.targetId, event.amount, 'healing', undefined, event.critical, event.delayMs, undefined, event.resource);
  }

  spawnXp(event: CombatTextXpEvent) {
    this.spawn(event.targetId, event.amount, 'xp', undefined, false, 0);
  }

  spawnGold(event: CombatTextGoldEvent) {
    this.spawn(event.targetId, event.amount, 'gold', undefined, false, 0, event.position);
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
      item.text?.setPosition(item.worldX, item.worldY - item.riseDistance * eased)
        .setAlpha(fade)
        .setScale(scale);
    }
  }

  clear() {
    for (const item of this.active) this.pool.release(item);
    this.active.length = 0;
  }

  private spawn(entityId: string, value: number, type: 'damage' | 'healing' | 'xp' | 'gold', damageType: DamageType | undefined, critical: boolean, delayMs = 0, positionOverride?: WorldPosition, resource?: 'hp' | 'mp') {
    const position = positionOverride ?? this.positionOf(entityId);
    if (!position || value < 0) return;
    const create = () => {
      const item: FloatingCombatText = {
        id: this.nextId++, entityId, value, type, damageType, critical,
        worldX: position.x, worldY: position.y,
        createdAt: this.scene.time.now,
        duration: critical ? COMBAT_TEXT_ANIMATION.criticalDuration : COMBAT_TEXT_ANIMATION.normalDuration,
        riseDistance: critical ? COMBAT_TEXT_ANIMATION.criticalRise : COMBAT_TEXT_ANIMATION.normalRise,
        text: null,
      };
      const suffix = type === 'xp' ? ' XP' : type === 'gold' ? ' gold' : '';
      const text = this.pool.acquire();
      text.setText(`${type === 'damage' ? '-' : '+'}${new Intl.NumberFormat('pt-BR').format(value)}${suffix}`)
        .setFontSize(`${this.fontSize(type, critical)}px`)
         .setColor(this.color(type, damageType, resource))
        .setPosition(item.worldX, item.worldY)
        .setOrigin(0.5)
        .setDepth(120)
        .setVisible(true)
        .setActive(true);
      item.text = text;
      this.active.push(item);
    };
    if (delayMs > 0) this.scene.time.delayedCall(delayMs, create);
    else create();
  }

  private fontSize(type: 'damage' | 'healing' | 'xp' | 'gold', critical: boolean): number {
    if (type === 'damage') return critical ? WORLD_TEXT_THEME.sizes.criticalDamage : WORLD_TEXT_THEME.sizes.damage;
    if (type === 'healing') return WORLD_TEXT_THEME.sizes.healing;
    if (type === 'gold') return WORLD_TEXT_THEME.sizes.gold;
    return WORLD_TEXT_THEME.sizes.xp;
  }

  private color(type: 'damage' | 'healing' | 'xp' | 'gold', damageType: DamageType | undefined, resource?: 'hp' | 'mp'): string {
    if (type === 'xp') return COMBAT_TEXT_XP_COLOR;
    if (type === 'gold') return WORLD_TEXT_COLORS.gold;
    if (type === 'healing') return resource === 'mp' ? COMBAT_TEXT_MANA_COLOR : COMBAT_TEXT_THEME.healing;
    return COMBAT_TEXT_THEME[damageType ?? 'physical'];
  }
}

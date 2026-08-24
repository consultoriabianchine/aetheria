import type Phaser from 'phaser';
import type { FloatingCombatText } from './floating-combat-text';

export class CombatTextPool {
  private readonly available: Phaser.GameObjects.Text[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  acquire(): Phaser.GameObjects.Text {
    return this.available.pop() ?? this.scene.add.text(0, 0, '', {
      fontFamily: 'monospace',
      fontStyle: 'bold',
      stroke: '#101010',
      strokeThickness: 2,
      resolution: Math.max(1, Math.ceil(this.scene.cameras.main.zoom * (window.devicePixelRatio || 1))),
    });
  }

  release(item: FloatingCombatText) {
    const text = item.text;
    if (!text) return;
    text.setVisible(false).setActive(false).setScale(1).setAlpha(1);
    this.available.push(text);
    item.text = null;
  }
}

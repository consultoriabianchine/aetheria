import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ItemProjectileVisual, ItemVisualEffects, ShootTypeDefinition } from '@aetheria/types';
import { ApiService } from '../core/api.service';
import { SpriteVisualEditor } from '../shared/sprite-visual-editor/sprite-visual-editor';

interface Draft {
  id?: number;
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  visual: ItemVisualEffects;
}

@Component({
  selector: 'admin-shoot-type-editor',
  imports: [FormsModule, SpriteVisualEditor],
  templateUrl: './shoot-type-editor.html',
  styles: `
    .layout { display: grid; grid-template-columns: 330px minmax(480px, 1fr); gap: 16px; }
    .panel { background: #111926; border: 1px solid #263244; border-radius: 10px; padding: 14px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
    .list { display: flex; flex-direction: column; gap: 6px; max-height: 72vh; overflow: auto; }
    .row { display: flex; justify-content: space-between; gap: 8px; padding: 8px; border: 1px solid #263244; border-radius: 7px; background: #172130; color: #d9e6f2; text-align: left; }
    .row.active { border-color: #7fd0a0; }
    .row small, label { color: #8fa2b5; font-size: 12px; }
    .form { display: grid; grid-template-columns: repeat(2, minmax(160px, 1fr)); gap: 12px; }
    label { display: flex; flex-direction: column; gap: 4px; }
    input, textarea, select { background: #0d141d; color: #e6eef6; border: 1px solid #2b3546; border-radius: 6px; padding: 8px; }
    textarea { min-height: 60px; resize: vertical; }
    .wide { grid-column: 1 / -1; }
    .actions { margin-top: 14px; display: flex; gap: 8px; }
    button { border: 1px solid #34445c; background: #1b2636; color: #d9e6f2; border-radius: 6px; padding: 8px 12px; }
    button.primary { background: #1f6feb; color: #fff; }
    .error { color: #ff8a8a; }
  `,
})
export class ShootTypeEditor implements OnInit {
  readonly items = signal<ShootTypeDefinition[]>([]);
  readonly selectedId = signal<number | null>(null);
  readonly draft = signal<Draft>(blank());
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  readonly selected = computed(() => this.items().find((item) => item.id === this.selectedId()) ?? null);

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.error.set(null);
    try {
      this.items.set(await this.api.listShootTypes());
      if (!this.selectedId() && this.items()[0]) this.select(this.items()[0]);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  select(item: ShootTypeDefinition) {
    this.selectedId.set(item.id);
    this.draft.set({
      id: item.id,
      slug: item.slug,
      name: item.name,
      description: item.description ?? '',
      enabled: item.enabled,
      visual: { projectile: structuredClone(item.projectile) },
    });
  }

  createNew() {
    this.selectedId.set(null);
    this.draft.set(blank());
  }

  patch(patch: Partial<Draft>) {
    this.draft.update((draft) => ({ ...draft, ...patch }));
  }

  patchVisual(visual: ItemVisualEffects | null) {
    this.patch({ visual: visual ?? { projectile: blankProjectile() } });
  }

  async save() {
    const draft = this.draft();
    this.saving.set(true);
    this.error.set(null);
    try {
      const p = draft.visual.projectile ?? blankProjectile();
      await this.api.saveShootType({
        id: draft.id,
        slug: draft.slug,
        name: draft.name,
        description: draft.description,
        sprite: p.sprite,
        spriteAssetId: p.spriteAssetId ?? null,
        frameWidth: p.frameWidth,
        frameHeight: p.frameHeight,
        frames: p.frames,
        speedPxPerSecond: p.speedPxPerSecond ?? 520,
        enabled: draft.enabled,
      });
      await this.load();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }
}

function blankProjectile(): ItemProjectileVisual {
  return {
    sprite: '',
    frameWidth: 32,
    frameHeight: 32,
    speedPxPerSecond: 520,
    frames: { north: 0, northEast: 1, east: 2, southEast: 3, south: 4, southWest: 5, west: 6, northWest: 7 },
  };
}

function blank(): Draft {
  return { slug: '', name: 'Novo Tipo de Tiro', description: '', enabled: true, visual: { projectile: blankProjectile() } };
}

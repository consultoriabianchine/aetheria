import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { AppearanceColors, OutfitCategory, OutfitBodyType, OutfitDefinition } from '@aetheria/types';
import { APPEARANCE_PALETTE } from '@aetheria/config';
import { ApiService } from '../core/api.service';

const CATEGORIES: OutfitCategory[] = ['default', 'quest', 'achievement', 'event', 'premium', 'exclusive', 'admin'];
const BODY_TYPES: OutfitBodyType[] = ['unisex', 'body_a', 'body_b'];
const SLOTS: (keyof AppearanceColors)[] = ['head', 'primary', 'secondary', 'detail'];

@Component({
  selector: 'admin-outfit-editor',
  imports: [RouterLink],
  templateUrl: './outfit-editor.html',
  styleUrls: ['./outfit-editor.scss'],
})
export class OutfitEditor implements OnInit {
  readonly draft = signal<OutfitDefinition | null>(null);
  readonly animationSets = signal<{ id: number; name: string }[]>([]);
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly categories = CATEGORIES;
  readonly bodyTypes = BODY_TYPES;
  readonly slots = SLOTS;
  readonly palette = APPEARANCE_PALETTE;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  get id(): string {
    return this.route.snapshot.paramMap.get('id') ?? 'new';
  }

  async ngOnInit() {
    try {
      const sets = await this.api.listAnimationSets();
      this.animationSets.set(sets);

      if (this.id !== 'new') {
        const o = await this.api.getOutfit(Number(this.id));
        this.draft.set(structuredClone(o));
      } else {
        this.draft.set({
          outfitId: 0,
          slug: '',
          name: 'Novo Outfit',
          description: '',
          spriteAssetId: 0,
          animationSetId: sets[0]?.id ?? 0,
          category: 'default',
          bodyType: 'unisex',
          supportsColors: true,
          supportsAddons: false,
          defaultColors: { head: 0, primary: 0, secondary: 0, detail: 0 },
          availableByDefault: false,
          premiumOnly: false,
          enabled: true,
          published: true,
          version: 1,
        });
        this.dirty.set(true);
      }
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  patch(p: Partial<OutfitDefinition>) {
    this.draft.update((d) => (d ? { ...d, ...p } : d));
    this.dirty.set(true);
  }

  setColor(slot: keyof AppearanceColors, index: number) {
    this.draft.update((d) => (d ? { ...d, defaultColors: { ...d.defaultColors, [slot]: index } } : d));
    this.dirty.set(true);
  }

  async onBaseFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const res = await this.api.uploadSpriteAsset(file);
      this.patch({ spriteAssetId: res.spriteAssetId });
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  async onMaskFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const res = await this.api.uploadSpriteAsset(file);
      this.patch({ colorMaskAssetId: res.spriteAssetId });
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  async save() {
    const d = this.draft();
    if (!d) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const res = await this.api.saveOutfit({
        ...d,
        outfitId: this.id === 'new' ? undefined : d.outfitId,
      });
      this.dirty.set(false);
      if (this.id === 'new') void this.router.navigate(['/outfits', res.outfitId]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }
}

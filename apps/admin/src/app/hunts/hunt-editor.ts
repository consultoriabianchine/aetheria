import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { HuntDefinition, HuntMonsterEntry } from '@aetheria/types';
import { ApiService, type AdminCreatureSummary, type MapSummary } from '../core/api.service';

const ARENA_IDS = ['arena_small', 'arena_basic', 'arena_wide'];

@Component({
  selector: 'admin-hunt-editor',
  imports: [RouterLink],
  templateUrl: './hunt-editor.html',
  styleUrls: ['./hunt-editor.scss'],
})
export class HuntEditor implements OnInit {
  readonly draft = signal<HuntDefinition | null>(null);
  readonly creatures = signal<AdminCreatureSummary[]>([]);
  readonly maps = signal<MapSummary[]>([]);
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly arenas = ARENA_IDS;

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
      const [creatures, maps] = await Promise.all([this.api.listCreatures(), this.api.listMaps()]);
      this.creatures.set(creatures);
      this.maps.set(maps);

      if (this.id !== 'new') {
        const h = await this.api.getHunt(this.id);
        this.draft.set(structuredClone(h));
      } else {
        this.draft.set({
          id: '',
          name: 'Nova Hunt',
          ladderPosition: 0,
          suggestedLevel: 1,
          basePackSize: 4,
          maxPackSize: 9,
          monsters: [{ monsterId: creatures[0]?.slug ?? '', weight: 1 }],
          boss: { monsterId: creatures[0]?.slug ?? '', name: 'Chefe', statMultipliers: { hp: 3, damage: 1.5, xp: 2.5 } },
          arenaId: 'arena_basic',
          enabled: true,
        });
        this.dirty.set(true);
      }
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  patch(p: Partial<HuntDefinition>) {
    this.draft.update((d) => (d ? { ...d, ...p } : d));
    this.dirty.set(true);
  }

  addMonster() {
    this.draft.update((d) => {
      if (!d) return d;
      const first = this.creatures()[0]?.slug ?? '';
      return { ...d, monsters: [...d.monsters, { monsterId: first, weight: 1 }] };
    });
    this.dirty.set(true);
  }

  removeMonster(i: number) {
    this.draft.update((d) => (d ? { ...d, monsters: d.monsters.filter((_, idx) => idx !== i) } : d));
    this.dirty.set(true);
  }

  setMonster(i: number, patch: Partial<HuntMonsterEntry>) {
    this.draft.update((d) =>
      d ? { ...d, monsters: d.monsters.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) } : d,
    );
    this.dirty.set(true);
  }

  setBoss(patch: Record<string, unknown>) {
    this.draft.update((d) => (d ? { ...d, boss: { ...d.boss, ...patch } } : d));
    this.dirty.set(true);
  }

  async save() {
    const h = this.draft();
    if (!h) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const res = await this.api.saveHunt({ ...h, id: this.id === 'new' ? undefined : this.id });
      this.dirty.set(false);
      if (this.id === 'new') void this.router.navigate(['/hunts', res.id]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }
}

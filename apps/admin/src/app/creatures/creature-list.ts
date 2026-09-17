import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, type AdminCreatureSummary } from '../core/api.service';

@Component({
  selector: 'admin-creature-list',
  imports: [RouterLink],
  templateUrl: './creature-list.html',
  styleUrls: ['./creature-list.scss'],
})
export class CreatureList implements OnInit {
  readonly creatures = signal<AdminCreatureSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor(private readonly api: ApiService, private readonly router: Router) {}

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.creatures.set(await this.api.listCreatures());
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  async includeCreature() {
    const name = window.prompt('Nome da criatura:')?.trim();
    if (!name) return;
    const suggestedSlug = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const slug = window.prompt('Slug da criatura:', suggestedSlug)?.trim();
    if (!slug) return;
    try {
      const result = await this.api.createCreature({ name, slug, type: 'humanoid' });
      await this.router.navigate(['/creatures', result.creatureId, 'animation']);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}

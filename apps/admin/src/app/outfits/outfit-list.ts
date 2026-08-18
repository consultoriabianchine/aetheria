import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { OutfitDefinition } from '@aetheria/types';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'admin-outfit-list',
  imports: [RouterLink],
  templateUrl: './outfit-list.html',
  styleUrls: ['./outfit-list.scss'],
})
export class OutfitList implements OnInit {
  readonly outfits = signal<OutfitDefinition[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  private readonly router = inject(Router);

  constructor(private readonly api: ApiService) {}

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.outfits.set(await this.api.listOutfits());
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  create() {
    void this.router.navigate(['/outfits', 'new']);
  }

  async remove(outfitId: number) {
    if (!confirm('Excluir este outfit?')) return;
    try {
      await this.api.deleteOutfit(outfitId);
      await this.load();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}

import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, type MapSummary } from '../core/api.service';

@Component({
  selector: 'admin-map-list',
  imports: [RouterLink],
  templateUrl: './map-list.html',
  styleUrls: ['./map-list.scss'],
})
export class MapList implements OnInit {
  readonly maps = signal<MapSummary[]>([]);
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
      this.maps.set(await this.api.listMaps());
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  create() {
    void this.router.navigate(['/maps', 'new']);
  }

  async remove(id: string) {
    if (!confirm('Excluir este mapa?')) return;
    try {
      await this.api.deleteMap(id);
      await this.load();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}

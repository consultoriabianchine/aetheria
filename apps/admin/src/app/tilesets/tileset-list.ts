import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, type AdminTileset } from '../core/api.service';

@Component({
  selector: 'admin-tileset-list',
  imports: [RouterLink],
  templateUrl: './tileset-list.html',
  styleUrls: ['./tileset-list.scss'],
})
export class TilesetList implements OnInit {
  readonly tilesets = signal<AdminTileset[]>([]);
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
      this.tilesets.set(await this.api.listTilesets());
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  create() {
    void this.router.navigate(['/tilesets', 'new']);
  }

  async remove(id: number, name: string) {
    if (!confirm(`Excluir o tileset "${name}"?`)) return;
    try {
      await this.api.deleteTileset(id);
      await this.load();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}

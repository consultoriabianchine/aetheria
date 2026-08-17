import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { HuntDefinition } from '@aetheria/types';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'admin-hunt-list',
  imports: [RouterLink],
  templateUrl: './hunt-list.html',
  styleUrls: ['./hunt-list.scss'],
})
export class HuntList implements OnInit {
  readonly hunts = signal<HuntDefinition[]>([]);
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
      this.hunts.set(await this.api.listHunts());
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  create() {
    void this.router.navigate(['/hunts', 'new']);
  }

  async remove(id: string) {
    if (!confirm('Excluir esta hunt?')) return;
    try {
      await this.api.deleteHunt(id);
      await this.load();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}

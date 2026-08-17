import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
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

  constructor(private readonly api: ApiService) {}

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
}

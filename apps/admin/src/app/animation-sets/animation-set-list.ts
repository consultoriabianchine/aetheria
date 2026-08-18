import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'admin-animation-set-list',
  imports: [RouterLink],
  templateUrl: './animation-set-list.html',
  styleUrls: ['./animation-set-list.scss'],
})
export class AnimationSetList implements OnInit {
  readonly sets = signal<{ id: number; name: string }[]>([]);
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
      this.sets.set(await this.api.listAnimationSets());
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  create() {
    void this.router.navigate(['/animation-sets', 'new']);
  }
}

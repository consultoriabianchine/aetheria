import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService, type AdminNews, type AdminNewsStatus } from '../core/api.service';

@Component({
  selector: 'admin-news-list',
  imports: [RouterLink],
  templateUrl: './news-list.html',
  styleUrl: './news-list.scss',
})
export class NewsList implements OnInit {
  readonly news = signal<AdminNews[]>([]);
  readonly status = signal<'all' | AdminNewsStatus>('all');
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  constructor(private readonly api: ApiService, private readonly router: Router) {}

  ngOnInit() { void this.load(); }

  async load() {
    this.loading.set(true);
    this.error.set(null);
    try {
      const selected = this.status();
      this.news.set(await this.api.listNews(selected === 'all' ? undefined : selected));
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  setStatus(value: string) {
    this.status.set(value as 'all' | AdminNewsStatus);
    void this.load();
  }

  create() { void this.router.navigate(['/news', 'new']); }

  async remove(item: AdminNews) {
    if (!confirm(`Excluir a notícia "${item.title}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await this.api.deleteNews(item.id);
      await this.load();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  statusLabel(value: AdminNewsStatus): string {
    return { draft: 'Rascunho', published: 'Publicada', archived: 'Arquivada' }[value];
  }

  formatDate(value?: string | null): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  }
}

import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, type AdminNews, type AdminNewsInput } from '../core/api.service';

const EMPTY_NEWS: AdminNewsInput = {
  title: '', slug: '', excerpt: '', content: '', coverImage: '', author: '', status: 'draft',
};

@Component({
  selector: 'admin-news-editor',
  imports: [RouterLink],
  templateUrl: './news-editor.html',
  styleUrl: './news-editor.scss',
})
export class NewsEditor implements OnInit {
  readonly draft = signal<AdminNewsInput | null>(null);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly notice = signal<string | null>(null);

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  get id(): string { return this.route.snapshot.paramMap.get('id') ?? 'new'; }
  get isNew(): boolean { return this.id === 'new'; }

  async ngOnInit() {
    try {
      this.draft.set(this.isNew ? { ...EMPTY_NEWS } : await this.api.getNews(this.id));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  patch(patch: Partial<AdminNewsInput>) {
    this.draft.update((draft) => draft ? { ...draft, ...patch } : draft);
    this.notice.set(null);
  }

  async saveDraft() {
    const draft = this.draft();
    if (!draft || !draft.title.trim() || !draft.content.trim()) {
      this.error.set('Título e conteúdo são obrigatórios.');
      return;
    }
    await this.save({ ...draft, status: 'draft' });
  }

  async publish() {
    const draft = this.draft();
    if (!draft || !draft.title.trim() || !draft.content.trim()) {
      this.error.set('Título e conteúdo são obrigatórios para publicar.');
      return;
    }
    if (this.isNew) await this.save({ ...draft, status: 'draft' }, true);
    else await this.runAction(() => this.api.publishNews(this.id), 'Notícia publicada.');
  }

  async archive() {
    if (this.isNew) return;
    await this.runAction(() => this.api.archiveNews(this.id), 'Notícia arquivada.');
  }

  async remove() {
    if (this.isNew || !confirm('Excluir esta notícia? Esta ação não pode ser desfeita.')) return;
    try {
      await this.api.deleteNews(this.id);
      void this.router.navigate(['/news']);
    } catch (e) { this.error.set((e as Error).message); }
  }

  private async save(input: AdminNewsInput, publishAfterSave = false) {
    this.saving.set(true); this.error.set(null); this.notice.set(null);
    try {
      const result = this.isNew ? await this.api.createNews(input) : await this.api.updateNews(this.id, input);
      if (this.isNew) {
        if (publishAfterSave) {
          const published = await this.api.publishNews(result.news.id);
          this.draft.set(published.news);
          this.notice.set('Notícia publicada.');
        } else {
          void this.router.navigate(['/news', result.news.id]);
        }
      } else {
        this.draft.set(result.news); this.notice.set('Rascunho salvo.');
      }
    } catch (e) { this.error.set((e as Error).message); }
    finally { this.saving.set(false); }
  }

  private async runAction(action: () => Promise<{ news: AdminNews }>, message: string) {
    this.saving.set(true); this.error.set(null); this.notice.set(null);
    try { const result = await action(); this.draft.set(result.news); this.notice.set(message); }
    catch (e) { this.error.set((e as Error).message); }
    finally { this.saving.set(false); }
  }
}

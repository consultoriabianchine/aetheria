import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { first } from 'rxjs';
import { GameState } from '../game/game-state';
import { PublicCharacter, PublicNews, PublicSiteService, PublicStats } from '../core/public-site.service';

type AuthMode = 'login' | 'register';

@Component({
  selector: 'app-home',
  imports: [FormsModule, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  readonly stats = signal<PublicStats | null>(null);
  readonly news = signal<PublicNews[]>([]);
  readonly leaders = signal<PublicCharacter[]>([]);
  readonly searchResults = signal<PublicCharacter[]>([]);
  readonly search = signal('');
  readonly loading = signal(true);
  readonly searchLoading = signal(false);
  readonly searchError = signal('');
  readonly authMode = signal<AuthMode | null>(null);
  readonly username = signal('');
  readonly password = signal('');
  readonly confirmation = signal('');
  readonly authError = signal('');
  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly state = inject(GameState);
  private readonly site = inject(PublicSiteService);
  private readonly router = inject(Router);

  constructor() {
    void this.loadPublicData();
  }

  async loadPublicData() {
    this.loading.set(true);
    const [stats, news, leaders] = await Promise.allSettled([this.site.getStats(), this.site.getNews(), this.site.getLeaderboard()]);
    if (stats.status === 'fulfilled') this.stats.set(stats.value);
    if (news.status === 'fulfilled') this.news.set(news.value);
    if (leaders.status === 'fulfilled') this.leaders.set(leaders.value);
    this.loading.set(false);
  }

  openAuth(mode: AuthMode) {
    this.authMode.set(mode);
    this.authError.set('');
    this.state.loginError.set('');
    this.state.registerError.set('');
  }

  closeAuth() { if (!this.submitting()) this.authMode.set(null); }

  switchAuth() { this.openAuth(this.authMode() === 'login' ? 'register' : 'login'); }

  submitAuth() {
    this.authError.set('');
    if (!this.username().trim() || !this.password()) { this.authError.set('Informe usuário e senha.'); return; }
    if (this.authMode() === 'register' && this.password().length < 8) { this.authError.set('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (this.authMode() === 'register' && this.password() !== this.confirmation()) { this.authError.set('As senhas não conferem.'); return; }
    const mode = this.authMode();
    if (!mode) return;
    this.submitting.set(true);
    const result$ = mode === 'login' ? this.state.loginResult$ : this.state.registerResult$;
    if (mode === 'login') this.state.login(this.username().trim(), this.password());
    else this.state.register(this.username().trim(), this.password());
    result$.pipe(first()).subscribe((ok) => {
      this.submitting.set(false);
      const error = mode === 'login' ? this.state.loginError() : this.state.registerError();
      if (ok) { this.authMode.set(null); void this.router.navigate(['/characters']); }
      else this.authError.set(error || 'Não foi possível concluir a operação.');
    });
  }

  async searchCharacters() {
    const query = this.search().trim();
    this.searchError.set('');
    if (query.length < 2) { this.searchResults.set([]); if (query) this.searchError.set('Digite pelo menos 2 caracteres.'); return; }
    this.searchLoading.set(true);
    try { this.searchResults.set(await this.site.searchCharacters(query)); }
    catch { this.searchError.set('A busca está indisponível no momento.'); }
    finally { this.searchLoading.set(false); }
  }

  formatDate(value?: string | null): string {
    return value ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(value)) : '';
  }

  go(path: string) { void this.router.navigate([path]); }
}

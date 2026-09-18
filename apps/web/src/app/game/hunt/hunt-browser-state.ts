import { Injectable, signal } from '@angular/core';

export type HuntCategory = 'all' | 'xp' | 'loot' | 'done' | 'pending' | 'favorites';

export interface LevelWarningState {
  huntId: string;
  huntName: string;
  recommendedLevel: number;
  playerLevel: number;
}

/**
 * Estado da Central de Hunts (busca, filtros, seleção e detalhes). Mantém o
 * estado ao abrir/fechar detalhes para que o jogador volte exatamente de onde
 * parou.
 */
@Injectable({ providedIn: 'root' })
export class HuntBrowserState {
  readonly open = signal(false);
  readonly detailsOpen = signal(false);
  readonly search = signal('');
  readonly levelRange = signal('all');
  readonly category = signal<HuntCategory>('all');
  readonly selectedHuntId = signal<string | null>(null);
  readonly loop = signal(true);
  readonly levelWarning = signal<LevelWarningState | null>(null);

  openBrowser() {
    this.open.set(true);
  }

  closeBrowser() {
    this.open.set(false);
    this.detailsOpen.set(false);
    this.selectedHuntId.set(null);
    this.levelWarning.set(null);
  }

  /** ESC: fecha detalhes primeiro; sem detalhes, fecha a central. */
  handleEscape(): boolean {
    if (this.levelWarning()) {
      this.levelWarning.set(null);
      return true;
    }
    if (this.detailsOpen()) {
      this.detailsOpen.set(false);
      this.selectedHuntId.set(null);
      return true;
    }
    this.closeBrowser();
    return true;
  }

  select(huntId: string) {
    this.selectedHuntId.set(huntId);
    this.detailsOpen.set(true);
  }

  closeDetails() {
    this.detailsOpen.set(false);
    this.selectedHuntId.set(null);
  }
}

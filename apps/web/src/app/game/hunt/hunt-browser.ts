import { Component, HostListener, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HUNT_CONFIG, LEVEL_RANGE_FILTERS, calculatePackSize } from '@aetheria/config';
import type { HuntListEntry } from '@aetheria/types';
import { GameState } from '../game-state';
import { CreatureThumb } from './creature-thumb';
import { HuntBrowserState, type HuntCategory } from './hunt-browser-state';

interface LevelRange {
  id: string;
  label: string;
  min: number;
  max: number | null;
}

interface LevelRangeView extends LevelRange {
  count: number;
}

@Component({
  selector: 'hunt-browser',
  imports: [FormsModule, CreatureThumb],
  templateUrl: './hunt-browser.html',
  styleUrl: './hunt-browser.scss',
})
export class HuntBrowser {
  readonly state = inject(GameState);
  readonly browser = inject(HuntBrowserState);
  readonly ranges = LEVEL_RANGE_FILTERS;
  readonly bossWave = HUNT_CONFIG.bossWave;
  readonly categories: { id: HuntCategory; label: string }[] = [
    { id: 'all', label: 'Todas' },
    { id: 'xp', label: 'XP' },
    { id: 'loot', label: 'Loot' },
    { id: 'done', label: 'Concluídas' },
    { id: 'pending', label: 'Pendentes' },
  ];

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.browser.open()) this.browser.handleEscape();
  }

  selectedHunt(): HuntListEntry | null {
    const id = this.browser.selectedHuntId();
    return this.state.hunts().find((h) => h.id === id) ?? null;
  }

  /** Catálogo ordenado por ladder (default), sem filtro. */
  private ladder(): HuntListEntry[] {
    return [...this.state.hunts()].sort((a, b) => a.ladderPosition - b.ladderPosition);
  }

  private matchesSearch(h: HuntListEntry, query: string): boolean {
    if (!query) return true;
    const q = query.toLowerCase();
    if (h.name.toLowerCase().includes(q)) return true;
    if (h.boss.name.toLowerCase().includes(q)) return true;
    if (h.monsters.some((m) => m.name.toLowerCase().includes(q))) return true;
    if (h.tags.some((t) => t.toLowerCase().includes(q))) return true;
    return false;
  }

  private inRange(h: HuntListEntry, range: LevelRange): boolean {
    if (range.max === null) return h.suggestedLevel >= range.min;
    return h.suggestedLevel >= range.min && h.suggestedLevel <= range.max;
  }

  private matchesCategory(h: HuntListEntry): boolean {
    switch (this.browser.category()) {
      case 'xp':
        return h.xpRating != null;
      case 'loot':
        return h.lootRating != null;
      case 'done':
        return h.completionCount > 0;
      case 'pending':
        return h.completionCount === 0;
      case 'favorites':
        return h.favorite;
      default:
        return true;
    }
  }

  /** Aplica busca + categoria (sem o filtro de level) — base dos contadores. */
  private baseFiltered(): HuntListEntry[] {
    const query = this.browser.search();
    return this.ladder().filter((h) => this.matchesSearch(h, query) && this.matchesCategory(h));
  }

  visibleHunts(): HuntListEntry[] {
    const rangeId = this.browser.levelRange();
    const range = this.rangeFor(rangeId);
    let list = this.baseFiltered();
    if (range && rangeId !== 'all') list = list.filter((h) => this.inRange(h, range));
    const category = this.browser.category();
    if (category === 'xp') return list.sort((a, b) => (b.xpRating ?? -1) - (a.xpRating ?? -1));
    if (category === 'loot') return list.sort((a, b) => (b.lootRating ?? -1) - (a.lootRating ?? -1));
    return list;
  }

  rangeFor(id: string): LevelRange | null {
    return this.ranges.find((r) => r.id === id) ?? null;
  }

  levelRanges(): LevelRangeView[] {
    const base = this.baseFiltered();
    return this.ranges.map((r) => ({
      ...r,
      count: base.filter((h) => this.inRange(h, r)).length,
    }));
  }

  isActiveCategory(id: string): boolean {
    return this.browser.category() === id;
  }

  setCategory(id: HuntCategory) {
    this.browser.category.set(id);
  }

  setLevelRange(id: string) {
    this.browser.levelRange.set(id);
  }

  onSearch(value: string) {
    this.browser.search.set(value);
  }

  select(h: HuntListEntry) {
    this.browser.select(h.id);
  }

  isSelected(h: HuntListEntry): boolean {
    return this.browser.selectedHuntId() === h.id;
  }

  toggleFavorite(h: HuntListEntry) {
    this.state.setFavorite(h.id, !h.favorite);
  }

  stars(rating: number | null): boolean[] {
    const n = Math.max(0, Math.min(5, rating ?? 0));
    return Array.from({ length: 5 }, (_, i) => i < n);
  }

  fmtTime(ms: number | null): string {
    return ms == null ? '—' : GameState.formatTime(ms);
  }

  fmtDate(ms: number | null): string {
    if (ms == null) return '—';
    return new Date(ms).toLocaleDateString('pt-BR');
  }

  waveCells(): number[] {
    return Array.from({ length: HUNT_CONFIG.waveCount }, (_, i) => i + 1);
  }

  wavePackLabel(h: HuntListEntry, wave: number): string {
    if (wave === HUNT_CONFIG.bossWave) return 'Boss';
    return `${calculatePackSize(h.basePackSize, h.maxPackSize, wave)} monstros`;
  }

  playerLevel(): number {
    return this.state.stats().level;
  }

  partyLevel(): number {
    const levels = this.state.party().members.map((m) => m.level);
    return levels.length > 0 ? Math.max(...levels, this.playerLevel()) : this.playerLevel();
  }

  /** Aviso de nível: só avisa se a recomendação for bem acima da party. */
  needsLevelWarning(h: HuntListEntry): boolean {
    return h.suggestedLevel > this.partyLevel() + 10;
  }

  requestStart(h: HuntListEntry) {
    if (this.needsLevelWarning(h)) {
      this.browser.levelWarning.set({
        huntId: h.id,
        huntName: h.name,
        recommendedLevel: h.suggestedLevel,
        playerLevel: this.partyLevel(),
      });
      return;
    }
    this.start(h);
  }

  start(h: HuntListEntry) {
    this.state.startHunt(h.id, this.browser.loop());
    this.browser.closeBrowser();
  }

  confirmWarningStart() {
    const w = this.browser.levelWarning();
    if (!w) return;
    const h = this.state.hunts().find((x) => x.id === w.huntId);
    this.browser.levelWarning.set(null);
    if (h) this.start(h);
  }

  cancelWarning() {
    this.browser.levelWarning.set(null);
  }

  partyMembers() {
    return this.state.party().members;
  }
}

import { Injectable, computed, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { SERVER_EVENTS } from '@aetheria/protocol';
import type { CharacterInventory, CharacterSkills, CharacterSummary, CombatArchetype, HuntListEntry, HuntRunView, MapTile } from '@aetheria/types';
import { WsService, WsEvent } from '../core/ws.service';

export interface HudStats {
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  level: number;
  experience: number;
  skills?: CharacterSkills;
  skillProgress?: { skillType: keyof CharacterSkills; level: number; experience: number }[];
}

export interface ChatLine {
  channel: string;
  from: string;
  text: string;
}

export interface TargetInfo {
  id: string;
  name: string;
  health: number;
  maxHealth: number;
}

export interface WorldSnapshot {
  map: MapTile[];
  width: number;
  height: number;
}

export interface DialogInfo {
  title: string;
  lines: string[];
}

export interface AvailableOutfit {
  outfitId: number;
  name: string;
  slug: string;
  category: string;
  supportsColors: boolean;
  supportsAddons: boolean;
}

export interface AppearanceDraft {
  outfitId: number;
  addonMask: number;
  colors: { head: number; primary: number; secondary: number; detail: number };
}

@Injectable({ providedIn: 'root' })
export class GameState {
  readonly connected = signal(false);
  readonly token = signal<string | null>(localStorage.getItem('aetheria_token'));
  readonly accountId = signal<string | null>(localStorage.getItem('aetheria_account'));
  readonly characters = signal<CharacterSummary[]>([]);
  readonly loginError = signal('');
  readonly createError = signal('');

  readonly inGame = signal(false);
  readonly self = signal<CharacterSummary | null>(null);
  readonly stats = signal<HudStats>({
    health: 0,
    maxHealth: 0,
    mana: 0,
    maxMana: 0,
    level: 1,
    experience: 0,
  });
  readonly inventory = signal<CharacterInventory>({ slots: [], equipment: {} });
  readonly chat = signal<ChatLine[]>([]);
  readonly dialog = signal<DialogInfo | null>(null);
  readonly target = signal<TargetInfo | null>(null);
  readonly world = signal<WorldSnapshot | null>(null);
  readonly gold = signal(0);
  readonly hunts = signal<HuntListEntry[]>([]);
  readonly hunt = signal<HuntRunView | null>(null);
  readonly huntsOpen = signal(false);
  readonly inArena = computed(() => this.hunt() !== null);

  readonly appearanceOpen = signal(false);
  readonly availableOutfits = signal<AvailableOutfit[]>([]);
  readonly appearanceDraft = signal<AppearanceDraft | null>(null);

  /** Renderização HD com anti-aliasing (default) vs pixel art nítido. */
  readonly hdSmooth = signal(localStorage.getItem('aetheria_hd_smooth') !== '0');
  readonly hdSmooth$ = new Subject<boolean>();

  /** Zoom do canvas do jogo (afeta apenas a cena Phaser, não a UI DOM). */
  readonly zoom = signal(parseFloat(localStorage.getItem('aetheria_zoom') ?? '1'));
  readonly zoom$ = new Subject<number>();

  private static readonly ZOOM_MIN_HD = 0.5;
  private static readonly ZOOM_MAX_HD = 2;
  private static readonly ZOOM_MIN_PIXEL = 1;
  private static readonly ZOOM_MAX_PIXEL = 4;

  zoomIn() {
    this.setZoom(this.zoom() + (this.hdSmooth() ? 0.25 : 1));
  }

  zoomOut() {
    this.setZoom(this.zoom() - (this.hdSmooth() ? 0.25 : 1));
  }

  setZoom(z: number) {
    const integer = !this.hdSmooth();
    const v = integer ? Math.round(z) : Math.round(z * 100) / 100;
    const next = integer
      ? Math.max(GameState.ZOOM_MIN_PIXEL, Math.min(GameState.ZOOM_MAX_PIXEL, v))
      : Math.max(GameState.ZOOM_MIN_HD, Math.min(GameState.ZOOM_MAX_HD, v));
    this.zoom.set(next);
    localStorage.setItem('aetheria_zoom', String(next));
    this.zoom$.next(next);
  }

  /** Buffer de eventos para a cena Phaser que cria depois da conexão. */
  readonly sceneEvents$ = new Subject<WsEvent>();
  private buffer: WsEvent[] = [];

  readonly loginResult$ = new Subject<boolean>();
  readonly characterCreated$ = new Subject<boolean>();
  readonly selectResult$ = new Subject<boolean>();

  constructor(private readonly ws: WsService) {
    this.setZoom(this.zoom());
    this.ws.events$.subscribe((e) => {
      if (this.buffer.length > 1000) this.buffer.shift();
      this.buffer.push(e);
      this.sceneEvents$.next(e);
      this.route(e);
    });
  }

  private route(e: WsEvent) {
    const data = e.data as Record<string, unknown>;
    switch (e.event) {
      case 'system.connected':
        this.connected.set(true);
        break;
      case 'system.disconnected':
        this.connected.set(false);
        break;
      case SERVER_EVENTS.LOGIN_RESULT: {
        const r = data as { ok: boolean; error?: string; token?: string; accountId?: string; characters?: CharacterSummary[] };
        this.loginError.set(r.error ?? '');
        this.loginResult$.next(!!r.ok);
        if (r.ok && r.token) {
          this.token.set(r.token);
          this.accountId.set(r.accountId ?? null);
          localStorage.setItem('aetheria_token', r.token);
          if (r.accountId) localStorage.setItem('aetheria_account', r.accountId);
          this.characters.set(r.characters ?? []);
        }
        break;
      }
      case SERVER_EVENTS.CHARACTER_CREATED: {
        const r = data as { ok: boolean; error?: string; character?: CharacterSummary };
        this.createError.set(r.error ?? '');
        this.characterCreated$.next(!!r.ok);
        if (r.ok && r.character) {
          this.characters.update((list) => [...list, r.character!]);
        }
        break;
      }
      case SERVER_EVENTS.SELECT_RESULT: {
        const r = data as { ok: boolean };
        this.inGame.set(r.ok);
        this.selectResult$.next(r.ok);
        break;
      }
      case SERVER_EVENTS.ENTER_WORLD: {
        const w = data as { character: CharacterSummary; map: MapTile[]; width: number; height: number };
        this.self.set(w.character);
        this.world.set({ map: w.map, width: w.width, height: w.height });
        this.inGame.set(true);
        this.hunt.set(null);
        this.gold.set(w.character.gold);
        this.requestHunts();
        break;
      }
      case SERVER_EVENTS.ENTER_ARENA: {
        const w = data as { character: CharacterSummary; map: MapTile[]; width: number; height: number; hunt: HuntRunView };
        this.self.set(w.character);
        this.world.set({ map: w.map, width: w.width, height: w.height });
        this.hunt.set(w.hunt);
        this.gold.set(w.character.gold);
        break;
      }
      case SERVER_EVENTS.HUNT_LIST: {
        const r = data as { hunts: HuntListEntry[] };
        this.hunts.set(r.hunts);
        break;
      }
      case SERVER_EVENTS.HUNT_STARTED: {
        const r = data as { hunt: HuntRunView };
        this.hunt.set(r.hunt);
        break;
      }
      case SERVER_EVENTS.HUNT_WAVE: {
        const r = data as { huntId: string; wave: number; monsterCount: number; isBoss: boolean };
        this.hunt.update((h) => (h ? { ...h, wave: r.wave, isBoss: r.isBoss, monsterCount: r.monsterCount } : h));
        break;
      }
      case SERVER_EVENTS.HUNT_LOOP_CHANGED: {
        const r = data as { huntId: string; loopEnabled: boolean };
        this.hunt.update((h) => (h && h.huntId === r.huntId ? { ...h, loopEnabled: r.loopEnabled } : h));
        break;
      }
      case SERVER_EVENTS.HUNT_COMPLETED: {
        const r = data as {
          huntId: string;
          completionCount: number;
          clearTimeMs: number;
          bestClearTimeMs: number | null;
          loopEnabled: boolean;
        };
        this.hunts.update((list) =>
          list.map((h) =>
            h.id === r.huntId
              ? { ...h, completionCount: r.completionCount, bestClearTimeMs: r.bestClearTimeMs }
              : h,
          ),
        );
        this.addSystemMessage(`Hunt concluída em ${GameState.formatTime(r.clearTimeMs)}!`);
        break;
      }
      case SERVER_EVENTS.HUNT_CLEARED: {
        const r = data as { huntId: string; wave: number };
        if (r.wave < 10) {
          this.addSystemMessage(`Onda ${r.wave} concluída! Preparando a próxima...`);
        }
        break;
      }
      case SERVER_EVENTS.HUNT_WIPED: {
        const r = data as { huntId: string; penaltyPaid: number; loopEnabled: boolean; respawnInMs: number | null };
        this.hunt.update((h) => (h ? { ...h, status: 'wiped' } : h));
        if (r.penaltyPaid > 0) {
          this.addSystemMessage(`Você foi derrotado! Penalidade: ${r.penaltyPaid} gold.`);
        }
        if (r.loopEnabled && r.respawnInMs != null) {
          this.addSystemMessage(`Reiniciando em ${Math.round(r.respawnInMs / 1000)}s...`);
        }
        break;
      }
      case SERVER_EVENTS.HUNT_RETURNED_TO_CITY: {
        this.hunt.set(null);
        break;
      }
      case SERVER_EVENTS.GOLD_UPDATE: {
        const g = data as { gold: number };
        this.gold.set(g.gold);
        this.self.update((s) => (s ? { ...s, gold: g.gold } : s));
        break;
      }
      case SERVER_EVENTS.APPEARANCE_LIST: {
        const r = data as { outfits: AvailableOutfit[] };
        this.availableOutfits.set(r.outfits);
        break;
      }
      case SERVER_EVENTS.APPEARANCE_CHANGED: {
        const r = data as { entityId: string; outfitId: number; addonMask: number; colors: { head: number; primary: number; secondary: number; detail: number } };
        this.self.update((s) =>
          s && s.id === r.entityId ? { ...s, appearance: { outfitId: r.outfitId, addonMask: r.addonMask, colors: r.colors } } : s,
        );
        break;
      }
      case SERVER_EVENTS.STATS_UPDATE: {
        const s = data as unknown as HudStats;
        this.stats.set(s);
        this.self.update((current) =>
          current
            ? {
                ...current,
                health: s.health,
                maxHealth: s.maxHealth,
                mana: s.mana,
                maxMana: s.maxMana,
                level: s.level,
                experience: s.experience,
                skills: s.skills ?? current.skills,
              }
            : current,
        );
        break;
      }
      case SERVER_EVENTS.SKILLS_UPDATE: {
        const s = data as { skills: CharacterSkills };
        this.self.update((current) => (current ? { ...current, skills: s.skills } : current));
        break;
      }
      case SERVER_EVENTS.INVENTORY_UPDATE: {
        const i = data as { inventory: CharacterInventory };
        this.inventory.set(i.inventory);
        break;
      }
      case SERVER_EVENTS.CHAT_MESSAGE: {
        const c = data as unknown as ChatLine;
        this.chat.update((list) => {
          const next = [...list, c];
          return next.length > 200 ? next.slice(next.length - 200) : next;
        });
        break;
      }
      case SERVER_EVENTS.NPC_DIALOG: {
        const d = data as { npcId: string; title: string; lines: string[] };
        this.dialog.set({ title: d.title, lines: d.lines });
        break;
      }
      case SERVER_EVENTS.ENTITY_HEALTH: {
        const h = data as { id: string; health: number; maxHealth: number };
        this.target.update((t) => (t && t.id === h.id ? { ...t, health: h.health, maxHealth: h.maxHealth } : t));
        break;
      }
      case SERVER_EVENTS.CREATURE_DAMAGE: {
        const d = data as { creatureId: string; health: number; maxHealth: number };
        this.target.update((t) => (t && t.id === d.creatureId ? { ...t, health: d.health, maxHealth: d.maxHealth } : t));
        break;
      }
      case SERVER_EVENTS.CREATURE_DEATH: {
        const de = data as { creatureId: string; experience: number };
        this.target.update((t) => (t && t.id === de.creatureId ? null : t));
        break;
      }
    }
  }

  drainBuffer(): WsEvent[] {
    const copy = [...this.buffer];
    this.buffer = [];
    return copy;
  }

  addSystemMessage(text: string) {
    this.chat.update((list) => {
      const next = [...list, { channel: 'local', from: 'Sistema', text }];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
  }

  clearTarget() {
    this.target.set(null);
  }

  setToken(token: string, accountId: string) {
    this.token.set(token);
    this.accountId.set(accountId);
    localStorage.setItem('aetheria_token', token);
    localStorage.setItem('aetheria_account', accountId);
  }

  login(username: string, password: string) {
    this.ws.send({ type: 'auth.login', username, password });
  }

  createCharacter(name: string, archetype: CombatArchetype = 'warrior') {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'auth.createCharacter', token, name, archetype });
  }

  selectCharacter(characterId: string) {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'auth.selectCharacter', token, characterId });
  }

  sendChat(text: string) {
    this.ws.send({ type: 'chat.send', channel: 'local', message: text });
  }

  equip(slot: number) {
    this.ws.send({ type: 'inventory.equip', slot });
  }

  unequip(slot: string) {
    this.ws.send({ type: 'inventory.unequip', slot });
  }

  requestHunts() {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'hunt.list', token });
  }

  startHunt(huntId: string, loopEnabled: boolean) {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'hunt.start', token, huntId, loopEnabled });
  }

  stopHunt() {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'hunt.stop', token });
  }

  setLoop(enabled: boolean) {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'hunt.setLoop', token, enabled });
  }

  toggleHunts() {
    this.huntsOpen.update((v) => !v);
  }

  toggleHdSmooth() {
    const next = !this.hdSmooth();
    this.hdSmooth.set(next);
    localStorage.setItem('aetheria_hd_smooth', next ? '1' : '0');
    this.hdSmooth$.next(next);
    this.setZoom(this.zoom());
  }

  openAppearance() {
    const self = this.self();
    if (!self) return;
    const app = self.appearance ?? { outfitId: 1, addonMask: 0, colors: { head: 0, primary: 0, secondary: 0, detail: 0 } };
    this.appearanceDraft.set({ outfitId: app.outfitId, addonMask: app.addonMask, colors: { ...app.colors } });
    this.appearanceOpen.set(true);
    this.requestAppearanceList();
  }

  closeAppearance() {
    this.appearanceOpen.set(false);
  }

  selectOutfit(outfitId: number) {
    this.appearanceDraft.update((d) => (d ? { ...d, outfitId } : d));
  }

  setDraftColor(slot: 'head' | 'primary' | 'secondary' | 'detail', index: number) {
    this.appearanceDraft.update((d) => (d ? { ...d, colors: { ...d.colors, [slot]: index } } : d));
  }

  setDraftAddonMask(mask: number) {
    this.appearanceDraft.update((d) => (d ? { ...d, addonMask: mask } : d));
  }

  saveAppearance() {
    const d = this.appearanceDraft();
    const token = this.token();
    if (!d || !token) return;
    this.ws.send({ type: 'appearance.save', token, outfitId: d.outfitId, addonMask: d.addonMask, colors: d.colors });
    this.appearanceOpen.set(false);
  }

  private requestAppearanceList() {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'appearance.list', token });
  }

  static formatTime(ms: number): string {
    const total = Math.max(0, Math.floor(ms));
    const mm = Math.floor(total / 60_000);
    const ss = Math.floor((total % 60_000) / 1000);
    const mmm = total % 1000;
    return `${mm}:${String(ss).padStart(2, '0')}.${String(mmm).padStart(3, '0')}`;
  }
}

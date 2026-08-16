import { Injectable, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { SERVER_EVENTS } from '@aetheria/protocol';
import type { CharacterInventory, CharacterSummary, MapTile } from '@aetheria/types';
import { WsService, WsEvent } from '../core/ws.service';

export interface HudStats {
  health: number;
  maxHealth: number;
  mana: number;
  maxMana: number;
  level: number;
  experience: number;
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

  /** Buffer de eventos para a cena Phaser que cria depois da conexão. */
  readonly sceneEvents$ = new Subject<WsEvent>();
  private buffer: WsEvent[] = [];

  readonly loginResult$ = new Subject<boolean>();
  readonly characterCreated$ = new Subject<boolean>();
  readonly selectResult$ = new Subject<boolean>();

  constructor(private readonly ws: WsService) {
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
        break;
      }
      case SERVER_EVENTS.STATS_UPDATE: {
        const s = data as unknown as HudStats;
        this.stats.set(s);
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

  createCharacter(name: string) {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'auth.createCharacter', token, name });
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
}
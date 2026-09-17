import { Injectable, computed, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { SERVER_EVENTS } from '@aetheria/protocol';
import type { CharacterInventory, CharacterSkills, CharacterSummary, CombatArchetype, CombatStatsView, HuntListEntry, HuntRunView, MapTile, PlayerCombatConfig } from '@aetheria/types';
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
  readonly characterId = signal<string | null>(localStorage.getItem('aetheria_character'));
  readonly characters = signal<CharacterSummary[]>([]);
  readonly loginError = signal('');
  readonly createError = signal('');

  readonly inGame = signal(false);
  readonly self = signal<CharacterSummary | null>(null);
  readonly abilities = signal<import('@aetheria/types').CombatAbilityDefinition[]>([]);
  readonly attackRotations = signal<Record<string, number[]>>({});
  readonly healingRotations = signal<Record<string, number[]>>({});
  readonly healingPotionRotations = signal<Record<string, Array<string | undefined>>>({});
  readonly attackMinTargets = signal<Record<string, number[]>>({});
  readonly healingTriggers = signal<Record<string, Array<{ target: 'self' | 'lowest_party_member' | 'specific_party_role'; hpBelowPercent: number; mpBelowPercent: number }>>>({});
  readonly combatConfigs = signal<Record<string, PlayerCombatConfig>>({});
  readonly abilityReadyByChar = signal<Record<string, Record<number, number>>>({});
  readonly attackGroupReadyByChar = signal<Record<string, number>>({});
  readonly healingGroupReadyByChar = signal<Record<string, number>>({});
  readonly stats = signal<HudStats>({
    health: 0,
    maxHealth: 0,
    mana: 0,
    maxMana: 0,
    level: 1,
    experience: 0,
  });
  readonly inventory = signal<CharacterInventory>({ slots: [], lootPouchSize: 10, lootPouch: [], equipment: {} });
  readonly combatStats = signal<Record<string, CombatStatsView>>({});
  readonly chat = signal<ChatLine[]>([]);
  readonly dialog = signal<DialogInfo | null>(null);
  readonly target = signal<TargetInfo | null>(null);
  readonly world = signal<WorldSnapshot | null>(null);
  readonly gold = signal(0);
  readonly hunts = signal<HuntListEntry[]>([]);
  readonly hunt = signal<HuntRunView | null>(null);
  readonly huntsOpen = signal(false);
  readonly inArena = computed(() => this.hunt() !== null);

  readonly party = signal<{ unlockedSlots: number; maxSlots: number; unlockCost: number | null; members: import('@aetheria/protocol').PartyMember[] }>({ unlockedSlots: 1, maxSlots: 3, unlockCost: 5000, members: [] });

  readonly appearanceOpen = signal(false);
  readonly appearanceCharacterId = signal<string | null>(null);
  readonly availableOutfits = signal<AvailableOutfit[]>([]);
  readonly appearanceDraft = signal<AppearanceDraft | null>(null);

  /** Renderização HD com anti-aliasing (default) vs pixel art nítido. */
  readonly hdSmooth = signal(localStorage.getItem('aetheria_hd_smooth') !== '0');
  readonly hdSmooth$ = new Subject<boolean>();

  /** Zoom do canvas do jogo (afeta apenas a cena Phaser, não a UI DOM). */
  readonly zoom = signal(parseFloat(localStorage.getItem('aetheria_zoom') ?? '0.8'));
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
  private lastSystemMessage: { text: string; at: number } | null = null;

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
      case 'abilities.update':
        this.abilities.set((data['abilities'] ?? []) as import('@aetheria/types').CombatAbilityDefinition[]);
        break;
      case 'rotation.state': {
        const r = data as { preset?: string; characterId?: string; attack?: { ability_id?: number; min_targets?: number }[]; healing?: { ability_id?: number; trigger?: { target?: 'self' | 'lowest_party_member' | 'specific_party_role'; hpBelowPercent?: number; mpBelowPercent?: number; potionId?: string } }[]; cooldowns?: { attackGroupReadyAt?: number; healingGroupReadyAt?: number; abilityReadyAt?: Record<number, number> } };
        const characterId = r.characterId ?? this.self()?.id;
        if (characterId) {
          if (r.attack) {
            this.attackRotations.update((all) => ({ ...all, [characterId]: [0, 1, 2, 3].map((index) => r.attack?.[index]?.ability_id ?? 0) }));
            this.attackMinTargets.update((all) => ({ ...all, [characterId]: [0, 1, 2, 3].map((index) => r.attack?.[index]?.min_targets ?? 0) }));
          }
          if (r.healing) {
            this.healingRotations.update((all) => ({ ...all, [characterId]: [0, 1, 2, 3].map((index) => r.healing?.[index]?.ability_id ?? 0) }));
            this.healingPotionRotations.update((all) => ({ ...all, [characterId]: [0, 1, 2, 3].map((index) => r.healing?.[index]?.trigger?.potionId) }));
            this.healingTriggers.update((all) => ({ ...all, [characterId]: [0, 1, 2, 3].map((index) => ({ target: r.healing?.[index]?.trigger?.target ?? 'self', hpBelowPercent: r.healing?.[index]?.trigger?.hpBelowPercent ?? 80, mpBelowPercent: r.healing?.[index]?.trigger?.mpBelowPercent ?? 50 })) }));
          }
          if (r.cooldowns) this.applyCooldowns(characterId, r.cooldowns);
        }
        break;
      }
      case SERVER_EVENTS.COOLDOWNS_UPDATE: {
        const r = data as { characterId: string; attackGroupReadyAt: number; healingGroupReadyAt: number; abilityReadyAt: Record<number, number> };
        this.applyCooldowns(r.characterId, r);
        break;
      }
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
          this.characterId.set(null);
          localStorage.removeItem('aetheria_character');
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
      case SERVER_EVENTS.CHARACTERS_UPDATE: {
        const r = data as { characters?: CharacterSummary[] };
        this.characters.set(r.characters ?? []);
        break;
      }
      case SERVER_EVENTS.SELECT_RESULT: {
        const r = data as { ok: boolean };
        this.inGame.set(r.ok);
        if (!r.ok) {
          this.characterId.set(null);
          localStorage.removeItem('aetheria_character');
        }
        this.selectResult$.next(r.ok);
        break;
      }
      case SERVER_EVENTS.ENTER_WORLD: {
        const w = data as { character: CharacterSummary; map: MapTile[]; width: number; height: number };
        this.self.set(w.character);
        this.characterId.set(w.character.id);
        localStorage.setItem('aetheria_character', w.character.id);
        this.world.set({ map: w.map, width: w.width, height: w.height });
        this.inGame.set(true);
        this.hunt.set(null);
        this.gold.set(w.character.gold);
        const combat = w.character.combat;
        if (combat) this.combatConfigs.update((all) => ({ ...all, [w.character.id]: combat }));
        this.requestHunts();
        break;
      }
      case SERVER_EVENTS.ENTER_ARENA: {
        const w = data as { character: CharacterSummary; map: MapTile[]; width: number; height: number; hunt: HuntRunView };
        this.self.set(w.character);
        this.characterId.set(w.character.id);
        localStorage.setItem('aetheria_character', w.character.id);
        this.world.set({ map: w.map, width: w.width, height: w.height });
        this.hunt.set(w.hunt);
        this.gold.set(w.character.gold);
        const combat = w.character.combat;
        if (combat) this.combatConfigs.update((all) => ({ ...all, [w.character.id]: combat }));
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
      case SERVER_EVENTS.HUNT_FAVORITE_CHANGED: {
        const r = data as { huntId: string; favorite: boolean };
        this.hunts.update((list) => list.map((h) => (h.id === r.huntId ? { ...h, favorite: r.favorite } : h)));
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
        if (!r.loopEnabled) {
          this.hunt.set(null);
          this.target.set(null);
        }
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
        this.target.set(null);
        break;
      }
      case SERVER_EVENTS.PARTY_STATE: {
        const r = data as { unlockedSlots: number; maxSlots: number; unlockCost: number | null; members: import('@aetheria/protocol').PartyMember[] };
        this.party.set({ unlockedSlots: r.unlockedSlots, maxSlots: r.maxSlots, unlockCost: r.unlockCost, members: r.members ?? [] });
        for (const m of r.members ?? []) {
          const combat = m.combat;
          if (combat) this.combatConfigs.update((all) => ({ ...all, [m.id]: combat }));
        }
        for (const m of r.members ?? []) this.ws.send({ type: 'rotation.load', preset: 'HUNT', characterId: m.id });
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
        const appearance = { outfitId: r.outfitId, addonMask: r.addonMask, colors: r.colors };
        this.self.update((s) => (s && s.id === r.entityId ? { ...s, appearance } : s));
        this.party.update((p) => ({ ...p, members: p.members.map((m) => (m.id === r.entityId ? { ...m, appearance } : m)) }));
        break;
      }
      case SERVER_EVENTS.COMBAT_CONFIG: {
        const r = data as { characterId: string; combat: PlayerCombatConfig };
        this.combatConfigs.update((all) => ({ ...all, [r.characterId]: r.combat }));
        this.self.update((s) => (s && s.id === r.characterId ? { ...s, combat: r.combat } : s));
        this.party.update((p) => ({ ...p, members: p.members.map((m) => (m.id === r.characterId ? { ...m, combat: r.combat } : m)) }));
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
      case SERVER_EVENTS.STATS_COMBAT: {
        const s = data as unknown as CombatStatsView & { characterId: string };
        this.combatStats.update((all) => ({ ...all, [s.characterId]: s }));
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
    const now = Date.now();
    if (this.lastSystemMessage?.text === text && now - this.lastSystemMessage.at < 1000) return;
    this.lastSystemMessage = { text, at: now };
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

  equip(slot: number, characterId?: string) {
    this.ws.send({ type: 'inventory.equip', slot, characterId });
  }

  unequip(slot: string, characterId?: string) {
    this.ws.send({ type: 'inventory.unequip', slot, characterId });
  }

  moveInventory(from: 'backpack' | 'loot', fromIndex: number, to: 'backpack' | 'loot', toIndex: number) {
    this.ws.send({ type: 'inventory.move', from, fromIndex, to, toIndex });
  }

  expandLootPouch() {
    this.ws.send({ type: 'inventory.expandLootPouch' });
  }

  sellLootPouch() {
    this.ws.send({ type: 'inventory.sellLootPouch' });
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

  setFavorite(huntId: string, favorite: boolean) {
    const token = this.token();
    if (!token) return;
    this.hunts.update((list) => list.map((h) => (h.id === huntId ? { ...h, favorite } : h)));
    this.ws.send({ type: 'hunt.setFavorite', token, huntId, favorite });
  }

  unlockPartySlot() {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'party.unlockSlot', token });
  }

  summonPartyMember(characterId: string) {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'party.summon', token, characterId });
  }

  dismissPartyMember(characterId: string) {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'party.dismiss', token, characterId });
  }

  setCombatConfig(characterId: string, targeting: PlayerCombatConfig['targeting'], movement: PlayerCombatConfig['movement'], attackRange?: number) {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'combat.config', token, characterId, targeting, movement, attackRange });
  }

  loadRotation(characterId: string) {
    this.ws.send({ type: 'rotation.load', preset: 'HUNT', characterId });
  }

  combatFor(characterId: string): PlayerCombatConfig {
    return this.combatConfigs()[characterId] ?? { targeting: 'nearest', movement: 'hold' };
  }

  attackGroupReadyFor(characterId: string): number {
    return this.attackGroupReadyByChar()[characterId] ?? 0;
  }

  healingGroupReadyFor(characterId: string): number {
    return this.healingGroupReadyByChar()[characterId] ?? 0;
  }

  abilityReadyFor(characterId: string, abilityId: number): number {
    return this.abilityReadyByChar()[characterId]?.[abilityId] ?? 0;
  }

  private applyCooldowns(characterId: string, cooldowns: { attackGroupReadyAt?: number; healingGroupReadyAt?: number; abilityReadyAt?: Record<number, number> }) {
    if (cooldowns.attackGroupReadyAt !== undefined) this.attackGroupReadyByChar.update((all) => ({ ...all, [characterId]: cooldowns.attackGroupReadyAt! }));
    if (cooldowns.healingGroupReadyAt !== undefined) this.healingGroupReadyByChar.update((all) => ({ ...all, [characterId]: cooldowns.healingGroupReadyAt! }));
    if (cooldowns.abilityReadyAt) this.abilityReadyByChar.update((all) => ({ ...all, [characterId]: cooldowns.abilityReadyAt! }));
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

  openAppearance(characterId?: string) {
    const id = characterId ?? this.self()?.id;
    if (!id) return;
    const member = this.party().members.find((m) => m.id === id);
    const self = this.self();
    const base = (member ?? self)?.appearance ?? { outfitId: 1, addonMask: 0, colors: { head: 0, primary: 0, secondary: 0, detail: 0 } };
    this.appearanceCharacterId.set(id);
    this.appearanceDraft.set({ outfitId: base.outfitId, addonMask: base.addonMask, colors: { ...base.colors } });
    this.appearanceOpen.set(true);
    this.requestAppearanceList(id);
  }

  closeAppearance() {
    this.appearanceOpen.set(false);
    this.appearanceCharacterId.set(null);
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
    this.ws.send({ type: 'appearance.save', token, characterId: this.appearanceCharacterId() ?? undefined, outfitId: d.outfitId, addonMask: d.addonMask, colors: d.colors });
    this.appearanceOpen.set(false);
    this.appearanceCharacterId.set(null);
  }

  private requestAppearanceList(characterId?: string) {
    const token = this.token();
    if (!token) return;
    this.ws.send({ type: 'appearance.list', token, characterId });
  }

  static formatTime(ms: number): string {
    const total = Math.max(0, Math.floor(ms));
    const mm = Math.floor(total / 60_000);
    const ss = Math.floor((total % 60_000) / 1000);
    const mmm = total % 1000;
    return `${mm}:${String(ss).padStart(2, '0')}.${String(mmm).padStart(3, '0')}`;
  }
}

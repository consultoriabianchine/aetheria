import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Subscription, first, interval } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Phaser from 'phaser';
import type { CharacterEquipment, CharacterSkills, CombatAbilityDefinition, ItemDefinition, ItemStack, PlayerCombatConfig } from '@aetheria/types';
import { APPEARANCE_PALETTE, INVENTORY_SIZE, LOOT_POUCH_EXPANSION, SKILL_PROGRESSION_CONFIG, xpForLevel } from '@aetheria/config';
import { WsService } from '../core/ws.service';
import { ChatLine, GameState } from './game-state';
import { ItemCatalogService } from './item-catalog.service';
import { CreatureAssetService } from './creature-asset.service';
import { OutfitAssetService } from './outfit-asset.service';
import { OutfitThumb } from './outfit-thumb';
import { HuntBrowser } from './hunt/hunt-browser';
import { HuntBrowserState } from './hunt/hunt-browser-state';
import { WorldScene } from './scenes/world-scene';

interface InvEntry {
  index: number;
  stack: ItemStack | null;
}

interface EqEntry {
  slot: string;
  label: string;
  stack: ItemStack | null;
}

@Component({
  selector: 'app-game',
  imports: [FormsModule, OutfitThumb, HuntBrowser],
  templateUrl: './game.html',
  styleUrl: './game.scss',
})
export class Game implements OnInit, AfterViewInit, OnDestroy {
  readonly state = inject(GameState);
  readonly chatInput = signal('');
  readonly statusOpen = signal(false);
  readonly leftCollapsed = signal(false);
  readonly rightCollapsed = signal(false);
  readonly boostsCollapsed = signal(true);
  readonly analyzerCollapsed = signal(false);
  readonly damageCollapsed = signal(false);
  readonly damageTakenCollapsed = signal(true);
  readonly chatCollapsed = signal(false);
  readonly chatTab = signal<'general' | 'combat' | 'system'>('general');
  readonly rotationOpen = signal(false);
  readonly rotationCharacterId = signal<string | null>(null);
  readonly rotationMode = signal<'attack' | 'healing'>('attack');
  readonly healingThreshold = signal(80);
  readonly healTarget = signal<'self' | 'lowest_party_member' | 'specific_party_role'>('self');
  readonly manageOpen = signal(false);
  readonly manageMemberId = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly hoveredItemId = signal<string | null>(null);
  readonly itemTooltipX = signal(0);
  readonly itemTooltipY = signal(0);
  readonly itemContextMenu = signal<{ x: number; y: number; itemIndex: number } | null>(null);
  readonly colorSlots = ['head', 'primary', 'secondary', 'detail'] as const;
  readonly palette = APPEARANCE_PALETTE;
  readonly backpackSize = INVENTORY_SIZE;

  private readonly el = inject(ElementRef);
  private readonly ws = inject(WsService);
  private readonly itemCatalog = inject(ItemCatalogService);
  private readonly creatureAssets = inject(CreatureAssetService);
  private readonly outfitAssets = inject(OutfitAssetService);
  private readonly huntBrowser = inject(HuntBrowserState);
  private readonly router = inject(Router);
  private phaser: Phaser.Game | null = null;
  private timerSub?: Subscription;
  private visibilityHandler = () => { if (!document.hidden) this.resyncAfterResume(); };
  private sidebarMq?: MediaQueryList;
  private readonly sidebarMqListener = (e: MediaQueryListEvent | MediaQueryList) => {
    if (e.matches) {
      this.leftCollapsed.set(true);
      this.rightCollapsed.set(true);
    }
  };

  ngOnInit() {
    if (!this.state.token()) {
      void this.router.navigate(['/login']);
      return;
    }
    if (!this.ws.connected) this.ws.connect();
    void this.itemCatalog.ensureLoaded();
    if (!this.state.inGame()) {
      const saved = this.state.characterId();
      if (saved) {
        this.state.selectCharacter(saved);
        this.state.selectResult$.pipe(first()).subscribe((ok) => {
          if (!ok) void this.router.navigate(['/characters']);
        });
      } else {
        void this.router.navigate(['/characters']);
        return;
      }
    }
    document.addEventListener('visibilitychange', this.visibilityHandler);
    this.sidebarMq = window.matchMedia('(max-width: 900px)');
    this.sidebarMq.addEventListener('change', this.sidebarMqListener);
    if (this.sidebarMq.matches) {
      this.leftCollapsed.set(true);
      this.rightCollapsed.set(true);
    }
    this.ws.events$.subscribe((event) => {
      if (event.event === 'system.connected') {
        this.resyncAfterResume();
        this.rejoinCharacter();
      }
    });
    this.timerSub = interval(100).subscribe(() => {
      this.now.set(Date.now());
    });
    queueMicrotask(() => this.resyncAfterResume());
  }

  private resyncAfterResume() {
    if (!this.ws.connected) { this.ws.connect(); return; }
    this.state.requestHunts();
    for (const m of this.state.party().members) this.state.loadRotation(m.id);
    this.now.set(Date.now());
    this.phaser?.scale.refresh();
  }

  /** Reconecta o personagem ativo após o WebSocket ser restabelecido. */
  private rejoinCharacter() {
    const self = this.state.self();
    const token = this.state.token();
    if (self?.id && token) {
      this.state.selectCharacter(self.id);
    }
  }

  ngAfterViewInit() {
    const host = this.el.nativeElement.querySelector('#game-canvas') as HTMLElement | null;
    if (!host) return;
    this.phaser = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width: host.clientWidth || 960,
      height: host.clientHeight || 640,
      backgroundColor: '#141a24',
      scale: { mode: Phaser.Scale.RESIZE },
      scene: [],
    });
    this.setupHiDpi();
    this.phaser.scene.add('World', WorldScene, false);
    this.phaser.scene.start('World', { ws: this.ws, state: this.state, assets: this.creatureAssets, outfits: this.outfitAssets });
  }

  /** Renderiza em device-pixel-ratio para sprites nítidas em telas HiDPI. */
  private setupHiDpi() {
    const game = this.phaser;
    if (!game) return;
    const apply = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = game.scale.gameSize.width;
      const h = game.scale.gameSize.height;
      if (!w || !h) return;
      game.canvas.width = Math.round(w * dpr);
      game.canvas.height = Math.round(h * dpr);
      game.renderer.resize(Math.round(w * dpr), Math.round(h * dpr));
    };
    game.scale.on(Phaser.Scale.Events.RESIZE, apply);
    apply();
  }

  ngOnDestroy() {
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.sidebarMq?.removeEventListener('change', this.sidebarMqListener);
    this.timerSub?.unsubscribe();
    this.phaser?.destroy(true);
    this.phaser = null;
    this.state.dialog.set(null);
    this.state.clearTarget();
  }

  hpPct(): number {
    const s = this.state.stats();
    return s.maxHealth > 0 ? (s.health / s.maxHealth) * 100 : 0;
  }

  mpPct(): number {
    const s = this.state.stats();
    return s.maxMana > 0 ? (s.mana / s.maxMana) * 100 : 0;
  }

  xpPct(): number {
    const s = this.state.stats();
    const needed = xpForLevel(s.level);
    return needed > 0 ? (s.experience / needed) * 100 : 0;
  }

  xpNeeded(): number {
    return xpForLevel(this.state.stats().level);
  }

  zoomPct(): string {
    return `${Math.round(this.state.zoom() * 100)}%`;
  }

  inventory(): InvEntry[] {
    const slots = this.state.inventory().slots;
    return slots.map((stack, index) => ({ index, stack }));
  }

  backpackPreview(): InvEntry[] {
    return this.fixedSlots(this.state.inventory().slots, INVENTORY_SIZE);
  }

  lootPouchPreview(): InvEntry[] {
    return this.fixedSlots(this.state.inventory().lootPouch ?? [], this.lootPouchSize());
  }

  lootPouchSize(): number {
    return Math.max(10, this.state.inventory().lootPouchSize ?? 10, this.state.inventory().lootPouch?.length ?? 0);
  }

  private fixedSlots(slots: (ItemStack | null)[], size: number): InvEntry[] {
    return Array.from({ length: size }, (_, index) => ({ index, stack: slots[index] ?? null }));
  }

  backpackCount(): number {
    return this.backpackPreview().filter((entry) => entry.stack).length;
  }

  lootPouchCount(): number {
    return this.lootPouchPreview().filter((entry) => entry.stack).length;
  }

  lootPouchExpansionCost(): number | null {
    const size = this.lootPouchSize();
    return size >= LOOT_POUCH_EXPANSION.maxSize ? null : LOOT_POUCH_EXPANSION.goldCost(size);
  }

  equipment(): EqEntry[] {
    return this.equipmentFor(this.state.self()?.id ?? '');
  }

  equipmentFor(memberId: string): EqEntry[] {
    const member = this.state.party().members.find((m) => m.id === memberId);
    const eq: CharacterEquipment = member?.equipment ?? this.state.inventory().equipment;
    const labels: Record<string, string> = {
      helmet: 'Capacete',
      armor: 'Armadura',
      legs: 'Pernas',
      boots: 'Botas',
      ring: 'Anel',
      necklace: 'Colar',
      relic: 'Relíquia',
      weapon: 'Arma',
      offhand: 'Offhand',
      ammo: 'Munição',
    };
    return (Object.keys(labels) as (keyof CharacterEquipment)[]).map((slot) => ({
      slot,
      label: labels[slot],
      stack: eq[slot] ?? null,
    }));
  }

  iconFor(itemId: string): string | null {
    this.itemCatalog.ready();
    const def = this.itemCatalog.get(itemId);
    if (!def?.image) return null;
    if (/^https?:\/\//.test(def.image) || def.image.startsWith('/') || def.image.startsWith('assets/')) return def.image;
    return `assets/items/${def.image}`;
  }

  nameFor(itemId: string): string {
    this.itemCatalog.ready();
    return this.itemCatalog.get(itemId)?.name ?? itemId;
  }

  itemTooltip(itemId: string): string[] {
    this.itemCatalog.ready();
    const item = this.itemCatalog.get(itemId);
    if (!item) return [itemId, 'Item sem definição carregada.'];
    const lines = [item.name, `${this.typeLabel(item)}${item.slot ? ` · ${this.slotLabel(item.slot)}` : ''}`];
    if (item.weight > 0) lines.push(`Peso: ${item.weight}`);
    if (item.attack > 0) lines.push(`Attack: ${item.attack}`);
    if (item.defense > 0) lines.push(`Defense: ${item.defense}`);
    if (item.weapon) {
      lines.push(`Weapon: ${item.weapon.weaponType}`);
      if (item.weapon.attackPower > 0) lines.push(`Attack Power: ${item.weapon.attackPower}`);
      if (item.weapon.magicPower) lines.push(`Magic Power: ${item.weapon.magicPower}`);
      lines.push(`Range: ${item.weapon.range}`);
      lines.push(`Damage: ${item.weapon.damageType ?? 'physical'}`);
      if (item.weapon.allowedAmmoType) lines.push(`Ammo: ${item.weapon.allowedAmmoType}`);
      if (item.weapon.twoHanded) lines.push('Two-handed');
    }
    if (item.ammo) {
      lines.push(`Ammo: ${item.ammo.ammoType}`);
      lines.push(`Attack Power: ${item.ammo.attackPower}`);
      lines.push(`Damage: ${item.ammo.damageType ?? 'physical'}`);
    }
    const stats = item.combatStats;
    if (stats) {
      if (stats.attackPower) lines.push(`Attack Power: +${stats.attackPower}`);
      if (stats.magicPower) lines.push(`Magic Power: +${stats.magicPower}`);
      if (stats.armor) lines.push(`Armor: +${stats.armor}`);
      if (stats.defense) lines.push(`Defense: +${stats.defense}`);
      if (stats.maxHp) lines.push(`HP: +${stats.maxHp}`);
      if (stats.maxMana) lines.push(`Mana: +${stats.maxMana}`);
      if (stats.criticalChance) lines.push(`Crit Chance: +${this.percent(stats.criticalChance)}`);
      if (stats.criticalDamage) lines.push(`Crit Damage: +${this.percent(stats.criticalDamage)}`);
      if (stats.accuracy) lines.push(`Accuracy: +${this.percent(stats.accuracy)}`);
      if (stats.dodge) lines.push(`Dodge: +${this.percent(stats.dodge)}`);
      for (const [skill, value] of Object.entries(stats.skillBonuses ?? {})) lines.push(`${skill}: +${value}`);
      for (const [type, value] of Object.entries(stats.resistances ?? {})) lines.push(`${type} Resistance: ${this.percent(value)}`);
    }
    if (item.stackable) lines.push('Stackable');
    return lines;
  }

  showItemTooltip(itemId: string, event: MouseEvent) {
    this.hoveredItemId.set(itemId);
    this.moveItemTooltip(event);
    requestAnimationFrame(() => this.moveItemTooltip(event));
  }

  moveItemTooltip(event: MouseEvent) {
    const offset = 10;
    const margin = 12;
    let x = event.clientX + offset;
    let y = event.clientY + offset;
    const tooltip = this.el.nativeElement.querySelector('.floating-item-tooltip') as HTMLElement | null;
    if (tooltip) {
      const width = tooltip.offsetWidth;
      const height = tooltip.offsetHeight;
      if (width > 0 && x + width > window.innerWidth - margin) x = event.clientX - width - offset;
      if (height > 0 && y + height > window.innerHeight - margin) y = event.clientY - height - offset;
      if (x < margin) x = margin;
      if (y < margin) y = margin;
    }
    this.itemTooltipX.set(x);
    this.itemTooltipY.set(y);
  }

  hideItemTooltip() {
    this.hoveredItemId.set(null);
  }

  skills(): Array<{ label: string; value: number; xp: number; required: number; pct: number }> {
    const skills: CharacterSkills = this.state.self()?.skills ?? { melee: 10, distance: 10, magic: 10 };
    const progress = new Map((this.state.stats().skillProgress ?? []).map((p) => [p.skillType, p]));
    return [
      { key: 'melee' as const, label: 'Melee', value: skills.melee },
      { key: 'distance' as const, label: 'Distance', value: skills.distance },
      { key: 'magic' as const, label: 'Magic', value: skills.magic },
    ].map((skill) => {
      const xp = progress.get(skill.key)?.experience ?? 0;
      const cfg = SKILL_PROGRESSION_CONFIG[skill.key];
      const required = cfg.base + cfg.quadratic * skill.value * skill.value;
      return { ...skill, xp, required, pct: required > 0 ? (xp / required) * 100 : 0 };
    });
  }

  relevantSkills(): Array<{ label: string; value: number; xp: number; required: number; pct: number }> {
    const archetype = this.state.self()?.archetype;
    const all = this.skills();
    if (archetype === 'mage') return all.filter((s) => s.label === 'Magic');
    if (archetype === 'archer') return all.filter((s) => s.label === 'Distance' || s.label === 'Magic');
    return all.filter((s) => s.label === 'Melee' || s.label === 'Magic');
  }

  statusRows(): Array<{ label: string; value: string | number }> {
    const self = this.state.self();
    const stats = this.state.stats();
    return [
      { label: 'Arquétipo', value: self?.archetype ?? '—' },
      { label: 'Level', value: stats.level },
      { label: 'XP', value: `${stats.experience}/${xpForLevel(stats.level)}` },
      { label: 'Gold', value: this.state.gold() },
      { label: 'HP', value: `${stats.health}/${stats.maxHealth}` },
      { label: 'Mana', value: `${stats.mana}/${stats.maxMana}` },
    ];
  }

  equippedCount(): number {
    return Object.values(this.state.inventory().equipment).filter(Boolean).length;
  }

  formatGold(value: number | string): string {
    const n = typeof value === 'string' ? Number(value) : value;
    return Number.isFinite(n) ? new Intl.NumberFormat('pt-BR').format(n) : String(value);
  }

  archetypeLabel(): string {
    const labels: Record<string, string> = {
      warrior: 'Knight',
      archer: 'Paladin',
      mage: 'Druid',
    };
    const archetype = this.state.self()?.archetype;
    return archetype ? labels[archetype] ?? archetype : '—';
  }

  currentHuntName(): string {
    return this.state.hunt()?.huntName ?? this.state.hunts()[0]?.name ?? 'Selecione uma Hunt';
  }

  waveCells(): Array<{ index: number; filled: boolean; boss: boolean }> {
    const wave = this.state.hunt()?.wave ?? 0;
    return Array.from({ length: 10 }, (_, i) => ({ index: i + 1, filled: wave >= i + 1, boss: i === 9 }));
  }

  combatLines(): ChatLine[] {
    return this.state.chat().filter((line) => line.from === 'Sistema' || /dano|loot|xp|hunt|onda|derrot/i.test(line.text));
  }

  systemLines(): ChatLine[] {
    return this.state.chat().filter((line) => line.from === 'Sistema');
  }

  visibleChat(): ChatLine[] {
    const tab = this.chatTab();
    if (tab === 'combat') return this.combatLines();
    if (tab === 'system') return this.systemLines();
    return this.state.chat();
  }

  partySlots(): (import('@aetheria/protocol').PartyMember | null)[] {
    const members = this.state.party().members;
    return [0, 1, 2].map((i) => members[i] ?? null);
  }

  attackRotationFor(characterId: string): number[] {
    return this.state.attackRotations()[characterId] ?? [0, 0, 0, 0];
  }

  healingRotationFor(characterId: string): number[] {
    return this.state.healingRotations()[characterId] ?? [0, 0, 0, 0];
  }

  /** Habilidades exibíveis para o personagem (filtra por classe e esconde só-monstro). */
  abilitiesFor(characterId: string): CombatAbilityDefinition[] {
    const self = this.state.self();
    const member = this.state.party().members.find((m) => m.id === characterId);
    const archetype = (characterId === self?.id ? self?.archetype : member?.archetype) ?? self?.archetype;
    return this.state.abilities().filter((ability) => {
      if (ability.ownerType === 'monster') return false;
      if (!ability.playerClass || ability.playerClass === 'all') return true;
      return ability.playerClass === archetype;
    });
  }

  hotbarSlotsFor(characterId: string): Array<{ key: number; abilityId?: number; name: string; cd: string; ready: boolean; groupPct: number }> {
    const ids = this.attackRotationFor(characterId);
    const now = this.now();
    const groupRemaining = Math.max(0, this.state.attackGroupReadyFor(characterId) - now);
    return [0, 1, 2, 3].map((index) => {
      const ability = this.state.abilities().find((item) => item.abilityId === ids[index]);
      if (!ability) return { key: index + 1, name: 'Empty', cd: '—', ready: false, groupPct: 0 };
      const abilityRemaining = Math.max(0, this.state.abilityReadyFor(characterId, ability.abilityId) - now);
      const remaining = Math.max(groupRemaining, abilityRemaining);
      const duration = Math.max(1, Math.max(ability.cooldownMs, 2000));
      return { key: index + 1, abilityId: ability.abilityId, name: ability.name, cd: remaining > 0 ? (remaining / 1000).toFixed(1) : 'READY', ready: remaining === 0, groupPct: Math.max(0, Math.min(100, 100 - (remaining / duration) * 100)) };
    });
  }

  healSlotFor(characterId: string): { abilityId?: number; name: string; icon?: string } {
    const id = this.healingRotationFor(characterId)[0];
    const ability = this.state.abilities().find((a) => a.abilityId === id);
    return { abilityId: ability?.abilityId, name: ability?.name ?? 'Cura', icon: ability?.icon };
  }

  useHotbarSlot(slot: { abilityId?: number }) {
    const targetId = this.state.target()?.id;
    if (slot.abilityId) this.ws.send({ type: 'ability.cast', abilityId: slot.abilityId, targetId });
  }

  private dragged: { characterId: string; index: number } | null = null;
  startSlotDrag(characterId: string, index: number, event: DragEvent) {
    this.dragged = { characterId, index };
    event.dataTransfer?.setData('text/plain', String(index));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  allowSlotDrop(event: DragEvent) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; }
  dropSlot(characterId: string, index: number, event: DragEvent) {
    event.preventDefault();
    const source = this.dragged?.index ?? Number(event.dataTransfer?.getData('text/plain'));
    this.dragged = null;
    if (!Number.isInteger(source) || source < 0 || source > 3 || source === index) return;
    const slots = [...this.attackRotationFor(characterId)];
    [slots[source], slots[index]] = [slots[index], slots[source]];
    this.state.attackRotations.update((all) => ({ ...all, [characterId]: slots }));
    this.saveAttackRotationSlots(characterId, slots);
  }
  private saveAttackRotationSlots(characterId: string, ids: number[]) {
    const slots = ids.map((abilityId, index) => ({ position: (index + 1) as 1 | 2 | 3 | 4, abilityId: abilityId || undefined, enabled: abilityId > 0 }));
    this.ws.send({ type: 'rotation.attack.set', preset: 'HUNT', characterId, slots });
  }

  private draggedItem: { container: 'backpack' | 'loot'; index: number } | null = null;
  onItemDragStart(event: DragEvent, container: 'backpack' | 'loot', index: number) {
    this.hideItemTooltip();
    this.draggedItem = { container, index };
    event.dataTransfer?.setData('text/plain', `${container}:${index}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }
  onItemDrop(event: DragEvent, container: 'backpack' | 'loot', index: number) {
    event.preventDefault();
    this.hideItemTooltip();
    const source = this.draggedItem;
    this.draggedItem = null;
    if (!source || (source.container === container && source.index === index)) return;
    this.state.moveInventory(source.container, source.index, container, index);
  }
  onItemDragEnd() {
    this.hideItemTooltip();
    this.draggedItem = null;
  }

  hotbarMemberName(characterId: string): string {
    return this.state.party().members.find((m) => m.id === characterId)?.name ?? this.state.self()?.name ?? 'Personagem';
  }

  onHuntSelect(huntId: string) {
    if (!huntId) return;
    this.startHunt(huntId);
  }

  private percent(value: number): string {
    return `${Math.round(value * 1000) / 10}%`;
  }

  private typeLabel(item: ItemDefinition): string {
    return item.category || item.type;
  }

  private slotLabel(slot: string): string {
    const labels: Record<string, string> = {
      helmet: 'Capacete',
      armor: 'Armadura',
      legs: 'Pernas',
      boots: 'Botas',
      ring: 'Anel',
      necklace: 'Colar',
      relic: 'Relíquia',
      weapon: 'Arma',
      offhand: 'Offhand',
      ammo: 'Munição',
    };
    return labels[slot] ?? slot;
  }

  sendChat() {
    const text = this.chatInput().trim();
    if (!text) return;
    this.state.sendChat(text);
    this.chatInput.set('');
  }

  onEquip(index: number) {
    this.state.equip(index);
  }

  onUnequip(slot: string) {
    this.state.unequip(slot);
  }

  openItemContextMenu(event: MouseEvent, itemIndex: number, itemId: string) {
    event.preventDefault();
    event.stopPropagation();
    const def = this.itemCatalog.get(itemId);
    if (!def?.slot) return;
    const members = Math.max(1, this.partyMembers().length);
    const menuWidth = 220;
    const menuHeight = 36 + members * 34;
    const x = Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8));
    const y = Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8));
    this.itemContextMenu.set({ x, y, itemIndex });
  }

  closeItemContextMenu() {
    this.itemContextMenu.set(null);
  }

  equipToMember(characterId: string) {
    const menu = this.itemContextMenu();
    if (!menu) return;
    this.state.equip(menu.itemIndex, characterId);
    this.closeItemContextMenu();
  }

  closeDialog() {
    this.state.dialog.set(null);
  }

  fmtTime(ms: number | null): string {
    return ms == null ? '—' : GameState.formatTime(ms);
  }

  startHunt(huntId: string) {
    this.state.startHunt(huntId, false);
  }

  startLoop(huntId: string) {
    this.state.startHunt(huntId, true);
  }

  stopHunt() {
    this.state.stopHunt();
  }

  toggleLoop() {
    const h = this.state.hunt();
    if (h) this.state.setLoop(!h.loopEnabled);
  }

  toggleHunts() {
    this.state.toggleHunts();
  }

  openHuntBrowser() {
    this.huntBrowser.openBrowser();
  }

  partyMembers() {
    return this.state.party().members;
  }

  partyUnlockCost(): number | null {
    return this.state.party().unlockCost;
  }

  summonableCharacters(): import('@aetheria/types').CharacterSummary[] {
    const self = this.state.self();
    const memberIds = new Set(this.state.party().members.map((m) => m.id));
    return this.state.characters().filter((c) => !memberIds.has(c.id) && c.id !== self?.id);
  }

  // ---- gerenciamento por personagem ----
  openManage() {
    this.manageMemberId.set(this.state.self()?.id ?? this.state.party().members[0]?.id ?? null);
    this.manageOpen.set(true);
  }
  closeManage() { this.manageOpen.set(false); }
  selectManageMember(id: string) { this.manageMemberId.set(id); }
  openManageAppearance(memberId: string) {
    this.closeManage();
    this.state.openAppearance(memberId);
  }
  manageMember(): import('@aetheria/protocol').PartyMember | null {
    const id = this.manageMemberId();
    return this.state.party().members.find((m) => m.id === id) ?? this.state.party().members[0] ?? null;
  }
  combatFor(memberId: string): PlayerCombatConfig {
    return this.state.combatFor(memberId);
  }
  onManageTargeting(memberId: string, value: string) {
    const c = this.combatFor(memberId);
    this.state.setCombatConfig(memberId, value as PlayerCombatConfig['targeting'], c.movement, c.attackRange);
  }
  onManageMovement(memberId: string, value: string) {
    const c = this.combatFor(memberId);
    this.state.setCombatConfig(memberId, c.targeting, value as PlayerCombatConfig['movement'], c.attackRange);
  }
  onManageAttackRange(memberId: string, value: number | null) {
    const c = this.combatFor(memberId);
    this.state.setCombatConfig(memberId, c.targeting, c.movement, value ?? undefined);
  }
  onEquipFor(memberId: string, index: number) { this.state.equip(index, memberId); }
  onUnequipFor(memberId: string, slot: string) { this.state.unequip(slot, memberId); }

  // ---- rotação ----
  openRotationFor(characterId: string) { this.rotationCharacterId.set(characterId); this.rotationOpen.set(true); }
  rotationCharacterName(): string { return this.rotationCharacterId() ? this.hotbarMemberName(this.rotationCharacterId()!) : ''; }
  attackRotationForModal(): number[] { return this.attackRotationFor(this.rotationCharacterId() ?? ''); }
  healingRotationForModal(): number[] { return this.healingRotationFor(this.rotationCharacterId() ?? ''); }
  setRotationAbility(index: number, abilityId: number) {
    const id = this.rotationCharacterId();
    if (!id) return;
    const target = this.rotationMode() === 'attack' ? this.state.attackRotations : this.state.healingRotations;
    target.update((all) => ({ ...all, [id]: (all[id] ?? [0, 0, 0, 0]).map((value, i) => (i === index ? abilityId : value)) }));
  }
  rotationAbilityName(id: number) { return this.state.abilities().find((ability) => ability.abilityId === id)?.name ?? 'Empty'; }
  rotationAbilityIcon(id: number) { return this.state.abilities().find((ability) => ability.abilityId === id)?.icon; }
  saveRotation() {
    const characterId = this.rotationCharacterId();
    if (!characterId) return;
    if (this.rotationMode() === 'attack') {
      const slots = this.attackRotationForModal().map((abilityId, index) => ({ position: (index + 1) as 1 | 2 | 3 | 4, abilityId: abilityId || undefined, enabled: abilityId > 0 }));
      this.ws.send({ type: 'rotation.attack.set', preset: 'HUNT', characterId, slots });
    } else {
      const slots = this.healingRotationForModal().map((abilityId, index) => ({ position: (index + 1) as 1 | 2 | 3 | 4, abilityId: abilityId || undefined, enabled: abilityId > 0, trigger: { target: this.healTarget(), hpBelowPercent: this.healingThreshold() } }));
      this.ws.send({ type: 'rotation.healing.set', preset: 'HUNT', characterId, slots });
    }
    this.rotationOpen.set(false);
  }

  openAppearance() {
    this.state.openAppearance();
  }

  draftOutfit() {
    const id = this.state.appearanceDraft()?.outfitId;
    return this.state.availableOutfits().find((o) => o.outfitId === id) ?? null;
  }

  outfitThumbUrl(outfitId: number) {
    return this.outfitAssets.textureUrl(outfitId);
  }

  selectOutfit(outfitId: number) {
    this.state.selectOutfit(outfitId);
  }

  setDraftColor(slot: 'head' | 'primary' | 'secondary' | 'detail', index: number) {
    this.state.setDraftColor(slot, index);
  }

  setDraftAddon(mask: number) {
    this.state.setDraftAddonMask(mask);
  }

  hasAddon(mask: number, bit: number): boolean {
    return (mask & bit) !== 0;
  }

  toggleAddon(bit: number) {
    const d = this.state.appearanceDraft();
    if (!d) return;
    this.state.setDraftAddonMask(d.addonMask ^ bit);
  }

  exit() {
    void this.router.navigate(['/characters']);
  }
}

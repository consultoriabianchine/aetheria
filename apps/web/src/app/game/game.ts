import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Phaser from 'phaser';
import type { CharacterEquipment, CharacterSkills, ItemDefinition, ItemStack } from '@aetheria/types';
import { APPEARANCE_PALETTE, LOOT_POUCH_EXPANSION, SKILL_PROGRESSION_CONFIG } from '@aetheria/config';
import { WsService } from '../core/ws.service';
import { ChatLine, GameState } from './game-state';
import { ItemCatalogService } from './item-catalog.service';
import { CreatureAssetService } from './creature-asset.service';
import { OutfitAssetService } from './outfit-asset.service';
import { OutfitThumb } from './outfit-thumb';
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
  imports: [FormsModule, OutfitThumb],
  templateUrl: './game.html',
  styleUrl: './game.scss',
})
export class Game implements OnInit, AfterViewInit, OnDestroy {
  readonly state = inject(GameState);
  readonly chatInput = signal('');
  readonly invOpen = signal(false);
  readonly statusOpen = signal(false);
  readonly leftCollapsed = signal(false);
  readonly rightCollapsed = signal(false);
  readonly boostsCollapsed = signal(true);
  readonly analyzerCollapsed = signal(false);
  readonly damageCollapsed = signal(false);
  readonly damageTakenCollapsed = signal(true);
  readonly chatCollapsed = signal(false);
  readonly chatTab = signal<'general' | 'combat' | 'system'>('general');
  readonly hotbarPreset = signal<'hunt' | 'boss' | 'helper'>('hunt');
  readonly hoveredItemId = signal<string | null>(null);
  readonly itemTooltipX = signal(0);
  readonly itemTooltipY = signal(0);
  readonly colorSlots = ['head', 'primary', 'secondary', 'detail'] as const;
  readonly palette = APPEARANCE_PALETTE;

  private readonly el = inject(ElementRef);
  private readonly ws = inject(WsService);
  private readonly itemCatalog = inject(ItemCatalogService);
  private readonly creatureAssets = inject(CreatureAssetService);
  private readonly outfitAssets = inject(OutfitAssetService);
  private readonly router = inject(Router);
  private phaser: Phaser.Game | null = null;

  ngOnInit() {
    if (!this.state.token()) {
      void this.router.navigate(['/login']);
      return;
    }
    if (!this.ws.connected) this.ws.connect();
    void this.itemCatalog.ensureLoaded();
    if (!this.state.inGame()) {
      void this.router.navigate(['/characters']);
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
    const dpr = window.devicePixelRatio || 1;
    if (dpr <= 1) return;
    const apply = () => {
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
    const needed = s.level * 100;
    return needed > 0 ? (s.experience / needed) * 100 : 0;
  }

  zoomPct(): string {
    return `${Math.round(this.state.zoom() * 100)}%`;
  }

  inventory(): InvEntry[] {
    const slots = this.state.inventory().slots;
    return slots.map((stack, index) => ({ index, stack }));
  }

  backpackPreview(): InvEntry[] {
    return this.fixedSlots(this.state.inventory().slots.slice(0, 8), 8);
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
    const eq: CharacterEquipment = this.state.inventory().equipment;
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
  }

  moveItemTooltip(event: MouseEvent) {
    this.itemTooltipX.set(event.clientX + 10);
    this.itemTooltipY.set(event.clientY + 10);
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
      { label: 'XP', value: `${stats.experience}/${stats.level * 100}` },
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

  hotbarSlots(): Array<{ key: number; name: string; cd: string; ready: boolean; groupPct: number }> {
    return [
      { key: 1, name: 'Arc Burst', cd: 'READY', ready: true, groupPct: 100 },
      { key: 2, name: 'Rune Wave', cd: '1.2', ready: false, groupPct: 42 },
      { key: 3, name: 'Storm', cd: 'READY', ready: true, groupPct: 100 },
      { key: 4, name: 'Basic', cd: '2.0', ready: false, groupPct: 12 },
    ];
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

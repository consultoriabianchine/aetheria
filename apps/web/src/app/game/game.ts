import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Subscription, first, interval } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Phaser from 'phaser';
import type { CharacterEquipment, CharacterSkills, CharacterSummary, CombatAbilityDefinition, CombatStatsView, DamageType, ItemDefinition, ItemStack, PlayerCombatConfig } from '@aetheria/types';
import { DAMAGE_TYPES } from '@aetheria/types';
import { ABYSS_META_NODES, APPEARANCE_PALETTE, INVENTORY_SIZE, LOOT_POUCH_EXPANSION, SKILL_PROGRESSION_CONFIG, xpForLevel } from '@aetheria/config';
import { WsService } from '../core/ws.service';
import { ChatLine, GameState } from './game-state';
import { ItemCatalogService } from './item-catalog.service';
import { CreatureAssetService } from './creature-asset.service';
import { OutfitAssetService } from './outfit-asset.service';
import { OutfitThumb } from './outfit-thumb';
import { HuntBrowser } from './hunt/hunt-browser';
import { HuntBrowserState } from './hunt/hunt-browser-state';
import { WorldScene } from './scenes/world-scene';

const HELPER_POTIONS = [
  ['health-potion', 'Health Potion', 0, 'HP 150–200', 50], ['strong-health-potion', 'Strong Health Potion', 50, 'HP 300', 115], ['great-health-potion', 'Great Health Potion', 80, 'HP 500', 225], ['ultimate-health-potion', 'Ultimate Health Potion', 130, 'HP 750', 379], ['supreme-health-potion', 'Supreme Health Potion', 200, 'HP 900', 650],
  ['mana-potion', 'Mana Potion', 0, 'MP 75–125', 56], ['strong-mana-potion', 'Strong Mana Potion', 50, 'MP 115–185', 108], ['great-mana-potion', 'Great Mana Potion', 80, 'MP 150–250', 158], ['superior-mana-potion', 'Superior Mana Potion', 100, 'MP 240–360', 254], ['ultimate-mana-potion', 'Ultimate Mana Potion', 130, 'MP 425–575', 488], ['distilled-superior-mana-potion', 'Distilled Superior Mana Potion', 130, 'MP 240–360', 381], ['distilled-ultimate-mana-potion', 'Distilled Ultimate Mana Potion', 200, 'MP 425–575', 732],
  ['great-spirit-potion', 'Great Spirit Potion', 80, 'HP 300 + MP 100–200', 254], ['ultimate-spirit-potion', 'Ultimate Spirit Potion', 130, 'HP 500 + MP 150–250', 488],
] as const;

interface InvEntry {
  index: number;
  stack: ItemStack | null;
}

interface EqEntry {
  slot: keyof CharacterEquipment;
  label: string;
  stack: ItemStack | null;
}

const ABYSS_TREE = [
  { name: 'Ofensiva', icon: 'OF', nodes: [
    { id: 'offense.damage', name: '+3% Attack', description: 'Aumenta o dano dos ataques.' },
    { id: 'offense.critical', name: '+3% Critical', description: 'Aumenta a chance de acerto crítico.' },
    { id: 'offense.rare', name: 'Raridades', description: 'Libera upgrades Raros.' },
    { id: 'offense.choice4', name: 'Quarta opção', description: 'Libera uma quarta escolha no level up.' },
  ]},
  { name: 'Defensiva', icon: 'DF', nodes: [
    { id: 'defense.hp', name: '+3% HP', description: 'Aumenta a vida máxima.' },
    { id: 'defense.armor', name: '+3% Armor', description: 'Aumenta a armadura.' },
    { id: 'defense.revive', name: '1 Revive', description: 'Começa a run com uma ressurreição.' },
    { id: 'defense.shrine', name: 'Healing Shrine', description: 'Libera santuários de cura.' },
  ]},
  { name: 'Arcano', icon: 'AR', nodes: [
    { id: 'arcane.power', name: '+3% Magic Power', description: 'Aumenta o poder mágico.' },
    { id: 'arcane.elemental', name: '+5% Elemental Damage', description: 'Aumenta o dano elemental.' },
    { id: 'arcane.evolutions', name: 'Evoluções elementais', description: 'Libera evoluções elementais.' },
    { id: 'arcane.element', name: 'Escolha de elemento', description: 'Começa com uma escolha de elemento.' },
  ]},
  { name: 'Fortuna', icon: 'FT', nodes: [
    { id: 'fortune.gold', name: '+5% Gold', description: 'Aumenta o ouro obtido.' },
    { id: 'fortune.drop', name: '+5% Drop', description: 'Aumenta a chance de drop.' },
    { id: 'fortune.eliteChest', name: 'Elite Chest', description: 'Aumenta a chance de Elite Chest.' },
    { id: 'fortune.reroll', name: 'Reroll grátis', description: 'Garante um reroll grátis por run.' },
  ]},
] as const;

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
  readonly abyssEntryOpen = signal(false);
  readonly abyssTreeOpen = signal(false);
  readonly helperOpen = signal(false);
  readonly helperSection = signal<'healing' | 'ally' | 'attack' | 'spells'>('spells');
  readonly rotationCharacterId = signal<string | null>(null);
  readonly rotationMode = signal<'attack' | 'healing'>('attack');
  readonly healingThreshold = signal(80);
  readonly manaThreshold = signal(50);
  readonly healTarget = signal<'self' | 'lowest_party_member' | 'specific_party_role'>('self');
  readonly potionCategory = signal<'all' | 'hp' | 'mp' | 'hp_mp'>('all');
  readonly rotationSlot = signal(1);
  readonly abilitySearch = signal('');
  readonly abilityCategory = signal<'all' | 'attack' | 'area' | 'rune' | 'heal'>('all');
  readonly releasedOnly = signal(false);
  readonly manageOpen = signal(false);
  readonly manageMemberId = signal<string | null>(null);
  readonly manageInventoryTab = signal<'backpack' | 'loot' | 'store'>('backpack');
  readonly selectedCharacterId = signal<string | null>(null);
  readonly now = signal(Date.now());
  readonly hoveredItemId = signal<string | null>(null);
  readonly itemTooltipX = signal(0);
  readonly itemTooltipY = signal(0);
  readonly itemContextMenu = signal<{ x: number; y: number; itemIndex: number } | null>(null);
  readonly colorSlots = ['head', 'primary', 'secondary', 'detail'] as const;
  readonly appearanceSearch = signal('');
  readonly activeColorSlot = signal<(typeof this.colorSlots)[number]>('head');
  readonly palette = APPEARANCE_PALETTE;
  readonly backpackSize = INVENTORY_SIZE;
  readonly abyssTree = ABYSS_TREE;
  readonly abyssShopBranch = signal('Ofensiva');
  readonly abyssChoicePosition = signal<{ x: number; y: number } | null>(null);
  readonly abyssTreePosition = signal<{ x: number; y: number } | null>(null);

  private readonly el = inject(ElementRef);
  private readonly ws = inject(WsService);
  private readonly itemCatalog = inject(ItemCatalogService);
  private readonly creatureAssets = inject(CreatureAssetService);
  private readonly outfitAssets = inject(OutfitAssetService);
  private readonly huntBrowser = inject(HuntBrowserState);
  private readonly router = inject(Router);
  private phaser: Phaser.Game | null = null;
  private timerSub?: Subscription;
  private abyssChoiceDrag: { startX: number; startY: number; originX: number; originY: number } | null = null;
  private abyssTreeDrag: { startX: number; startY: number; originX: number; originY: number } | null = null;
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
    const s = this.selectedResources();
    return s.maxHealth > 0 ? (s.health / s.maxHealth) * 100 : 0;
  }

  mpPct(): number {
    const s = this.selectedResources();
    return s.maxMana > 0 ? (s.mana / s.maxMana) * 100 : 0;
  }

  xpPct(): number {
    const s = this.selectedResources();
    const needed = xpForLevel(s.level);
    return needed > 0 ? (s.experience / needed) * 100 : 0;
  }

  xpNeeded(): number {
    return xpForLevel(this.selectedResources().level);
  }

  zoomPct(): string {
    return `${Math.round(this.state.zoom() * 100)}%`;
  }

  inventory(): InvEntry[] {
    const slots = this.state.inventory().slots;
    return slots.map((stack, index) => ({ index, stack }));
  }

  abyssElapsed(): string {
    const run = this.state.abyss();
    if (!run) return '00:00';
    const seconds = Math.floor(Math.min(run.durationMs, this.now() - run.startedAt) / 1000);
    return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  abyssTimePct(): number {
    const run = this.state.abyss();
    return run ? Math.min(100, (Math.max(0, this.now() - run.startedAt) / run.durationMs) * 100) : 0;
  }

  abyssXpPct(): number {
    const run = this.state.abyss();
    return run ? Math.min(100, (run.experience / Math.max(1, run.nextLevelExperience)) * 100) : 0;
  }

  abyssAbility(abilityId: number): CombatAbilityDefinition | undefined {
    return this.state.abilities().find((ability) => ability.abilityId === abilityId);
  }

  abyssAbilityName(abilityId: number): string {
    return this.abyssAbility(abilityId)?.name ?? `Magia ${abilityId}`;
  }

  abyssAbilityIcon(abilityId: number): string | null {
    const ability = this.abyssAbility(abilityId);
    return ability ? this.abilityIcon(ability) : null;
  }

  abyssAbilityCooldown(abilityId: number): string {
    const remaining = Math.max(0, this.state.abilityReadyFor(this.state.self()?.id ?? '', abilityId) - this.now());
    return remaining > 0 ? `${(remaining / 1000).toFixed(1)}s` : 'Pronta';
  }

  startAbyss() {
    this.state.requestAbyssMeta();
    this.abyssEntryOpen.set(true);
  }

  beginAbyss() {
    this.abyssEntryOpen.set(false);
    this.state.startAbyss();
  }

  openAbyssTree() {
    this.abyssEntryOpen.set(false);
    this.abyssTreeOpen.set(true);
    this.abyssShopBranch.set('Ofensiva');
    this.state.requestAbyssMeta();
  }

  abyssShopNodes() {
    return this.abyssTree.find((branch) => branch.name === this.abyssShopBranch())?.nodes ?? [];
  }

  abyssShopBranchIcon() {
    return this.abyssTree.find((branch) => branch.name === this.abyssShopBranch())?.icon ?? 'AB';
  }

  abyssNodeUnlocked(id: string): boolean {
    return this.state.abyssMeta()?.unlockedNodes?.includes(id) ?? false;
  }

  abyssNodeCanBuy(id: string): boolean {
    return !this.abyssNodeUnlocked(id) && this.abyssNodeAvailable(id);
  }

  abyssNodeStatus(id: string): string {
    if (this.abyssNodeUnlocked(id)) return 'Desbloqueado';
    const node = ABYSS_META_NODES.find((entry) => entry.id === id);
    if (node?.prerequisite && !this.abyssNodeUnlocked(node.prerequisite)) return 'Requer outro item';
    if ((this.state.abyssMeta()?.fragments ?? 0) < (node?.cost ?? 0)) return 'Fragmentos insuficientes';
    return 'Comprar';
  }

  abyssNodeCost(id: string): number {
    return ABYSS_META_NODES.find((node) => node.id === id)?.cost ?? 0;
  }

  abyssNodePrerequisite(id: string): string | undefined {
    return ABYSS_META_NODES.find((node) => node.id === id)?.prerequisite;
  }

  abyssNodeAvailable(id: string): boolean {
    const meta = this.state.abyssMeta();
    const node = ABYSS_META_NODES.find((entry) => entry.id === id);
    return !!meta && !!node && meta.fragments >= node.cost && (!node.prerequisite || meta.unlockedNodes.includes(node.prerequisite));
  }

  closeAbyssPanels() {
    this.abyssEntryOpen.set(false);
    this.abyssTreeOpen.set(false);
    this.abyssTreePosition.set(null);
  }

  chooseAbyssUpgrade(choiceId: string) {
    this.abyssChoicePosition.set(null);
    this.state.chooseAbyssUpgrade(choiceId);
  }

  abyssChoiceTransform(): string {
    const position = this.abyssChoicePosition();
    return position ? `translate(${position.x}px, ${position.y}px)` : 'translate(0, 0)';
  }

  startAbyssChoiceDrag(event: PointerEvent) {
    event.preventDefault();
    const position = this.abyssChoicePosition() ?? { x: 0, y: 0 };
    this.abyssChoiceDrag = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
  }

  @HostListener('document:pointermove', ['$event'])
  moveAbyssChoiceDrag(event: PointerEvent) {
    if (!this.abyssChoiceDrag) return;
    const card = this.el.nativeElement.querySelector('.abyss-choice-card') as HTMLElement | null;
    if (!card) return;
    const maxX = Math.max(0, (window.innerWidth - card.offsetWidth) / 2 - 12);
    const maxY = Math.max(0, (window.innerHeight - card.offsetHeight) / 2 - 12);
    const x = this.abyssChoiceDrag.originX + event.clientX - this.abyssChoiceDrag.startX;
    const y = this.abyssChoiceDrag.originY + event.clientY - this.abyssChoiceDrag.startY;
    this.abyssChoicePosition.set({ x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) });
  }

  @HostListener('document:pointerup')
  endAbyssChoiceDrag() {
    this.abyssChoiceDrag = null;
  }

  abyssTreeTransform(): string {
    const position = this.abyssTreePosition();
    return position ? `translate(${position.x}px, ${position.y}px)` : 'translate(0, 0)';
  }

  startAbyssTreeDrag(event: PointerEvent) {
    event.preventDefault();
    const position = this.abyssTreePosition() ?? { x: 0, y: 0 };
    this.abyssTreeDrag = { startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y };
  }

  @HostListener('document:pointermove', ['$event'])
  moveAbyssTreeDrag(event: PointerEvent) {
    if (!this.abyssTreeDrag) return;
    const modal = this.el.nativeElement.querySelector('.abyss-shop-modal') as HTMLElement | null;
    if (!modal) return;
    const maxX = Math.max(0, (window.innerWidth - modal.offsetWidth) / 2 - 12);
    const maxY = Math.max(0, (window.innerHeight - modal.offsetHeight) / 2 - 12);
    const x = this.abyssTreeDrag.originX + event.clientX - this.abyssTreeDrag.startX;
    const y = this.abyssTreeDrag.originY + event.clientY - this.abyssTreeDrag.startY;
    this.abyssTreePosition.set({ x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) });
  }

  @HostListener('document:pointerup')
  endAbyssTreeDrag() {
    this.abyssTreeDrag = null;
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
    const character = this.state.characters().find((c) => c.id === memberId);
    const eq: CharacterEquipment = member?.equipment ?? character?.equipment ?? this.state.inventory().equipment;
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
    if (/^https?:\/\//.test(def.image) || def.image.startsWith('/')) return def.image;
    if (def.image.startsWith('assets/')) return `/${def.image}`;
    return `/assets/items/${def.image}`;
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
    if (item.attack > 0) {
      if (this.isArmorItem(item)) lines.push(`Armor: ${item.attack}`);
      else if (this.isOffensiveItem(item)) lines.push(`Attack: ${item.attack}`);
    }
    if (item.defense > 0 && this.isDefensiveItem(item)) lines.push(`Defense: ${item.defense}`);
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

  private isArmorItem(item: ItemDefinition): boolean {
    return item.type === 'helmet' || item.type === 'armor' || item.type === 'legs' || item.type === 'boots';
  }

  private isOffensiveItem(item: ItemDefinition): boolean {
    return item.type === 'weapon' || item.type === 'ammo' || !!item.weapon || !!item.ammo;
  }

  private isDefensiveItem(item: ItemDefinition): boolean {
    return this.isArmorItem(item) || item.type === 'offhand' || item.type === 'ring' || item.type === 'necklace' || item.type === 'relic';
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
    const skills: CharacterSkills = this.selectedSummary()?.skills ?? { melee: 10, distance: 10, magic: 10 };
    const progress = this.selectedId() === this.state.self()?.id
      ? new Map((this.state.stats().skillProgress ?? []).map((p) => [p.skillType, p]))
      : new Map((this.selectedSummary()?.skillProgress ?? []).map((p) => [p.skillType, p]));
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
    const archetype = this.selectedSummary()?.archetype;
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

  private static readonly DAMAGE_TYPE_LABELS: Record<DamageType, string> = {
    physical: 'Físico',
    fire: 'Fogo',
    ice: 'Gelo',
    energy: 'Raio',
    earth: 'Terra',
    holy: 'Sagrado',
    death: 'Morte',
    arcane: 'Arcano',
  };

  damageTypeLabel(type: DamageType): string {
    return Game.DAMAGE_TYPE_LABELS[type] ?? type;
  }

  /** Personagem selecionado no painel esquerdo (default: ativo). */
  selectedId(): string {
    return this.selectedCharacterId() ?? this.state.self()?.id ?? '';
  }

  selectedName(): string {
    const id = this.selectedId();
    return this.state.party().members.find((m) => m.id === id)?.name ?? this.state.self()?.name ?? '—';
  }

  selectCharacter(id: string) {
    this.selectedCharacterId.set(id);
  }

  selectableCharacters(): Array<{ id: string; name: string }> {
    const members = this.state.party().members;
    const self = this.state.self();
    const entries = self ? [{ id: self.id, name: self.name }] : [];
    return entries.concat(
      members.filter((member) => member.id !== self?.id).map((member) => ({ id: member.id, name: member.name })),
    );
  }

  helperCharacter(id: string): CharacterSummary | null {
    const self = this.state.self();
    return (self?.id === id ? self : null) ?? this.state.party().members.find((member) => member.id === id) ?? null;
  }

  /** Summary do personagem selecionado (ativo ou companheiro da party). */
  selectedSummary(): CharacterSummary | null {
    const self = this.state.self();
    if (!self) return null;
    const id = this.selectedId();
    if (id === self.id) return self;
    return this.state.party().members.find((m) => m.id === id) ?? self;
  }

  /** Vida/mana/XP do personagem selecionado (ativo usa stats ao vivo). */
  selectedResources(): { health: number; maxHealth: number; mana: number; maxMana: number; level: number; experience: number } {
    const self = this.state.self();
    const id = this.selectedId();
    if (!self || id === self.id) {
      const s = this.state.stats();
      return { health: s.health, maxHealth: s.maxHealth, mana: s.mana, maxMana: s.maxMana, level: s.level, experience: s.experience };
    }
    const m = this.state.party().members.find((m) => m.id === id);
    return {
      health: m?.health ?? 0,
      maxHealth: m?.maxHealth ?? 0,
      mana: m?.mana ?? 0,
      maxMana: m?.maxMana ?? 0,
      level: m?.level ?? 1,
      experience: m?.experience ?? 0,
    };
  }

  selectedCombatStats(): CombatStatsView | null {
    const id = this.selectedId();
    return this.state.combatStats()[id] ?? null;
  }

  damageRows(): Array<{ type: DamageType; label: string; bonus: number; resistance: number }> {
    const stats = this.selectedCombatStats();
    return DAMAGE_TYPES.map((type) => ({
      type,
      label: this.damageTypeLabel(type),
      bonus: stats?.damageBonuses?.[type] ?? 0,
      resistance: stats?.resistances?.[type] ?? 0,
    }));
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
    const archetype = this.selectedSummary()?.archetype;
    return archetype ? labels[archetype] ?? archetype : '—';
  }

  archetypeLabelFor(archetype: CharacterSummary['archetype']): string {
    const labels: Record<CharacterSummary['archetype'], string> = { warrior: 'Guerreiro', mage: 'Mago', archer: 'Arqueiro' };
    return labels[archetype] ?? archetype;
  }

  currentHuntName(): string {
    return this.state.hunt()?.huntName ?? 'Nenhuma hunt ativa';
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
    return { abilityId: ability?.abilityId, name: ability?.name ?? 'Cura', icon: ability ? this.abilityIcon(ability) ?? undefined : undefined };
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
  private draggedEquipment: { characterId: string; slot: keyof CharacterEquipment } | null = null;
  private inventoryActionAt = new Map<string, number>();
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
    if (this.draggedEquipment) {
      const equipment = this.draggedEquipment;
      this.draggedEquipment = null;
      if (container === 'backpack') this.onUnequipFor(equipment.characterId, equipment.slot);
      return;
    }
    if (!source || (source.container === container && source.index === index)) return;
    this.state.moveInventory(source.container, source.index, container, index);
  }
  onItemDragEnd() {
    this.hideItemTooltip();
    this.draggedItem = null;
    this.draggedEquipment = null;
  }

  onEquipmentDragStart(event: DragEvent, characterId: string, slot: keyof CharacterEquipment) {
    this.hideItemTooltip();
    this.draggedEquipment = { characterId, slot };
    this.draggedItem = null;
    event.dataTransfer?.setData('text/plain', `equipment:${characterId}:${slot}`);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  onEquipmentDrop(event: DragEvent, characterId: string, slot: keyof CharacterEquipment) {
    event.preventDefault();
    this.hideItemTooltip();
    const source = this.draggedItem;
    this.draggedItem = null;
    this.draggedEquipment = null;
    if (!source || source.container !== 'backpack') return;
    const item = this.backpackPreview()[source.index]?.stack;
    if (!item) return;
    const target = this.itemCatalog.get(item.itemId);
    if (target?.slot !== slot) return;
    this.onEquipFor(characterId, source.index);
  }

  hotbarMemberName(characterId: string): string {
    return this.state.party().members.find((m) => m.id === characterId)?.name ?? this.state.self()?.name ?? 'Personagem';
  }

  onHuntSelect(huntId: string) {
    if (!huntId) return;
    this.startHunt(huntId);
  }

  percent(value: number): string {
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
  manageMember(): CharacterSummary | null {
    const id = this.manageMemberId();
    const self = this.state.self();
    return (self?.id === id ? self : null)
      ?? this.state.party().members.find((member) => member.id === id)
      ?? this.state.characters().find((character) => character.id === id)
      ?? self
      ?? this.state.party().members[0]
      ?? this.state.characters()[0]
      ?? null;
  }
  combatFor(memberId: string): PlayerCombatConfig {
    return this.state.combatFor(memberId);
  }
  onManageTargeting(memberId: string, value: string) {
    const c = this.combatFor(memberId);
    this.state.setCombatConfig(memberId, value as PlayerCombatConfig['targeting'], c.movement, c.attackRange, c.frontPositioning);
  }
  onManageMovement(memberId: string, value: string) {
    const c = this.combatFor(memberId);
    this.state.setCombatConfig(memberId, c.targeting, value as PlayerCombatConfig['movement'], c.attackRange, c.frontPositioning);
  }
  onManageAttackRange(memberId: string, value: number | null) {
    const c = this.combatFor(memberId);
    this.state.setCombatConfig(memberId, c.targeting, c.movement, value ?? undefined, c.frontPositioning);
  }
  onManageFrontPositioning(memberId: string, enabled: boolean) {
    const c = this.combatFor(memberId);
    this.state.setCombatConfig(memberId, c.targeting, c.movement, c.attackRange, enabled);
  }
  private allowInventoryAction(memberId: string, action: string): boolean {
    const key = `${memberId}:${action}`;
    const now = Date.now();
    if (now - (this.inventoryActionAt.get(key) ?? 0) < 500) return false;
    this.inventoryActionAt.set(key, now);
    return true;
  }
  onEquipFor(memberId: string, index: number) {
    if (this.allowInventoryAction(memberId, `equip:${index}`)) this.state.equip(index, memberId);
  }
  onUnequipFor(memberId: string, slot: string) {
    if (this.allowInventoryAction(memberId, `unequip:${slot}`)) this.state.unequip(slot, memberId);
  }

  // ---- rotação ----
  openRotationFor(characterId: string) { this.openHelperFor(characterId, 'spells'); }
  rotationCharacterName(): string { return this.rotationCharacterId() ? this.hotbarMemberName(this.rotationCharacterId()!) : ''; }
  attackRotationForModal(): number[] { return this.attackRotationFor(this.rotationCharacterId() ?? ''); }
  healingRotationForModal(): number[] { return this.healingRotationFor(this.rotationCharacterId() ?? ''); }
  healingPotionFor(index: number): string | undefined { return this.state.healingPotionRotations()[this.rotationCharacterId() ?? '']?.[index]; }
  healingSlotType(index: number): 'spell' | 'mp' | 'hp' { return index === 0 ? 'spell' : index === 1 ? 'mp' : 'hp'; }
  helperPotionOptions() {
    const category = this.potionCategory();
    return HELPER_POTIONS.filter(([id]) => category === 'all' || category === 'hp' && id.includes('health') || category === 'mp' && id.includes('mana') || category === 'hp_mp' && id.includes('spirit'));
  }
  healingSlotName(index: number) { const potion = this.healingPotionFor(index); return potion ? HELPER_POTIONS.find((item) => item[0] === potion)?.[1] ?? potion : this.rotationAbilityName(this.healingRotationForModal()[index] ?? 0); }
  healingSlotIcon(index: number) { const potion = this.healingPotionFor(index); return potion ? this.iconFor(potion) : this.rotationAbilityIcon(this.healingRotationForModal()[index] ?? 0); }
  helperSlotIcon(index: number, abilityId: number) { return this.helperSection() === 'healing' ? this.healingSlotIcon(index) : this.rotationAbilityIcon(abilityId); }
  openHelper(section: 'healing' | 'ally' | 'attack' | 'spells' = 'spells') {
    this.openHelperFor(this.state.self()?.id ?? this.state.party().members[0]?.id ?? null, section);
  }
  openHelperFor(characterId: string | null, section: 'healing' | 'ally' | 'attack' | 'spells' = 'spells') {
    this.helperSection.set(section);
    this.rotationCharacterId.set(characterId);
    this.helperOpen.set(true);
  }
  closeHelper() { this.helperOpen.set(false); this.rotationOpen.set(false); }
  @HostListener('document:keydown.escape')
  onEscape() { if (this.rotationOpen()) this.rotationOpen.set(false); else if (this.helperOpen()) this.closeHelper(); }
  openRotationSlot(index: number, mode: 'attack' | 'healing') {
    this.rotationSlot.set(index + 1);
    this.rotationMode.set(mode);
    this.abilityCategory.set('all');
    this.abilitySearch.set('');
    this.releasedOnly.set(false);
    this.potionCategory.set(mode === 'healing' && index === 1 ? 'mp' : 'hp');
    this.healingThreshold.set(80);
    this.manaThreshold.set(50);
    if (mode === 'healing') {
      const trigger = this.state.healingTriggers()[this.rotationCharacterId() ?? '']?.[index];
      if (trigger) {
        this.healingThreshold.set(trigger.hpBelowPercent);
        this.manaThreshold.set(trigger.mpBelowPercent ?? 50);
        this.healTarget.set(trigger.target);
      }
    }
    this.rotationOpen.set(true);
  }
  areaMinTargets(characterId: string, index: number): number {
    return this.state.attackMinTargets()[characterId]?.[index] ?? 0;
  }
  setAreaMinTargets(index: number, value: number) {
    const id = this.rotationCharacterId();
    if (!id) return;
    const slots = [...(this.state.attackMinTargets()[id] ?? [0, 0, 0, 0])];
    slots[index] = value;
    this.state.attackMinTargets.update((all) => ({ ...all, [id]: slots }));
  }
  filteredAbilities(): CombatAbilityDefinition[] {
    const id = this.rotationCharacterId() ?? '';
    const query = this.abilitySearch().trim().toLowerCase();
    return this.abilitiesFor(id).filter((ability) => {
      const category = this.abilityCategory();
      const matchesCategory = category === 'all' || ability.category === category || (category === 'area' && ability.targetMode === 'area_enemy');
      const matchesMode = this.rotationMode() === 'attack' ? ability.category !== 'heal' : ability.category === 'heal';
      const matchesSearch = !query || `${ability.name} ${ability.slug}`.toLowerCase().includes(query);
      const released = !this.releasedOnly() || ability.enabled;
      return matchesCategory && matchesMode && matchesSearch && released;
    });
  }
  abilityIcon(ability: CombatAbilityDefinition): string | null {
    if (!ability.icon) return `/assets/abilities/${ability.abilityId}.png`;
    if (/^(data:image\/|https?:\/\/)/.test(ability.icon)) return ability.icon;
    if (ability.icon.startsWith('/')) return ability.icon;
    if (ability.icon.startsWith('assets/')) return `/${ability.icon}`;
    return ability.icon.startsWith('abilities/') ? `/assets/${ability.icon}` : `/assets/abilities/${ability.icon}`;
  }
  abilityMeta(ability: CombatAbilityDefinition): string {
    const level = ability.levelRequirement ?? 1;
    const mana = ability.manaCost ?? 0;
    return `lvl ${level} · ${mana} mana · cd ${Math.round(ability.cooldownMs / 100) / 10}s · ${ability.category === 'area' ? 'Área' : ability.category === 'rune' ? 'Runa' : ability.category === 'heal' ? 'Cura' : 'Ataque'}`;
  }
  slotAbilityId(): number {
    const id = this.rotationCharacterId() ?? '';
    const slots = this.rotationMode() === 'attack' ? this.attackRotationFor(id) : this.healingRotationFor(id);
    return slots[this.rotationSlot() - 1] ?? 0;
  }
  setRotationAbility(index: number, abilityId: number) {
    const id = this.rotationCharacterId();
    if (!id) return;
    if (this.rotationMode() === 'healing' && index !== 0) return;
    const target = this.rotationMode() === 'attack' ? this.state.attackRotations : this.state.healingRotations;
    target.update((all) => ({ ...all, [id]: (all[id] ?? [0, 0, 0, 0]).map((value, i) => (i === index ? abilityId : value)) }));
    if (this.rotationMode() === 'attack') this.setAreaMinTargets(index, 0);
    else this.state.healingPotionRotations.update((all) => ({ ...all, [id]: (all[id] ?? [undefined, undefined, undefined, undefined]).map((value, i) => (i === index ? undefined : value)) }));
  }
  setHealingPotion(index: number, potionId: string) {
    const id = this.rotationCharacterId();
    if (!id) return;
    if (this.healingSlotType(index) === 'spell') return;
    this.state.healingPotionRotations.update((all) => ({ ...all, [id]: (all[id] ?? [undefined, undefined, undefined, undefined]).map((value, i) => (i === index ? potionId : value)) }));
    this.state.healingRotations.update((all) => ({ ...all, [id]: (all[id] ?? [0, 0, 0, 0]).map((value, i) => (i === index ? 0 : value)) }));
  }
  rotationAbilityName(id: number) { return this.state.abilities().find((ability) => ability.abilityId === id)?.name ?? 'Empty'; }
  rotationAbilityIcon(id: number) { const ability = this.state.abilities().find((item) => item.abilityId === id); return ability ? this.abilityIcon(ability) : null; }
  rotationAbility(id: number): CombatAbilityDefinition | undefined { return this.state.abilities().find((ability) => ability.abilityId === id); }
  saveRotation() {
    const characterId = this.rotationCharacterId();
    if (!characterId) return;
    if (this.rotationMode() === 'attack') {
      const mins = this.state.attackMinTargets()[characterId] ?? [0, 0, 0, 0];
      const slots = this.attackRotationForModal().map((abilityId, index) => ({ position: (index + 1) as 1 | 2 | 3 | 4, abilityId: abilityId || undefined, enabled: abilityId > 0, minTargets: mins[index] || undefined }));
      this.ws.send({ type: 'rotation.attack.set', preset: 'HUNT', characterId, slots });
    } else {
        const slots = this.healingRotationForModal().slice(0, 3).map((abilityId, index) => ({ position: (index + 1) as 1 | 2 | 3, abilityId: this.healingSlotType(index) === 'spell' ? abilityId || undefined : undefined, enabled: abilityId > 0 || !!this.healingPotionFor(index), trigger: { target: this.healTarget(), hpBelowPercent: this.healingThreshold(), mpBelowPercent: this.manaThreshold(), potionId: this.healingSlotType(index) === 'spell' ? undefined : this.healingPotionFor(index) } }));
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

  filteredAppearanceOutfits() {
    const query = this.appearanceSearch().trim().toLowerCase();
    return this.state.availableOutfits().filter((outfit) => !query || outfit.name.toLowerCase().includes(query));
  }

  setActiveColorSlot(slot: (typeof this.colorSlots)[number]) {
    this.activeColorSlot.set(slot);
  }

  randomizeAppearanceColors() {
    const count = this.palette.length;
    for (const slot of this.colorSlots) this.state.setDraftColor(slot, Math.floor(Math.random() * count));
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

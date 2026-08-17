import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import Phaser from 'phaser';
import type { CharacterEquipment, ItemStack } from '@aetheria/types';
import { WsService } from '../core/ws.service';
import { GameState } from './game-state';
import { ItemCatalogService } from './item-catalog.service';
import { CreatureAssetService } from './creature-asset.service';
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
  imports: [FormsModule],
  templateUrl: './game.html',
  styleUrl: './game.scss',
})
export class Game implements OnInit, AfterViewInit, OnDestroy {
  readonly state = inject(GameState);
  readonly chatInput = signal('');
  readonly invOpen = signal(false);

  private readonly el = inject(ElementRef);
  private readonly ws = inject(WsService);
  private readonly itemCatalog = inject(ItemCatalogService);
  private readonly creatureAssets = inject(CreatureAssetService);
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
    this.phaser.scene.add('World', WorldScene, false);
    this.phaser.scene.start('World', { ws: this.ws, state: this.state, assets: this.creatureAssets });
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

  inventory(): InvEntry[] {
    const slots = this.state.inventory().slots;
    return slots.map((stack, index) => ({ index, stack }));
  }

  equipment(): EqEntry[] {
    const eq: CharacterEquipment = this.state.inventory().equipment;
    const labels: Record<string, string> = {
      head: 'Cabeça',
      armor: 'Armadura',
      legs: 'Pernas',
      boots: 'Botas',
      weapon: 'Arma',
      shield: 'Escudo',
      ring: 'Anel',
      amulet: 'Amuleto',
    };
    return (Object.keys(labels) as (keyof CharacterEquipment)[]).map((slot) => ({
      slot,
      label: labels[slot],
      stack: eq[slot] ?? null,
    }));
  }

  iconFor(itemId: string): string | null {
    const def = this.itemCatalog.get(itemId);
    return def?.image ? `assets/items/${def.image}` : null;
  }

  nameFor(itemId: string): string {
    return this.itemCatalog.get(itemId)?.name ?? itemId;
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

  exit() {
    void this.router.navigate(['/characters']);
  }
}
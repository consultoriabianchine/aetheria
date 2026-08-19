import { Injectable, signal } from '@angular/core';
import type { ItemDefinition } from '@aetheria/types';
import { WS_URL } from '../core/ws.service';

@Injectable({ providedIn: 'root' })
export class ItemCatalogService {
  private loaded = false;
  private map = new Map<string, ItemDefinition>(LOCAL_ITEMS.map((item) => [item.id, item]));
  readonly ready = signal(false);

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const res = await fetch(`${WS_URL}/assets/items/catalog`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: ItemDefinition[] };
      for (const item of LOCAL_ITEMS) this.map.set(item.id, item);
      for (const item of data.items) this.map.set(item.id, item);
      this.loaded = true;
      this.ready.set(true);
    } catch {
      await this.loadFallbackAsset();
      this.loaded = true;
      this.ready.set(true);
    }
  }

  private async loadFallbackAsset(): Promise<void> {
    try {
      const res = await fetch('assets/items.json');
      if (!res.ok) return;
      const data = (await res.json()) as { items: ItemDefinition[] };
      for (const item of LOCAL_ITEMS) this.map.set(item.id, item);
      for (const item of data.items) this.map.set(item.id, item);
    } catch {
      // Local starter items remain available even without generated assets.
    }
  }

  get(id: string): ItemDefinition | undefined {
    return this.map.get(id);
  }
}

const LOCAL_ITEMS: ItemDefinition[] = [
  {
    id: 'apprentice-staff',
    name: 'Apprentice Staff',
    type: 'weapon',
    weight: 18,
    stackable: false,
    attack: 12,
    defense: 0,
    image: "Geomancer's_Staff.gif",
    category: 'Staff',
    slot: 'weapon',
    weapon: { itemId: 'apprentice-staff', weaponType: 'staff', attackPower: 0, magicPower: 12, damageType: 'arcane', range: 5 },
  },
  {
    id: 'iron-sword',
    name: 'Iron Sword',
    type: 'weapon',
    weight: 35,
    stackable: false,
    attack: 18,
    defense: 0,
    image: 'Sword.gif',
    category: 'Sword',
    slot: 'weapon',
    weapon: { itemId: 'iron-sword', weaponType: 'sword', attackPower: 18, damageType: 'physical', range: 1 },
  },
  {
    id: 'hunter-bow',
    name: 'Hunter Bow',
    type: 'weapon',
    weight: 31,
    stackable: false,
    attack: 10,
    defense: 0,
    image: 'Bow.gif',
    category: 'Bow',
    slot: 'weapon',
    weapon: { itemId: 'hunter-bow', weaponType: 'bow', attackPower: 10, damageType: 'physical', range: 6, allowedAmmoType: 'arrow' },
  },
  {
    id: 'iron-arrow',
    name: 'Iron Arrow',
    type: 'ammo',
    weight: 0.7,
    stackable: true,
    attack: 8,
    defense: 0,
    image: 'Arrow.gif',
    category: 'Arrow',
    slot: 'ammo',
    ammo: { itemId: 'iron-arrow', ammoType: 'arrow', attackPower: 8, damageType: 'physical' },
  },
];

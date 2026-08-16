import { Injectable, signal } from '@angular/core';
import type { ItemDefinition } from '@aetheria/types';

@Injectable({ providedIn: 'root' })
export class ItemCatalogService {
  private loaded = false;
  private map = new Map<string, ItemDefinition>();
  readonly ready = signal(false);

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const res = await fetch('assets/items.json');
      const data = (await res.json()) as { items: ItemDefinition[] };
      for (const item of data.items) this.map.set(item.id, item);
      this.loaded = true;
      this.ready.set(true);
    } catch {
      this.loaded = true;
      this.ready.set(true);
    }
  }

  get(id: string): ItemDefinition | undefined {
    return this.map.get(id);
  }
}
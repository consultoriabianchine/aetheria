import { Injectable, signal } from '@angular/core';

export interface CreatureSpriteDef {
  slug: string;
  name: string;
  sprite: string;
}

/** Catálogo de sprites de criaturas (assets estáticos), espelhando ItemCatalogService. */
@Injectable({ providedIn: 'root' })
export class CreatureCatalogService {
  private loaded = false;
  private map = new Map<string, CreatureSpriteDef>();
  readonly ready = signal(false);

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const res = await fetch('assets/creatures.json');
      const data = (await res.json()) as { creatures: CreatureSpriteDef[] };
      for (const c of data.creatures) this.map.set(c.slug, c);
      this.loaded = true;
      this.ready.set(true);
    } catch {
      this.loaded = true;
      this.ready.set(true);
    }
  }

  spriteFor(slug: string): string | null {
    return this.map.get(slug)?.sprite ?? null;
  }
}
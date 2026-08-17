import { Injectable } from '@angular/core';
import { WS_URL } from '../core/ws.service';
import type { AnimConfig } from './creature-animator';

/**
 * Busca/cacheia a configuração de animação e a URL da spritesheet de uma
 * criatura a partir dos endpoints públicos do game-server.
 */
@Injectable({ providedIn: 'root' })
export class CreatureAssetService {
  private configs = new Map<number, AnimConfig | null>();
  private pending = new Map<number, Promise<AnimConfig | null>>();

  textureUrl(creatureId: number): string {
    return `${WS_URL}/assets/creatures/${creatureId}`;
  }

  loadConfig(creatureId: number): Promise<AnimConfig | null> {
    if (this.configs.has(creatureId)) return Promise.resolve(this.configs.get(creatureId) ?? null);
    const existing = this.pending.get(creatureId);
    if (existing) return existing;
    const promise = fetch(`${WS_URL}/assets/creatures/${creatureId}/animation`)
      .then((res) => (res.ok ? (res.json() as Promise<AnimConfig>) : null))
      .catch(() => null)
      .then((config) => {
        this.configs.set(creatureId, config);
        this.pending.delete(creatureId);
        return config;
      });
    this.pending.set(creatureId, promise);
    return promise;
  }
}

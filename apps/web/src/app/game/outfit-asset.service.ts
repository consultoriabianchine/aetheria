import { Injectable } from '@angular/core';
import { WS_URL } from '../core/ws.service';
import type { AnimConfig } from './creature-animator';

export interface OutfitAnimData {
  outfitId: number;
  spriteAssetId: number;
  supportsColors: boolean;
  colorMaskAssetId?: number;
  defaultColors?: { head: number; primary: number; secondary: number; detail: number };
  config: AnimConfig;
}

/** Busca a config de animação e a URL do sprite de um outfit. */
@Injectable({ providedIn: 'root' })
export class OutfitAssetService {
  private pending = new Map<number, Promise<OutfitAnimData | null>>();

  textureUrl(outfitId: number): string {
    return `${WS_URL}/assets/outfits/${outfitId}`;
  }

  maskUrl(outfitId: number): string {
    return `${WS_URL}/assets/outfits/${outfitId}/mask`;
  }

  loadConfig(outfitId: number): Promise<OutfitAnimData | null> {
    const existing = this.pending.get(outfitId);
    if (existing) return existing;
    const promise = fetch(`${WS_URL}/assets/outfits/${outfitId}/animation`)
      .then((res) => (res.ok ? (res.json() as Promise<OutfitAnimData>) : null))
      .catch(() => null)
      .then((config) => {
        this.pending.delete(outfitId);
        return config;
      });
    this.pending.set(outfitId, promise);
    return promise;
  }
}

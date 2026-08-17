import { Injectable, signal } from '@angular/core';
import type { CreatureAnimationConfig, CreatureAnimationConfigInput, HuntDefinition } from '@aetheria/types';

export interface AdminCreatureSummary {
  creatureId: number;
  slug: string;
  name: string;
  type: string;
  status: 'complete' | 'partial' | 'none';
  hasSprite: boolean;
  hasAnimation: boolean;
  animationVersion: number | null;
}

export interface CreatureAssetMeta {
  fileName: string;
  mimeType: string;
  fileSize: number;
  imageWidth: number;
  imageHeight: number;
  checksum: string;
}

export interface CreatureDetail extends AdminCreatureSummary {
  animation: CreatureAnimationConfig | null;
  asset: CreatureAssetMeta | null;
}

export interface MapSummary {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface StoredMapTile {
  x: number;
  y: number;
  z: number;
  type: number;
  walkable: boolean;
  blocksVision: boolean;
}

export interface StoredMap {
  id: string;
  name: string;
  width: number;
  height: number;
  tiles: StoredMapTile[];
}

export interface MapTileInput {
  x: number;
  y: number;
  type: number;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  readonly baseUrl = signal(localStorage.getItem('admin.baseUrl') ?? 'http://localhost:4000');
  readonly token = signal(localStorage.getItem('admin.token') ?? 'dev-admin-token');

  setToken(value: string) {
    this.token.set(value);
    localStorage.setItem('admin.token', value);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return { Authorization: `Bearer ${this.token()}`, 'Content-Type': 'application/json', ...extra };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl()}${path}`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return res.json() as Promise<T>;
  }

  listCreatures(): Promise<AdminCreatureSummary[]> {
    return this.request('/admin/creatures', { headers: this.headers() });
  }

  getCreature(id: number): Promise<CreatureDetail> {
    return this.request(`/admin/creatures/${id}`, { headers: this.headers() });
  }

  uploadSpritesheet(id: number, file: File): Promise<{ ok: boolean; asset: CreatureAssetMeta }> {
    return file
      .arrayBuffer()
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
      })
      .then((dataBase64) =>
        this.request(`/admin/creatures/${id}/spritesheet`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'image/png', dataBase64 }),
        }),
      );
  }

  saveAnimation(id: number, config: CreatureAnimationConfigInput, version?: number): Promise<{ ok: boolean; animation: CreatureAnimationConfig }> {
    return this.request(`/admin/creatures/${id}/animation`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ config, version }),
    });
  }

  listMaps(): Promise<MapSummary[]> {
    return this.request('/admin/maps', { headers: this.headers() });
  }

  getMap(id: string): Promise<StoredMap> {
    return this.request(`/admin/maps/${id}`, { headers: this.headers() });
  }

  saveMap(input: { id?: string; name: string; width: number; height: number; tiles: MapTileInput[] }): Promise<MapSummary> {
    return this.request('/admin/maps', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
  }

  deleteMap(id: string): Promise<{ ok: boolean }> {
    return this.request(`/admin/maps/${id}`, { method: 'DELETE', headers: this.headers() });
  }

  listHunts(): Promise<HuntDefinition[]> {
    return this.request('/admin/hunts', { headers: this.headers() });
  }

  getHunt(id: string): Promise<HuntDefinition> {
    return this.request(`/admin/hunts/${id}`, { headers: this.headers() });
  }

  saveHunt(input: Omit<HuntDefinition, 'id'> & { id?: string }): Promise<{ ok: boolean; id: string }> {
    return this.request('/admin/hunts', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
  }

  deleteHunt(id: string): Promise<{ ok: boolean }> {
    return this.request(`/admin/hunts/${id}`, { method: 'DELETE', headers: this.headers() });
  }
}

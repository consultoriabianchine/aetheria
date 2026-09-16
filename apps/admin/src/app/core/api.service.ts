import { Injectable, signal } from '@angular/core';
import type { AmmoType, CombatArchetype, CreatureAnimationConfig, CreatureAnimationConfigInput, DamageType, EquipmentSlot, HuntDefinition, ItemType, ItemVisualEffects, MapData, MapEntity, MapLayerId, MapStatus, OutfitDefinition, TileCategory, TileDefinition, TileLayerType, TilesetDefinition, WeaponType } from '@aetheria/types';

export interface AdminItemDefinition {
  id: string;
  name: string;
  description?: string;
  type: ItemType;
  slot?: EquipmentSlot;
  image: string;
  weight: number;
  stackable: boolean;
  category: string;
  enabled?: boolean;
  combatStats?: {
    attackPower?: number;
    magicPower?: number;
    armor?: number;
    defense?: number;
    maxHp?: number;
    maxMana?: number;
    criticalChance?: number;
    criticalDamage?: number;
    accuracy?: number;
    dodge?: number;
    speed?: number;
  };
  weapon?: { weaponType: WeaponType; range: number; damageType?: DamageType; allowedAmmoType?: AmmoType };
  ammo?: { ammoType: AmmoType; attackPower: number; damageType?: DamageType };
  visual?: ItemVisualEffects;
  specialModifiers?: Record<string, unknown> | null;
  shootTypeId?: number;
  effectTypeId?: number;
}

export interface AdminItemInput {
  id?: string;
  name: string;
  description?: string;
  type: ItemType;
  slot?: EquipmentSlot | null;
  imagePath?: string | null;
  stackable?: boolean;
  weight?: number;
  category?: string;
  attackPower?: number;
  magicPower?: number;
  armor?: number;
  defense?: number;
  maxHp?: number;
  maxMana?: number;
  criticalChance?: number;
  criticalDamage?: number;
  accuracy?: number;
  dodge?: number;
  speed?: number;
  weaponType?: WeaponType | null;
  ammoType?: AmmoType | null;
  damageType?: DamageType | null;
  range?: number;
  allowedAmmoType?: AmmoType | null;
  visual?: ItemVisualEffects | null;
  specialModifiers?: Record<string, unknown> | null;
  shootTypeId?: number | null;
  effectTypeId?: number | null;
  enabled?: boolean;
}

export interface CombatFormulaTestInput {
  archetype: CombatArchetype;
  level: number;
  melee: number;
  distance: number;
  magic: number;
  weaponPower: number;
  staffPower: number;
  ammoPower: number;
  targetLevel: number;
  armor: number;
  defense: number;
  damageType: DamageType;
  resistance: number;
  critical: boolean;
  abilityMultiplier: number;
  flatPower: number;
}

export interface CombatFormulaTestResult {
  ok: boolean;
  reason?: string;
  basePower?: number;
  skill?: string;
  skillLevel?: number;
  damageType?: DamageType;
  rawDamage?: number;
  mitigation?: number;
  normalDamage?: number;
  criticalDamage?: number;
  min?: number;
  average?: number;
  max?: number;
}

export interface AdminCreatureAffinity {
  modifier: number;
  immune: boolean;
}

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

export interface CreatureLootEntry {
  id: string;
  itemId: string | null;
  itemName: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
}

export interface CreatureDetail extends AdminCreatureSummary {
  damageAffinities: Record<DamageType, AdminCreatureAffinity>;
  level: number;
  health: number;
  attack: number;
  defense: number;
  experience: number;
  attackSpeed: number;
  attackRange: number;
  viewRange: number;
  chaseRange: number;
  footprintWidth: number;
  footprintHeight: number;
  loot: CreatureLootEntry[];
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

export interface AdminTileset extends TilesetDefinition {
  usage: number;
}

export interface AdminTilesetDetail extends TilesetDefinition {
  asset: { fileName: string; mimeType: string; imageWidth: number; imageHeight: number } | null;
  tiles: TileDefinition[];
}

export interface AdminStoredMap extends MapData {
  id: string;
}

export interface TileUpdateInput {
  tileId: number;
  name?: string;
  category?: TileCategory;
  layerType?: TileLayerType;
  walkable?: boolean;
  blocksMovement?: boolean;
  blocksProjectiles?: boolean;
  blocksVision?: boolean;
  movementCost?: number;
  tags?: string[];
  isWater?: boolean;
  isHazard?: boolean;
  isStairs?: boolean;
  isPortal?: boolean;
  enabled?: boolean;
}

export interface AdminAnimationSetConfig {
  spriteWidth: number;
  spriteHeight: number;
  sheetColumns: number;
  sheetRows: number;
  anchor?: { x: number; y: number };
  offsetX?: number;
  offsetY?: number;
  visualBounds?: { width: number; height: number };
  bodyWidth?: number;
  bodyHeight?: number;
  bodyOffsetX?: number;
  bodyOffsetY?: number;
  sockets?: { projectileOrigin?: { x: number; y: number } };
  animations: unknown[];
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

  getAttackRotation(characterId: string, preset: string) { return this.request(`/characters/${characterId}/attack-rotation/${preset}`, { headers: this.headers() }); }
  saveAttackRotation(characterId: string, preset: string, slots: import('@aetheria/types').AttackRotationSlot[]) { return this.request(`/characters/${characterId}/attack-rotation/${preset}`, { method: 'PUT', headers: this.headers(), body: JSON.stringify({ slots }) }); }
  getHealingRotation(characterId: string, preset: string) { return this.request(`/characters/${characterId}/healing-rotation/${preset}`, { headers: this.headers() }); }
  saveHealingRotation(characterId: string, preset: string, slots: import('@aetheria/types').HealingRotationSlot[]) { return this.request(`/characters/${characterId}/healing-rotation/${preset}`, { method: 'PUT', headers: this.headers(), body: JSON.stringify({ slots }) }); }

  getMonsterAbilities(monsterId: number): Promise<any[]> { return this.request(`/admin/monsters/${monsterId}/abilities`, { headers: this.headers() }); }
  saveMonsterAbilities(monsterId: number, abilities: unknown[]): Promise<any[]> { return this.request(`/admin/monsters/${monsterId}/abilities`, { method: 'PUT', headers: this.headers(), body: JSON.stringify({ abilities }) }); }

  listAbilities(): Promise<import('@aetheria/types').CombatAbilityDefinition[]> {
    return this.request('/admin/abilities', { headers: this.headers() });
  }

  saveAbility(input: import('@aetheria/types').CombatAbilityDefinition): Promise<import('@aetheria/types').CombatAbilityDefinition> {
    const path = input.abilityId ? `/admin/abilities/${input.abilityId}` : '/admin/abilities';
    return this.request(path, { method: input.abilityId ? 'PUT' : 'POST', headers: this.headers(), body: JSON.stringify(input) });
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

  saveCreatureStats(id: number, stats: Record<string, number>): Promise<{ ok: boolean }> {
    return this.request(`/admin/creatures/${id}/stats`, { method: 'PUT', headers: this.headers(), body: JSON.stringify(stats) });
  }

  saveCreatureLoot(id: number, loot: CreatureLootEntry[]): Promise<{ ok: boolean; loot: CreatureLootEntry[] }> {
    return this.request(`/admin/creatures/${id}/loot`, { method: 'PUT', headers: this.headers(), body: JSON.stringify({ loot }) });
  }

  saveCreatureAffinities(id: number, affinities: Record<DamageType, AdminCreatureAffinity>): Promise<{ ok: boolean; affinities: Record<DamageType, AdminCreatureAffinity> }> {
    return this.request(`/admin/creatures/${id}/affinities`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify({ affinities }),
    });
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

  getMap(id: string): Promise<AdminStoredMap> {
    return this.request(`/admin/maps/${id}`, { headers: this.headers() });
  }

  saveMap(input: { id?: string; name: string; width: number; height: number; status?: MapStatus; layers: Record<MapLayerId, (number | null)[]>; entities: MapEntity[] }): Promise<MapSummary> {
    return this.request('/admin/maps', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
  }

  deleteMap(id: string): Promise<{ ok: boolean }> {
    return this.request(`/admin/maps/${id}`, { method: 'DELETE', headers: this.headers() });
  }

  listTilesets(): Promise<AdminTileset[]> {
    return this.request('/admin/tilesets', { headers: this.headers() });
  }

  getTileset(id: number): Promise<AdminTilesetDetail> {
    return this.request(`/admin/tilesets/${id}`, { headers: this.headers() });
  }

  uploadTileset(file: File, name: string, tileWidth = 32, tileHeight = 32): Promise<AdminTilesetDetail> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        void file.arrayBuffer().then((buffer) => {
          let binary = '';
          const bytes = new Uint8Array(buffer);
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          return this.request('/admin/tilesets', {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
              name,
              fileName: file.name,
              mimeType: file.type || 'image/png',
              width: image.width,
              height: image.height,
              tileWidth,
              tileHeight,
              dataBase64: btoa(binary),
            }),
          });
        }).then((result) => resolve(result as AdminTilesetDetail)).catch(reject);
      };
      image.onerror = () => reject(new Error('Imagem inválida'));
      image.src = URL.createObjectURL(file);
    });
  }

  updateTileset(id: number, input: { name?: string; enabled?: boolean }): Promise<AdminTilesetDetail> {
    return this.request(`/admin/tilesets/${id}`, { method: 'PUT', headers: this.headers(), body: JSON.stringify(input) });
  }

  deleteTileset(id: number): Promise<{ ok: boolean }> {
    return this.request(`/admin/tilesets/${id}`, { method: 'DELETE', headers: this.headers() });
  }

  updateTiles(tilesetId: number, tiles: TileUpdateInput[]): Promise<TileDefinition[]> {
    return this.request(`/admin/tilesets/${tilesetId}/tiles`, { method: 'PUT', headers: this.headers(), body: JSON.stringify({ tiles }) });
  }

  tilesetImageUrl(tilesetId: number): string {
    return `${this.baseUrl()}/assets/tilesets/${tilesetId}`;
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

  listOutfits(): Promise<OutfitDefinition[]> {
    return this.request('/admin/outfits', { headers: this.headers() });
  }

  getOutfit(outfitId: number): Promise<OutfitDefinition> {
    return this.request(`/admin/outfits/${outfitId}`, { headers: this.headers() });
  }

  saveOutfit(input: Omit<OutfitDefinition, 'outfitId' | 'version'> & { outfitId?: number }): Promise<{ ok: boolean; outfitId: number }> {
    return this.request('/admin/outfits', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
  }

  deleteOutfit(outfitId: number): Promise<{ ok: boolean }> {
    return this.request(`/admin/outfits/${outfitId}`, { method: 'DELETE', headers: this.headers() });
  }

  listAnimationSets(): Promise<{ id: number; name: string }[]> {
    return this.request('/admin/animation-sets', { headers: this.headers() });
  }

  getAnimationSet(id: number): Promise<{ name: string; spriteAssetId: number | null; config: AdminAnimationSetConfig }> {
    return this.request(`/admin/animation-sets/${id}`, { headers: this.headers() });
  }

  saveAnimationSet(input: { id?: number; name: string; spriteAssetId?: number; config: AdminAnimationSetConfig }): Promise<{ ok: boolean; animationSetId: number }> {
    return this.request('/admin/animation-sets', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
  }

  listItems(): Promise<AdminItemDefinition[]> {
    return this.request('/admin/items', { headers: this.headers() });
  }

  getItem(id: string): Promise<AdminItemDefinition | null> {
    return this.request(`/admin/items/${id}`, { headers: this.headers() });
  }

  createItem(input: AdminItemInput): Promise<{ ok: boolean; item: AdminItemDefinition }> {
    return this.request('/admin/items', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
  }

  updateItem(id: string, input: AdminItemInput): Promise<{ ok: boolean; item: AdminItemDefinition }> {
    return this.request(`/admin/items/${id}`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
  }

  listShootTypes(): Promise<import('@aetheria/types').ShootTypeDefinition[]> {
    return this.request('/admin/shoot-types', { headers: this.headers() });
  }

  saveShootType(input: { id?: number; slug: string; name: string; description?: string; sprite?: string; spriteAssetId?: number | null; frameWidth?: number; frameHeight?: number; frames?: Record<string, number>; speedPxPerSecond?: number; offsetX?: number; offsetY?: number; enabled?: boolean }): Promise<{ ok: boolean }> {
    const path = input.id ? `/admin/shoot-types/${input.id}` : '/admin/shoot-types';
    return this.request(path, { method: input.id ? 'PUT' : 'POST', headers: this.headers(), body: JSON.stringify(input) });
  }

  listEffectTypes(): Promise<import('@aetheria/types').EffectTypeDefinition[]> {
    return this.request('/admin/effect-types', { headers: this.headers() });
  }

  saveEffectType(input: { id?: number; slug: string; name: string; description?: string; sprite?: string; spriteAssetId?: number | null; frameWidth?: number; frameHeight?: number; frames?: number[]; fps?: number; enabled?: boolean }): Promise<{ ok: boolean }> {
    const path = input.id ? `/admin/effect-types/${input.id}` : '/admin/effect-types';
    return this.request(path, { method: input.id ? 'PUT' : 'POST', headers: this.headers(), body: JSON.stringify(input) });
  }

  uploadSpriteAsset(file: File): Promise<{ ok: boolean; spriteAssetId: number }> {
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
        this.request('/admin/sprite-assets', {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'image/png', dataBase64 }),
        }),
      );
  }

  testCombatFormula(input: CombatFormulaTestInput): Promise<CombatFormulaTestResult> {
    return this.request('/admin/combat/formula-test', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
  }
}

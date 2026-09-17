import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AmmoType, DamageType, EffectTypeDefinition, EquipmentSlot, ItemType, ShootTypeDefinition, WeaponType } from '@aetheria/types';
import { ApiService, type AdminItemDefinition, type AdminItemInput } from '../core/api.service';

@Component({
  selector: 'admin-item-editor',
  imports: [FormsModule],
  templateUrl: './item-editor.html',
  styles: `
    .layout { display: grid; grid-template-columns: 330px minmax(420px, 1fr); gap: 16px; }
    .panel { background: #111926; border: 1px solid #263244; border-radius: 10px; padding: 14px; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
    .filters { display: grid; gap: 8px; margin-bottom: 12px; }
    .filters .filter-actions { display: flex; gap: 8px; }
    .pagination { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; color: #9aaabd; font-size: 12px; }
    .pagination button:disabled { opacity: .45; cursor: not-allowed; }
    .item-list { display: flex; flex-direction: column; gap: 6px; max-height: 72vh; overflow: auto; }
     .item-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px; border: 1px solid #263244; border-radius: 7px; background: #172130; color: #d9e6f2; text-align: left; } .item-thumb, .item-preview { object-fit: contain; image-rendering: pixelated; background: #0a1017; border: 1px solid #34445c; } .item-thumb { width: 32px; height: 32px; flex: none; } .item-preview { width: 64px; height: 64px; } .image-preview { display: flex; align-items: center; gap: 12px; padding: 10px; border: 1px solid #263244; border-radius: 6px; background: #0d141d; } .image-preview p { margin: 0; color: #9aaabd; font-size: 12px; }
    .item-row.active { border-color: #7fd0a0; }
    .item-row small, label { color: #8fa2b5; font-size: 12px; }
    .form { display: grid; grid-template-columns: repeat(2, minmax(160px, 1fr)); gap: 12px; }
    label { display: flex; flex-direction: column; gap: 4px; }
    input, textarea, select { background: #0d141d; color: #e6eef6; border: 1px solid #2b3546; border-radius: 6px; padding: 8px; }
    textarea { min-height: 78px; resize: vertical; }
    .wide { grid-column: 1 / -1; }
    .actions { margin-top: 14px; display: flex; gap: 8px; }
    button { border: 1px solid #34445c; background: #1b2636; color: #d9e6f2; border-radius: 6px; padding: 8px 12px; }
    button.primary { background: #1f6feb; color: #fff; }
    .error { color: #ff8a8a; }
  `,
})
export class ItemEditor implements OnInit {
  readonly items = signal<AdminItemDefinition[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly draft = signal<AdminItemInput>(blankItem());
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly shootTypes = signal<ShootTypeDefinition[]>([]);
  readonly effectTypes = signal<EffectTypeDefinition[]>([]);
  readonly search = signal('');
  readonly typeFilter = signal('');
  readonly categoryFilter = signal('');
  readonly categories = signal<string[]>([]);
  readonly page = signal(1);
  readonly pageSize = 50;
  readonly total = signal(0);
  readonly totalPages = signal(1);

  readonly itemTypes: ItemType[] = ['helmet', 'armor', 'legs', 'boots', 'weapon', 'ring', 'necklace', 'relic', 'offhand', 'ammo', 'consumable', 'loot', 'other'];
  readonly slots: EquipmentSlot[] = ['helmet', 'armor', 'legs', 'boots', 'ring', 'necklace', 'relic', 'weapon', 'offhand', 'ammo'];
  readonly weaponTypes: WeaponType[] = ['staff', 'sword', 'axe', 'club', 'bow', 'crossbow'];
  readonly ammoTypes: AmmoType[] = ['arrow', 'bolt'];
  readonly damageTypes: DamageType[] = ['physical', 'fire', 'ice', 'energy', 'earth', 'holy', 'death', 'arcane'];

  readonly selected = computed(() => this.items().find((item) => item.id === this.selectedId()) ?? null);

  constructor(private readonly api: ApiService) {}

  imageSource(path: string | null | undefined): string | null {
    if (!path) return null;
    if (/^(data:image\/|https?:\/\/)/.test(path) || path.startsWith('/')) return path;
    if (path.startsWith('assets/')) return path;
    return path.startsWith('items/') ? `assets/${path}` : `assets/items/${path}`;
  }

  async ngOnInit() {
    await this.load();
  }

  async load() {
    this.error.set(null);
    try {
      const [filters, shootTypes, effectTypes] = await Promise.all([
        this.api.listItemFilters(),
        this.api.listShootTypes(),
        this.api.listEffectTypes(),
      ]);
      this.categories.set(['', ...filters.categories]);
      this.shootTypes.set(shootTypes);
      this.effectTypes.set(effectTypes);
      await this.loadPage();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  async loadPage() {
    this.error.set(null);
    try {
      const result = await this.api.listItemsPage({ q: this.search().trim(), type: this.typeFilter(), category: this.categoryFilter(), page: this.page(), pageSize: this.pageSize });
      this.items.set(result.items);
      this.total.set(result.total);
      this.totalPages.set(result.totalPages);
      if (this.selectedId() && !result.items.some((item) => item.id === this.selectedId())) this.selectedId.set(null);
      if (!this.selectedId() && result.items[0]) this.select(result.items[0]);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  applyFilters() {
    this.page.set(1);
    void this.loadPage();
  }

  changePage(delta: number) {
    const next = this.page() + delta;
    if (next < 1 || next > this.totalPages()) return;
    this.page.set(next);
    void this.loadPage();
  }

  select(item: AdminItemDefinition) {
    this.selectedId.set(item.id);
    this.draft.set({
      id: item.id,
      name: item.name,
      description: item.description ?? '',
      type: item.type,
      slot: item.slot ?? null,
      imagePath: item.image || '',
      stackable: item.stackable,
      weight: item.weight,
      category: item.category,
      attackPower: item.combatStats?.attackPower ?? item.ammo?.attackPower ?? 0,
      magicPower: item.combatStats?.magicPower ?? 0,
      armor: item.combatStats?.armor ?? 0,
      defense: item.combatStats?.defense ?? 0,
      maxHp: item.combatStats?.maxHp ?? 0,
      maxMana: item.combatStats?.maxMana ?? 0,
      criticalChance: item.combatStats?.criticalChance ?? 0,
      criticalDamage: item.combatStats?.criticalDamage ?? 0,
      accuracy: item.combatStats?.accuracy ?? 0,
      dodge: item.combatStats?.dodge ?? 0,
      speed: item.combatStats?.speed ?? 0,
      weaponType: item.weapon?.weaponType ?? null,
      ammoType: item.ammo?.ammoType ?? null,
      damageType: item.weapon?.damageType ?? item.ammo?.damageType ?? 'physical',
      range: item.weapon?.range ?? 1,
      allowedAmmoType: item.weapon?.allowedAmmoType ?? null,
      visual: item.visual ? structuredClone(item.visual) : null,
      specialModifiers: item.specialModifiers ? structuredClone(item.specialModifiers) : null,
      shootTypeId: item.shootTypeId ?? null,
      effectTypeId: item.effectTypeId ?? null,
      enabled: item.enabled ?? true,
    });
  }

  createNew() {
    this.selectedId.set(null);
    this.draft.set(blankItem());
  }

  patch(patch: Partial<AdminItemInput>) {
    this.draft.update((draft) => ({ ...draft, ...patch }));
  }

  async save() {
    const draft = this.draft();
    this.saving.set(true);
    this.error.set(null);
    try {
      const result = this.selectedId()
        ? await this.api.updateItem(this.selectedId()!, draft)
        : await this.api.createItem(draft);
      await this.load();
      this.select(result.item);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }
}

function blankItem(): AdminItemInput {
  return {
    id: '',
    name: 'Novo Item',
    description: '',
    type: 'other',
    slot: null,
    imagePath: '',
    stackable: false,
    weight: 0,
    category: 'outros',
    attackPower: 0,
    magicPower: 0,
    armor: 0,
    defense: 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    speed: 0,
    weaponType: null,
    ammoType: null,
    damageType: 'physical',
    range: 1,
    allowedAmmoType: null,
    visual: null,
    specialModifiers: null,
    shootTypeId: null,
    effectTypeId: null,
    enabled: true,
  };
}

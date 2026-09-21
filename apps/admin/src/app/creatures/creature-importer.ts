import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService, type TibiaWikiImportPreview } from '../core/api.service';
import { AMMO_TYPES, DAMAGE_TYPES, ITEM_SLOTS, ITEM_TYPES, WEAPON_TYPES } from '../core/item-options';

@Component({ selector: 'admin-creature-importer', imports: [FormsModule], templateUrl: './creature-importer.html', styleUrls: ['./creature-importer.scss'] })
export class CreatureImporter {
  readonly url = signal('');
  readonly preview = signal<TibiaWikiImportPreview | null>(null);
  readonly previewId = signal<string | null>(null);
  readonly loading = signal(false);
  readonly importing = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);
  readonly categories = signal<string[]>([]);
  readonly itemTypes = ITEM_TYPES;
  readonly slots = ITEM_SLOTS;
  readonly weaponTypes = WEAPON_TYPES;
  readonly ammoTypes = AMMO_TYPES;
  readonly damageTypes = DAMAGE_TYPES;

  constructor(private readonly api: ApiService, private readonly router: Router) { void this.loadCategories(); }

  private async loadCategories() {
    try { this.categories.set((await this.api.listItemFilters()).categories); } catch { /* preview remains usable without filters */ }
  }

  categoryOptions(category: string) { return [...new Set([category, ...this.categories()].filter(Boolean))]; }

  async consult() {
    this.loading.set(true); this.error.set(null); this.success.set(null); this.preview.set(null); this.previewId.set(null);
    try { const result = await this.api.previewTibiaWikiCreature(this.url().trim()); this.previewId.set(result.previewId); this.preview.set(result.preview); }
    catch (error) { this.error.set((error as Error).message); }
    finally { this.loading.set(false); }
  }

  async confirm() {
    const id = this.previewId(); if (!id) return;
    this.importing.set(true); this.error.set(null);
    try {
      const edited = this.preview();
      if (!edited) return;
      this.preview.set((await this.api.updateTibiaWikiCreaturePreview(id, edited)).preview);
      const result = await this.api.importTibiaWikiCreature(id);
      this.success.set(`${result.itemCount} itens importados para a criatura #${result.creatureId}.`);
      this.previewId.set(null);
    }
    catch (error) { this.error.set((error as Error).message); }
    finally { this.importing.set(false); }
  }

  affinityRows() { return Object.entries(this.preview()?.creature.damageAffinities ?? {}).map(([type, value]) => ({ type, percent: Math.round((1 + value.modifier) * 10000) / 100, immune: value.immune })); }
  itemImageUrl(image: string | null) { return image ? `/assets/items/${image}` : ''; }
   editCreature(field: 'name' | 'slug' | 'description' | 'hp' | 'experience' | 'armor' | 'charms' | 'difficulty' | 'gameLevel' | 'gameAttack', value: unknown) {
    this.preview.update((current) => {
      if (!current) return current;
       const nextValue = ['hp', 'experience', 'armor', 'charms', 'gameLevel', 'gameAttack'].includes(field) ? this.numberValue(value) : String(value ?? '');
      return { ...current, creature: { ...current.creature, [field]: nextValue } };
    });
  }

  editAffinity(type: string, percent: unknown, immune: boolean) {
    this.preview.update((current) => {
      if (!current) return current;
      const value = this.numberValue(percent) ?? 0;
      return { ...current, creature: { ...current.creature, damageAffinities: { ...current.creature.damageAffinities, [type]: { modifier: value / 100 - 1, immune } } } };
    });
  }

  editLoot(index: number, field: string, value: unknown) {
    this.preview.update((current) => {
      if (!current) return current;
      const loot = current.loot.map((item, itemIndex) => {
         if (itemIndex !== index) return item;
         const next = { ...item, [field]: this.lootValue(field, value) };
         if (field === 'defenseBase' || field === 'defenseModifier') next.defense = Number(next.defenseBase ?? 0) + Number(next.defenseModifier ?? 0);
         if (field === 'defense') { next.defenseBase = Number(next.defense); next.defenseModifier = 0; }
        return field === 'type' && !this.canHaveAttack(String(next.type)) ? { ...next, attackPower: 0 } : next;
      });
      return { ...current, loot };
    });
  }

  canHaveAttack(type: string) { return type === 'weapon' || type === 'ammo'; }

  private lootValue(field: string, value: unknown): unknown {
     if (['chance', 'minQuantity', 'maxQuantity', 'weight', 'attackPower', 'armor', 'defenseBase', 'defenseModifier', 'defense', 'sellValue'].includes(field)) return this.numberValue(value) ?? 0;
    if (field === 'stackable') return Boolean(value);
    return String(value ?? '');
  }

  private numberValue(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  cancel() { void this.router.navigate(['/creatures']); }
}

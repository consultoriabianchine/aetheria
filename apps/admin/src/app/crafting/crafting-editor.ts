import { DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CraftingIntent, CraftingProfession } from '@aetheria/types';
import { ApiService, type AdminCraftIngredient, type AdminCraftRecipe, type AdminCraftRecipeInput, type AdminCraftRecipeVersion } from '../core/api.service';
import { AdminSelect, type AdminSelectOption } from '../core/admin-select';

@Component({
  selector: 'admin-crafting-editor',
  imports: [FormsModule, DatePipe, AdminSelect],
  templateUrl: './crafting-editor.html',
  styles: `
    .layout { display:grid; grid-template-columns:320px minmax(500px,1fr); gap:16px; }
    .panel { background:var(--admin-surface-soft); border:1px solid var(--admin-border); border-radius:var(--admin-radius-md); padding:14px; box-shadow:var(--admin-shadow-panel); }
    .toolbar,.filters,.actions,.ingredient-row { display:flex; gap:8px; align-items:center; }
    .filters { flex-direction:column; align-items:stretch; margin:12px 0; }
    .recipe-list { display:grid; gap:6px; max-height:72vh; overflow:auto; }
    .recipe-row { display:flex; justify-content:space-between; gap:8px; text-align:left; color:var(--admin-text); background:var(--admin-surface-raised); border:1px solid var(--admin-border); border-radius:var(--admin-radius-sm); padding:9px; }
    .recipe-row.active { border-color:var(--admin-gold-bright); }
    .recipe-row small,label { color:var(--admin-text-muted); font-size:12px; }
    .form { display:grid; grid-template-columns:repeat(2,minmax(170px,1fr)); gap:10px; }
    label { display:flex; flex-direction:column; gap:4px; }
    .wide { grid-column:1/-1; }
    input,textarea,select { background:rgba(8,11,17,.72); color:var(--admin-text); border:1px solid var(--admin-border); border-radius:var(--admin-radius-sm); padding:8px; }
    textarea { min-height:70px; resize:vertical; }
    button { border:1px solid var(--admin-border); background:var(--admin-surface-raised); color:var(--admin-text); border-radius:var(--admin-radius-sm); padding:8px 12px; }
    button.primary { background:linear-gradient(180deg,var(--admin-gold-bright),var(--admin-gold)); color:#241b08; }
    button:disabled { opacity:.45; cursor:not-allowed; }
    .ingredient-row { align-items:end; margin:6px 0; }
    .ingredient-row label { flex:1; }
    .error { color:#ff8a8a; }
    .status { font-size:12px; color:var(--admin-text-muted); }
    @media (max-width:900px) { .layout { grid-template-columns:1fr; } }
  `,
})
export class CraftingEditor implements OnInit {
  readonly recipes = signal<AdminCraftRecipe[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly draft = signal<AdminCraftRecipeInput>(blankRecipe());
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly versions = signal<AdminCraftRecipeVersion[]>([]);
  readonly search = signal('');
  readonly statusFilter = signal('');
  readonly professionFilter = signal('');
  readonly professions: CraftingProfession[] = ['forging', 'alchemy', 'runecraft'];
  readonly intents: CraftingIntent[] = ['offense', 'defense', 'arcane', 'utility'];
  readonly professionOptions: AdminSelectOption[] = [
    { value: 'forging', label: 'Forja' },
    { value: 'alchemy', label: 'Alquimia' },
    { value: 'runecraft', label: 'Runas' },
  ];
  readonly professionFilterOptions: AdminSelectOption[] = [{ value: '', label: 'Todas as profissões' }, ...this.professionOptions];
  readonly statusOptions: AdminSelectOption[] = [
    { value: '', label: 'Todos os status' },
    { value: 'draft', label: 'Rascunho' },
    { value: 'published', label: 'Publicada' },
    { value: 'disabled', label: 'Desativada' },
  ];
  readonly roleOptions: AdminSelectOption[] = [
    { value: 'base', label: 'Base' },
    { value: 'essence', label: 'Essência' },
    { value: 'catalyst', label: 'Catalisador' },
    { value: 'material', label: 'Material' },
  ];

  constructor(private readonly api: ApiService) {}

  async ngOnInit() { await this.load(); }

  async load() {
    this.error.set(null);
    try {
      const recipes = await this.api.listCraftRecipes({ q: this.search().trim(), status: this.statusFilter(), profession: this.professionFilter() });
      this.recipes.set(recipes);
      if (!this.selectedId() && recipes[0]) this.select(recipes[0]);
    } catch (error) { this.error.set((error as Error).message); }
  }

  createNew() { this.selectedId.set(null); this.draft.set(blankRecipe()); this.versions.set([]); }

  select(recipe: AdminCraftRecipe) {
    this.selectedId.set(recipe.id);
    this.draft.set({ ...recipe, expectedVersion: recipe.version, ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient })) });
    void this.loadVersions(recipe.id);
  }

  async loadVersions(id: string) {
    try { this.versions.set(await this.api.getCraftRecipeVersions(id)); } catch { this.versions.set([]); }
  }

  patch(patch: Partial<AdminCraftRecipeInput>) { this.draft.update((draft) => ({ ...draft, ...patch })); }

  patchTags(value: string) { this.patch({ resonanceTags: value.split(',').map((entry) => entry.trim()).filter(Boolean) }); }

  professionLabel(value: string) { return this.professionOptions.find((option) => option.value === value)?.label ?? value; }

  statusLabel(value: string) { return this.statusOptions.find((option) => option.value === value)?.label ?? value; }

  setProfession(value: string) {
    if (this.professions.includes(value as CraftingProfession)) this.patch({ profession: value as CraftingProfession });
  }

  patchIngredient(index: number, patch: Partial<AdminCraftIngredient>) {
    this.draft.update((draft) => ({ ...draft, ingredients: draft.ingredients.map((ingredient, i) => i === index ? { ...ingredient, ...patch } : ingredient) }));
  }

  addIngredient() { this.draft.update((draft) => ({ ...draft, ingredients: [...draft.ingredients, { itemId: '', tag: '', quantity: 1, role: 'material' }] })); }

  removeIngredient(index: number) { this.draft.update((draft) => ({ ...draft, ingredients: draft.ingredients.filter((_, i) => i !== index) })); }

  toggleIntent(intent: CraftingIntent) {
    this.draft.update((draft) => ({ ...draft, allowedIntents: draft.allowedIntents.includes(intent) ? draft.allowedIntents.filter((value) => value !== intent) : [...draft.allowedIntents, intent] }));
  }

  async save() {
    this.saving.set(true); this.error.set(null);
    try {
      const result = this.selectedId() ? await this.api.updateCraftRecipe(this.selectedId()!, this.draft()) : await this.api.createCraftRecipe(this.draft());
      await this.load();
      this.select(result.recipe);
    } catch (error) { this.error.set((error as Error).message); }
    finally { this.saving.set(false); }
  }

  async publish() { await this.changeStatus('publish'); }
  async disable() { await this.changeStatus('disable'); }

  private async changeStatus(action: 'publish' | 'disable') {
    if (!this.selectedId()) return;
    try {
      const result = action === 'publish' ? await this.api.publishCraftRecipe(this.selectedId()!, this.draft().expectedVersion) : await this.api.disableCraftRecipe(this.selectedId()!, this.draft().expectedVersion);
      await this.load(); this.select(result.recipe);
    } catch (error) { this.error.set((error as Error).message); }
  }
}

function blankRecipe(): AdminCraftRecipeInput {
  return { slug: '', name: 'Nova Receita', description: '', profession: 'forging', requiredLevel: 1, station: 'forge', outputItemId: '', outputQuantity: 1, goldCost: 0, experience: 10, qualityMin: 100, qualityMax: 100, allowedIntents: [], resonanceTags: [], status: 'draft', ingredients: [{ itemId: '', tag: '', quantity: 1, role: 'material' }] };
}

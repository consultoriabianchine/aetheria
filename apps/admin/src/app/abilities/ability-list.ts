import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AbilityAreaConfig, AbilityCategory, AbilityOwnerType, CombatAbilityDefinition, DamageType, EffectTypeDefinition, PlayerAbilityClass, ShootTypeDefinition } from '@aetheria/types';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'admin-ability-list',
  imports: [FormsModule],
  templateUrl: './ability-list.html',
  styles: `
     .layout { display:grid; grid-template-columns:320px 1fr; gap:16px; }
     .panel { background:var(--admin-surface-soft); border:1px solid var(--admin-border); border-radius:var(--admin-radius-md); padding:14px; box-shadow:var(--admin-shadow-panel); }
     .list { display:flex; flex-direction:column; gap:6px; max-height:75vh; overflow:auto; }
      button, input, select, textarea { background:rgba(8,11,17,.72); color:var(--admin-text); border:1px solid var(--admin-border); border-radius:var(--admin-radius-sm); padding:8px; } button { cursor:pointer; } .primary { background:linear-gradient(180deg,var(--admin-gold-bright),var(--admin-gold)); color:#241b08; } .row { display:flex; gap:8px; } label { display:flex; flex-direction:column; gap:4px; margin:8px 0; } .form { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; } .wide { grid-column:1 / -1; } .filters { display:grid; grid-template-columns:1.5fr repeat(3, 1fr); gap:6px; padding:8px; margin-bottom:4px; border-bottom:1px solid var(--admin-border); } .filters input, .filters select { min-width:0; } .filter-meta { color:var(--admin-text-muted); font-size:12px; padding:2px 4px 6px; } .ability-entry { display:flex; gap:6px; } .ability-open { display:flex; flex:1; align-items:center; gap:8px; text-align:left; } .copy-button { flex:none; } .ability-thumb { width:32px; height:32px; object-fit:contain; image-rendering:pixelated; background:#070b10; border:1px solid var(--admin-border); } .icon-import { display:flex; align-items:center; gap:12px; padding:10px; border:1px solid var(--admin-border); border-radius:var(--admin-radius-sm); background:rgba(8,11,17,.72); } .icon-preview { width:64px; height:64px; display:grid; place-items:center; flex:none; border:1px solid var(--admin-border); background:#070b10; color:var(--admin-text-subtle); font-size:24px; } .icon-preview img { width:64px; height:64px; image-rendering:pixelated; } .icon-import p { margin:0 0 8px; color:var(--admin-text-muted); font-size:12px; } .icon-import small { display:block; margin-top:6px; color:var(--admin-gold); }
  `,
})
export class AbilityList implements OnInit {
  readonly abilities = signal<CombatAbilityDefinition[]>([]);
  readonly selected = signal<CombatAbilityDefinition | null>(null);
  readonly error = signal<string | null>(null);
  readonly shootTypes = signal<ShootTypeDefinition[]>([]);
  readonly effectTypes = signal<EffectTypeDefinition[]>([]);
  readonly owners: AbilityOwnerType[] = ['player', 'monster', 'both'];
  readonly playerClasses: PlayerAbilityClass[] = ['all', 'mage', 'warrior', 'archer'];
  readonly categories: AbilityCategory[] = ['attack', 'area', 'rune', 'heal', 'support'];
  readonly damageTypes: DamageType[] = ['physical', 'fire', 'ice', 'energy', 'earth', 'holy', 'death', 'arcane'];
  readonly targetModes = ['self', 'single_enemy', 'single_ally', 'area_enemy', 'area_ally', 'directional', 'ground'];
  readonly search = signal('');
  readonly ownerFilter = signal<AbilityOwnerType | ''>('');
  readonly classFilter = signal<PlayerAbilityClass | ''>('');
  readonly categoryFilter = signal<AbilityCategory | ''>('');
  readonly targetModeFilter = signal('');
  readonly damageFilter = signal<DamageType | ''>('');
  readonly statusFilter = signal<'all' | 'enabled' | 'disabled'>('all');
  readonly filteredAbilities = computed(() => {
    const search = this.search().trim().toLowerCase();
    return this.abilities().filter((ability) => {
      const matchesSearch = !search || [ability.abilityId, ability.name, ability.slug].some((value) => String(value ?? '').toLowerCase().includes(search));
      const matchesOwner = !this.ownerFilter() || ability.ownerType === this.ownerFilter();
      const matchesClass = !this.classFilter() || ability.playerClass === this.classFilter();
      const matchesCategory = !this.categoryFilter() || ability.category === this.categoryFilter();
      const matchesTarget = !this.targetModeFilter() || ability.targetMode === this.targetModeFilter();
      const matchesDamage = !this.damageFilter() || ability.damageType === this.damageFilter();
      const matchesStatus = this.statusFilter() === 'all' || this.statusFilter() === 'enabled' && ability.enabled || this.statusFilter() === 'disabled' && !ability.enabled;
      return matchesSearch && matchesOwner && matchesClass && matchesCategory && matchesTarget && matchesDamage && matchesStatus;
    });
  });

  constructor(private readonly api: ApiService) {}
  async ngOnInit() { await this.load(); }
  async load() {
    try {
      const [abilities, shootTypes, effectTypes] = await Promise.all([this.api.listAbilities(), this.api.listShootTypes(), this.api.listEffectTypes()]);
      this.abilities.set(abilities);
      this.shootTypes.set(shootTypes);
      this.effectTypes.set(effectTypes);
    } catch (error) { this.error.set(String(error)); }
  }
  newAbility() { this.selected.set({ abilityId: 0, slug: '', name: '', ownerType: 'both', playerClass: 'all', category: 'attack', targetMode: 'single_enemy', powerSource: 'fixed', cooldownMs: 2000, cooldownGroup: 'attack', rangeTiles: 1, allowedParameters: [], enabled: true, createdAt: new Date(), updatedAt: new Date() }); }
  edit(ability: CombatAbilityDefinition) { this.selected.set({ ...ability, icon: ability.icon?.startsWith('data:') ? `abilities/${ability.abilityId}.png` : ability.icon || `abilities/${ability.abilityId}.png` }); }
  copy(ability: CombatAbilityDefinition) {
    const source = JSON.parse(JSON.stringify(ability)) as CombatAbilityDefinition;
    const baseSlug = source.slug || `ability-${source.abilityId}`;
    const usedSlugs = new Set(this.abilities().map((item) => item.slug));
    let suffix = 1;
    let slug = `${baseSlug}-copy`;
    while (usedSlugs.has(slug)) slug = `${baseSlug}-copy-${++suffix}`;
    this.selected.set({
      ...source,
      abilityId: 0,
      name: `${source.name} Copy`,
      slug,
      icon: source.icon || `abilities/${source.abilityId}.png`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
  clearFilters() {
    this.search.set('');
    this.ownerFilter.set('');
    this.classFilter.set('');
    this.categoryFilter.set('');
    this.targetModeFilter.set('');
    this.damageFilter.set('');
    this.statusFilter.set('all');
  }
  iconSource(ability: CombatAbilityDefinition): string {
    const icon = ability.icon || `abilities/${ability.abilityId}.png`;
    if (/^(data:image\/|https?:\/\/)/.test(icon)) return icon;
    if (icon.startsWith('/')) return icon;
    return icon.startsWith('assets/') ? icon : icon.startsWith('abilities/') ? `assets/${icon}` : `assets/abilities/${icon}`;
  }
  areaConfigDraft(): AbilityAreaConfig { return this.selected()?.areaConfig ?? { shape: 'square', width: 1, height: 1 }; }
  patchAreaConfig(patch: Partial<AbilityAreaConfig>) { const draft = this.selected(); if (draft) this.selected.set({ ...draft, areaConfig: { ...this.areaConfigDraft(), ...patch } }); }
  powerMultiplier(): number { return this.selected()?.defaultParameters?.['powerMultiplier'] ?? 1; }
  setPowerMultiplier(value: number) {
    const draft = this.selected();
    if (!draft) return;
    const defaultParameters = { ...(draft.defaultParameters ?? {}), powerMultiplier: Number.isFinite(value) ? Math.max(0, value) : 1 };
    this.selected.set({ ...draft, defaultParameters });
  }
  async save() { const draft = this.selected(); if (!draft) return; try { const saved = await this.api.saveAbility(draft); this.selected.set(saved); await this.load(); } catch (error) { this.error.set(String(error)); } }
}

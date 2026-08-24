import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { AbilityCategory, AbilityOwnerType, CombatAbilityDefinition, DamageType } from '@aetheria/types';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'admin-ability-list',
  imports: [FormsModule],
  templateUrl: './ability-list.html',
  styles: `
    .layout { display:grid; grid-template-columns:320px 1fr; gap:16px; }
    .panel { background:#111926; border:1px solid #263244; border-radius:10px; padding:14px; }
    .list { display:flex; flex-direction:column; gap:6px; max-height:75vh; overflow:auto; }
    button, input, select, textarea { background:#0d141d; color:#e6eef6; border:1px solid #2b3546; border-radius:6px; padding:8px; }
    button { cursor:pointer; } .primary { background:#1f6feb; } .row { display:flex; gap:8px; } label { display:flex; flex-direction:column; gap:4px; margin:8px 0; } .form { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; }
  `,
})
export class AbilityList implements OnInit {
  readonly abilities = signal<CombatAbilityDefinition[]>([]);
  readonly selected = signal<CombatAbilityDefinition | null>(null);
  readonly error = signal<string | null>(null);
  readonly owners: AbilityOwnerType[] = ['player', 'monster', 'both'];
  readonly categories: AbilityCategory[] = ['attack', 'area', 'rune', 'heal', 'support'];
  readonly damageTypes: DamageType[] = ['physical', 'fire', 'ice', 'energy', 'earth', 'holy', 'death', 'arcane'];

  constructor(private readonly api: ApiService) {}
  async ngOnInit() { await this.load(); }
  async load() { try { this.abilities.set(await this.api.listAbilities()); } catch (error) { this.error.set(String(error)); } }
  newAbility() { this.selected.set({ abilityId: 0, slug: '', name: '', ownerType: 'both', category: 'attack', targetMode: 'single_enemy', powerSource: 'fixed', cooldownMs: 2000, cooldownGroup: 'attack', rangeTiles: 1, allowedParameters: [], enabled: true, createdAt: new Date(), updatedAt: new Date() }); }
  edit(ability: CombatAbilityDefinition) { this.selected.set({ ...ability }); }
  async uploadIcon(event: Event) { const draft = this.selected(); const file = (event.target as HTMLInputElement).files?.[0]; if (!draft || !file || !draft.abilityId) return; try { this.selected.set(await this.api.uploadAbilityIcon(draft.abilityId, file)); await this.load(); } catch (error) { this.error.set(String(error)); } }
  async save() { const draft = this.selected(); if (!draft) return; try { const saved = await this.api.saveAbility(draft); this.selected.set(saved); await this.load(); } catch (error) { this.error.set(String(error)); } }
}

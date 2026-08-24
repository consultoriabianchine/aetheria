import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';

@Component({ selector: 'admin-monster-abilities', imports: [FormsModule], template: `
<h2>Monster Abilities</h2>
<div class="row"><input type="number" placeholder="Monster ID" [(ngModel)]="monsterId"><button (click)="load()">Load</button></div>
@if (error()) { <p>{{ error() }}</p> }
@if (loaded()) { @for (item of assignments(); track $index) { <div class="card"><input type="number" [(ngModel)]="item.abilityId" placeholder="Ability ID"><label>Priority<input type="number" [(ngModel)]="item.priority"></label><label>Chance %<input type="number" [(ngModel)]="item.chancePercent"></label><label>Power<input type="number" [(ngModel)]="item.power"></label><button (click)="remove($index)">Remove</button></div> } <button (click)="add()">Add Skill</button><button class="primary" (click)="save()">Save</button> }
`, styles: `.row,.card{display:flex;gap:8px;align-items:center;margin:8px 0}.card{padding:10px;background:#111926;border:1px solid #263244;border-radius:8px}input{background:#0d141d;color:#e6eef6;border:1px solid #2b3546;padding:7px}button{padding:7px}.primary{background:#1f6feb;color:white}` })
export class MonsterAbilities implements OnInit {
  monsterId = ''; readonly assignments = signal<any[]>([]); readonly loaded = signal(false); readonly error = signal<string | null>(null);
  constructor(private readonly api: ApiService) {} ngOnInit() {}
  async load() { try { const rows = await this.api.getMonsterAbilities(Number(this.monsterId)); this.assignments.set((rows as any[]).map((row) => ({ abilityId: row.ability_id, priority: row.priority, chancePercent: row.chance * 100, power: row.parameters?.power ?? 0 }))); this.loaded.set(true); } catch (e) { this.error.set(String(e)); } }
  add() { this.assignments.update((items) => [...items, { abilityId: 0, priority: items.length + 1, chancePercent: 100, power: 0 }]); }
  remove(index: number) { this.assignments.update((items) => items.filter((_, i) => i !== index)); }
  async save() { await this.api.saveMonsterAbilities(Number(this.monsterId), this.assignments().map((item) => ({ abilityId: Number(item.abilityId), priority: Number(item.priority), chance: Number(item.chancePercent) / 100, enabled: true, parameters: item.power > 0 ? { power: Number(item.power) } : undefined }))); }
}

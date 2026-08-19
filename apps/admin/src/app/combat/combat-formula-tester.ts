import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { CombatArchetype, DamageType } from '@aetheria/types';
import { ApiService, type CombatFormulaTestInput, type CombatFormulaTestResult } from '../core/api.service';

@Component({
  selector: 'admin-combat-formula-tester',
  imports: [FormsModule],
  templateUrl: './combat-formula-tester.html',
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; max-width: 1100px; }
    label { display: flex; flex-direction: column; gap: 4px; color: #9db2c8; font-size: 12px; }
    input, select { background: #101620; color: #d9e6f2; border: 1px solid #2b3546; border-radius: 6px; padding: 8px; }
    button { margin: 14px 0; padding: 8px 14px; border-radius: 6px; border: 1px solid #34445c; background: #1f6feb; color: white; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; max-width: 1100px; }
    .card { background: #111926; border: 1px solid #263244; border-radius: 10px; padding: 12px; }
    .value { font-size: 22px; color: #7fd0a0; margin-top: 4px; }
    table { margin-top: 18px; width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #263244; padding: 8px; text-align: left; }
    .error { color: #ff8a8a; }
  `,
})
export class CombatFormulaTester implements OnInit {
  private readonly api = inject(ApiService);
  readonly archetypes: CombatArchetype[] = ['mage', 'warrior', 'archer'];
  readonly damageTypes: DamageType[] = ['physical', 'fire', 'ice', 'energy', 'earth', 'holy', 'death', 'arcane'];
  readonly model = signal<CombatFormulaTestInput>({
    archetype: 'warrior',
    level: 100,
    melee: 80,
    distance: 80,
    magic: 50,
    weaponPower: 40,
    staffPower: 30,
    ammoPower: 12,
    targetLevel: 100,
    armor: 500,
    defense: 0,
    damageType: 'physical',
    resistance: 0,
    critical: false,
    abilityMultiplier: 1,
    flatPower: 0,
  });
  readonly result = signal<CombatFormulaTestResult | null>(null);
  readonly error = signal<string | null>(null);
  readonly simulations = signal<Array<{ level: number; skill: number; weak: number; medium: number; strong: number }>>([]);

  async ngOnInit() {
    await this.calculate();
  }

  update<K extends keyof CombatFormulaTestInput>(key: K, value: CombatFormulaTestInput[K]) {
    this.model.update((m) => ({ ...m, [key]: value }));
  }

  async calculate() {
    this.error.set(null);
    try {
      const result = await this.api.testCombatFormula(this.model());
      this.result.set(result);
      await this.simulate();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  private async simulate() {
    const levels = [10, 50, 100, 200, 500];
    const skills = [10, 50, 100, 150];
    const rows = [];
    for (const level of levels) {
      for (const skill of skills) {
        const damages = await Promise.all([10, 30, 60].map((power) => this.api.testCombatFormula(this.simInput(level, skill, power))));
        rows.push({ level, skill, weak: damages[0].average ?? 0, medium: damages[1].average ?? 0, strong: damages[2].average ?? 0 });
      }
    }
    this.simulations.set(rows);
  }

  private simInput(level: number, skill: number, power: number): CombatFormulaTestInput {
    const current = this.model();
    return {
      ...current,
      level,
      melee: skill,
      distance: skill,
      magic: skill,
      weaponPower: power,
      staffPower: power,
      ammoPower: current.archetype === 'archer' ? Math.round(power * 0.6) : 0,
    };
  }
}

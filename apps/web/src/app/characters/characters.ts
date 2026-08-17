import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { first } from 'rxjs';
import { VOCATIONS } from '@aetheria/config';
import type { CharacterSummary, VocationDefinition, VocationId } from '@aetheria/types';
import { GameState } from '../game/game-state';

const ROLE_LABEL: Record<string, string> = {
  tank: 'Tank',
  ranged: 'Ranged',
  caster: 'Caster',
  support: 'Support',
};

@Component({
  selector: 'app-characters',
  imports: [FormsModule],
  templateUrl: './characters.html',
  styleUrl: './characters.scss',
})
export class Characters {
  readonly state = inject(GameState);
  readonly newName = signal('');
  readonly selectedVocation = signal<VocationId>('knight');
  private readonly router = inject(Router);

  readonly vocations = computed(() =>
    (Object.values(VOCATIONS) as VocationDefinition[]).map((v) => {
      const tags = [`HP ${v.hpPerLevel}/lv`, `Mana ${v.manaPerLevel}/lv`];
      if (v.damageReduction > 0) tags.push(`${Math.round(v.damageReduction * 100)}% DR`);
      if (v.canUseShield) tags.push('Shield');
      return { id: v.id, name: v.name, role: ROLE_LABEL[v.role] ?? v.role, tags };
    }),
  );

  create() {
    this.state.createError.set('');
    this.state.createCharacter(this.newName(), this.selectedVocation());
    this.state.characterCreated$.pipe(first()).subscribe(() => {
      this.newName.set('');
    });
  }

  enter(character: CharacterSummary) {
    this.state.selectCharacter(character.id);
    this.state.selectResult$.pipe(first()).subscribe((ok) => {
      if (ok) void this.router.navigate(['/game']);
    });
  }

  back() {
    void this.router.navigate(['/login']);
  }
}
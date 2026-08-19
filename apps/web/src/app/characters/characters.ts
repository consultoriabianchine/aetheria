import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { first } from 'rxjs';
import { ARCHETYPES } from '@aetheria/config';
import type { ArchetypeDefinition, CharacterSummary, CombatArchetype } from '@aetheria/types';
import { GameState } from '../game/game-state';

const ARCHETYPE_ROLE: Record<CombatArchetype, string> = {
  mage: 'Magia',
  warrior: 'Corpo a corpo',
  archer: 'Distância',
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
  readonly selectedArchetype = signal<CombatArchetype>('warrior');
  private readonly router = inject(Router);

  readonly archetypes = computed(() =>
    (Object.values(ARCHETYPES) as ArchetypeDefinition[]).map((v) => {
      const tags = [`HP ${v.hpPerLevel}/lv`, `Mana ${v.manaPerLevel}/lv`];
      tags.push(v.primarySkill);
      return { id: v.id, name: v.name, role: ARCHETYPE_ROLE[v.id], tags };
    }),
  );

  create() {
    this.state.createError.set('');
    this.state.createCharacter(this.newName(), this.selectedArchetype());
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

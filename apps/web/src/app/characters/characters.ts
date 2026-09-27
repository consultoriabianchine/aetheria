import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
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
  imports: [FormsModule, RouterLink],
  templateUrl: './characters.html',
  styleUrl: './characters.scss',
})
export class Characters {
  readonly state = inject(GameState);
  readonly newName = signal('');
  readonly selectedArchetype = signal<CombatArchetype>('warrior');
  readonly entering = signal(false);
  private readonly router = inject(Router);

  readonly archetypes = computed(() =>
    (Object.values(ARCHETYPES) as ArchetypeDefinition[]).map((v) => {
      const tags = [`HP ${v.hpPerLevel}/lv`, `Mana ${v.manaPerLevel}/lv`];
      tags.push(v.primarySkill);
      return { id: v.id, name: v.name, role: ARCHETYPE_ROLE[v.id], tags };
    }),
  );

  archetypeName(id: CombatArchetype) {
    return (ARCHETYPES[id] as ArchetypeDefinition).name;
  }

  healthPercent(character: CharacterSummary) {
    return character.maxHealth ? Math.round((character.health / character.maxHealth) * 100) : 0;
  }

  manaPercent(character: CharacterSummary) {
    return character.maxMana ? Math.round((character.mana / character.maxMana) * 100) : 0;
  }

  create() {
    this.state.createError.set('');
    this.state.createCharacter(this.newName(), this.selectedArchetype());
    this.state.characterCreated$.pipe(first()).subscribe(() => {
      this.newName.set('');
    });
  }

  enter(character: CharacterSummary) {
    if (this.entering()) return;
    this.entering.set(true);
    this.state.selectResult$.pipe(first()).subscribe((ok) => {
      if (!ok) {
        this.entering.set(false);
        return;
      }
      void this.router.navigate(['/game']);
    });
    this.state.selectCharacter(character.id);
  }

  back() {
    void this.router.navigate(['/login']);
  }
}

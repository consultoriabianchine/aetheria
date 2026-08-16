import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { first } from 'rxjs';
import type { CharacterSummary } from '@aetheria/types';
import { GameState } from '../game/game-state';

@Component({
  selector: 'app-characters',
  imports: [FormsModule],
  templateUrl: './characters.html',
  styleUrl: './characters.scss',
})
export class Characters {
  readonly state = inject(GameState);
  readonly newName = signal('');
  private readonly router = inject(Router);

  create() {
    this.state.createError.set('');
    this.state.createCharacter(this.newName());
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
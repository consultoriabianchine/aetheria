import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { first } from 'rxjs';
import { GameState } from '../game/game-state';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  readonly username = signal('');
  readonly password = signal('');
  readonly state = inject(GameState);
  private readonly router = inject(Router);

  submit() {
    this.state.loginError.set('');
    this.state.login(this.username(), this.password());
    this.state.loginResult$.pipe(first()).subscribe((ok) => {
      if (ok) void this.router.navigate(['/characters']);
    });
  }
}
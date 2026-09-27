import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { first } from 'rxjs';
import { GameState } from '../game/game-state';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  readonly username = signal('');
  readonly password = signal('');
  readonly showPassword = signal(false);
  readonly submitting = signal(false);
  readonly state = inject(GameState);
  private readonly router = inject(Router);

  submit() {
    this.state.loginError.set('');
    if (!this.username() || !this.password()) {
      this.state.loginError.set('Informe usuário e senha para continuar.');
      return;
    }
    this.submitting.set(true);
    this.state.login(this.username(), this.password());
    this.state.loginResult$.pipe(first()).subscribe((ok) => {
      this.submitting.set(false);
      if (ok) void this.router.navigate(['/characters']);
    });
  }
}

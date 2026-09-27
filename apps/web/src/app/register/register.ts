import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { first } from 'rxjs';
import { GameState } from '../game/game-state';

@Component({ selector: 'app-register', imports: [FormsModule, RouterLink], templateUrl: './register.html', styleUrl: './register.scss' })
export class Register {
  readonly username = signal('');
  readonly password = signal('');
  readonly confirmation = signal('');
  readonly showPassword = signal(false);
  readonly state = inject(GameState);
  readonly submitting = signal(false);
  private readonly router = inject(Router);

  submit() {
    this.state.registerError.set('');
    if (this.password().length < 8) { this.state.registerError.set('A senha precisa ter pelo menos 8 caracteres.'); return; }
    if (this.password() !== this.confirmation()) { this.state.registerError.set('As senhas não conferem.'); return; }
    this.submitting.set(true);
    this.state.register(this.username(), this.password());
    this.state.registerResult$.pipe(first()).subscribe((ok) => { this.submitting.set(false); if (ok) void this.router.navigate(['/characters']); });
  }
}

import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () => import('./login/login').then((m) => m.Login),
  },
  {
    path: 'characters',
    loadComponent: () => import('./characters/characters').then((m) => m.Characters),
  },
  {
    path: 'game',
    loadComponent: () => import('./game/game').then((m) => m.Game),
  },
  { path: '**', redirectTo: 'login' },
];
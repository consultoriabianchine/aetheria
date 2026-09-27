import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./home/home').then((m) => m.Home),
  },
  {
    path: 'login',
    loadComponent: () => import('./login/login').then((m) => m.Login),
  },
  {
    path: 'register',
    loadComponent: () => import('./register/register').then((m) => m.Register),
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

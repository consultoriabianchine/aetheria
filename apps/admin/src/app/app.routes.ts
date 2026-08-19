import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'creatures' },
  {
    path: 'creatures',
    loadComponent: () => import('./creatures/creature-list').then((m) => m.CreatureList),
  },
  {
    path: 'creatures/:id/animation',
    loadComponent: () => import('./creatures/creature-editor').then((m) => m.CreatureEditor),
  },
  {
    path: 'maps',
    loadComponent: () => import('./maps/map-list').then((m) => m.MapList),
  },
  {
    path: 'maps/:id',
    loadComponent: () => import('./maps/map-editor').then((m) => m.MapEditor),
  },
  {
    path: 'hunts',
    loadComponent: () => import('./hunts/hunt-list').then((m) => m.HuntList),
  },
  {
    path: 'hunts/:id',
    loadComponent: () => import('./hunts/hunt-editor').then((m) => m.HuntEditor),
  },
  {
    path: 'combat',
    loadComponent: () => import('./combat/combat-formula-tester').then((m) => m.CombatFormulaTester),
  },
  {
    path: 'items',
    loadComponent: () => import('./items/item-editor').then((m) => m.ItemEditor),
  },
  {
    path: 'outfits',
    loadComponent: () => import('./outfits/outfit-list').then((m) => m.OutfitList),
  },
  {
    path: 'outfits/:id',
    loadComponent: () => import('./outfits/outfit-editor').then((m) => m.OutfitEditor),
  },
  {
    path: 'animation-sets',
    loadComponent: () => import('./animation-sets/animation-set-list').then((m) => m.AnimationSetList),
  },
  {
    path: 'animation-sets/:id',
    loadComponent: () => import('./animation-sets/animation-set-editor').then((m) => m.AnimationSetEditor),
  },
  { path: '**', redirectTo: 'creatures' },
];

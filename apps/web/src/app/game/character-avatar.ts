import { Component, Input } from '@angular/core';
import type { PlayerAppearance } from '@aetheria/types';
import { OutfitThumb } from './outfit-thumb';

@Component({
  selector: 'character-avatar',
  imports: [OutfitThumb],
  template: `
    @if (appearance; as current) {
      <outfit-thumb [outfitId]="current.outfitId" [colors]="current.colors" [size]="size"></outfit-thumb>
    } @else {
      <span class="avatar-fallback" aria-hidden="true">{{ initial() }}</span>
    }
  `,
  styles: `
    :host { display: grid; place-items: center; flex: 0 0 auto; }
    outfit-thumb { display: grid; place-items: center; width: 100%; height: 100%; }
    .avatar-fallback { display: grid; place-items: center; width: 100%; height: 100%; }
  `,
})
export class CharacterAvatar {
  @Input() appearance?: PlayerAppearance | null;
  @Input() name = '';
  @Input() size = 48;

  initial(): string {
    return this.name.trim().charAt(0).toUpperCase() || '?';
  }
}

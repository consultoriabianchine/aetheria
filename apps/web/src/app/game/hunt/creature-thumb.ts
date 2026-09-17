import { AfterViewInit, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { CreatureAssetService } from '../creature-asset.service';

/** Thumbnail de criatura: desenha o frame idle (sul) em um canvas pixelated. */
@Component({
  selector: 'creature-thumb',
  template: `<canvas #cv class="thumb"></canvas>`,
  styles: `
    .thumb { width: 44px; height: 44px; image-rendering: pixelated; }
  `,
})
export class CreatureThumb implements AfterViewInit {
  @Input() creatureId!: number | null;
  @Input() size = 44;
  @ViewChild('cv') cv!: ElementRef<HTMLCanvasElement>;

  constructor(private readonly assets: CreatureAssetService) {}

  async ngAfterViewInit() {
    if (this.creatureId == null) return;
    const config = await this.assets.loadConfig(this.creatureId);
    if (!config) return;
    const img = await this.assets.loadImage(this.creatureId);
    if (!img || !img.width) return;
    const seq =
      config.animations.find((s) => s.animation === 'idle' && s.direction === 'south') ??
      config.animations.find((s) => s.animation === 'idle') ??
      config.animations[0];
    const frame = seq?.frames[0];
    const frameIndex = typeof frame === 'number' ? frame : frame?.frameIndex ?? 0;
    const cols = Math.max(1, config.sheetColumns);
    const sx = (frameIndex % cols) * config.spriteWidth;
    const sy = Math.floor(frameIndex / cols) * config.spriteHeight;
    const canvas = this.cv.nativeElement;
    canvas.width = config.spriteWidth;
    canvas.height = config.spriteHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, config.spriteWidth, config.spriteHeight, 0, 0, canvas.width, canvas.height);
  }
}

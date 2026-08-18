import { AfterViewInit, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { OutfitAssetService } from './outfit-asset.service';

function loadImage(url: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(img);
    img.src = url;
  });
}

/** Thumbnail do outfit: desenha o frame idle (sul) em um canvas pixelated. */
@Component({
  selector: 'outfit-thumb',
  template: `<canvas #cv class="thumb"></canvas>`,
  styles: `
    .thumb { width: 48px; height: 48px; image-rendering: pixelated; }
  `,
})
export class OutfitThumb implements AfterViewInit {
  @Input() outfitId!: number;
  @ViewChild('cv') cv!: ElementRef<HTMLCanvasElement>;

  constructor(private readonly outfits: OutfitAssetService) {}

  async ngAfterViewInit() {
    const data = await this.outfits.loadConfig(this.outfitId);
    if (!data) return;
    const img = await loadImage(this.outfits.textureUrl(this.outfitId), false);
    if (!img || !img.width) return;
    const seq = data.config.animations.find((s) => s.animation === 'idle' && s.direction === 'south') ?? data.config.animations.find((s) => s.animation === 'idle') ?? data.config.animations[0];
    const frameIndex = seq?.frames[0] ?? 0;
    const cols = Math.max(1, data.config.sheetColumns);
    const sx = (frameIndex % cols) * data.config.spriteWidth;
    const sy = Math.floor(frameIndex / cols) * data.config.spriteHeight;
    const canvas = this.cv.nativeElement;
    canvas.width = data.config.spriteWidth;
    canvas.height = data.config.spriteHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, sx, sy, data.config.spriteWidth, data.config.spriteHeight, 0, 0, canvas.width, canvas.height);
  }
}

import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, OnChanges, ViewChild } from '@angular/core';
import { OutfitAssetService } from './outfit-asset.service';
import { APPEARANCE_PALETTE } from '@aetheria/config';
import { recolorCanvas } from '@aetheria/shared';

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
export class OutfitThumb implements AfterViewInit, OnChanges {
  @Input() outfitId!: number;
  @Input() colors?: { head: number; primary: number; secondary: number; detail: number };
  @ViewChild('cv') cv!: ElementRef<HTMLCanvasElement>;

  constructor(private readonly outfits: OutfitAssetService, private readonly changes: ChangeDetectorRef) {}

  ngAfterViewInit() { void this.render(); }
  ngOnChanges() { if (this.cv) void this.render(); }

  private async render() {
    const data = await this.outfits.loadConfig(this.outfitId);
    if (!data) return;
    const img = await loadImage(this.outfits.textureUrl(this.outfitId), true);
    if (!img || !img.width) return;
    const seq = data.config.animations.find((s) => s.animation === 'idle' && s.direction === 'south') ?? data.config.animations.find((s) => s.animation === 'idle') ?? data.config.animations[0];
    const frame = seq?.frames[0];
    const frameDefinition = typeof frame === 'number' ? { frameIndex: frame } : frame;
    const frameIndex = frameDefinition?.frameIndex ?? 0;
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
    if (this.colors && data.supportsColors && frameDefinition?.maskFrameIndex !== undefined) {
      const visual = document.createElement('canvas');
      const mask = document.createElement('canvas');
      visual.width = mask.width = canvas.width;
      visual.height = mask.height = canvas.height;
      visual.getContext('2d')!.drawImage(img, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const maskIndex = frameDefinition.maskFrameIndex;
      const maskX = (maskIndex % cols) * data.config.spriteWidth;
      const maskY = Math.floor(maskIndex / cols) * data.config.spriteHeight;
      mask.getContext('2d')!.drawImage(img, maskX, maskY, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      ctx.drawImage(recolorCanvas(visual, mask, canvas.width, canvas.height, this.colors, APPEARANCE_PALETTE), 0, 0);
    } else {
      ctx.drawImage(img, sx, sy, data.config.spriteWidth, data.config.spriteHeight, 0, 0, canvas.width, canvas.height);
    }
    this.changes.markForCheck();
  }
}

import { AfterViewInit, Component, ElementRef, Input, ViewChild } from '@angular/core';
import { CreatureAssetService } from '../creature-asset.service';

/** Thumbnail de criatura: desenha o frame idle (sul) em um canvas pixelated. */
@Component({
  selector: 'creature-thumb',
  template: `<canvas #cv class="thumb" [style.width.px]="size" [style.height.px]="size"></canvas>`,
  styles: `
    .thumb { display: block; image-rendering: pixelated; }
  `,
})
export class CreatureThumb implements AfterViewInit {
  @Input() creatureId!: number | null;
  @Input() size = 56;
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
    const targetSize = Math.max(1, this.size);
    canvas.width = targetSize;
    canvas.height = targetSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = config.spriteWidth;
    frameCanvas.height = config.spriteHeight;
    const frameContext = frameCanvas.getContext('2d');
    if (!frameContext) return;
    frameContext.drawImage(img, sx, sy, config.spriteWidth, config.spriteHeight, 0, 0, config.spriteWidth, config.spriteHeight);

    const pixels = frameContext.getImageData(0, 0, config.spriteWidth, config.spriteHeight).data;
    let minX = config.spriteWidth;
    let minY = config.spriteHeight;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < config.spriteHeight; y++) {
      for (let x = 0; x < config.spriteWidth; x++) {
        if (pixels[(y * config.spriteWidth + x) * 4 + 3] === 0) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    if (maxX < 0) {
      minX = 0;
      minY = 0;
      maxX = config.spriteWidth - 1;
      maxY = config.spriteHeight - 1;
    }

    const padding = Math.max(2, Math.round(targetSize * 0.06));
    const visibleWidth = maxX - minX + 1;
    const visibleHeight = maxY - minY + 1;
    const scale = Math.min(
      (targetSize - padding * 2) / visibleWidth,
      (targetSize - padding * 2) / visibleHeight,
    );
    const drawWidth = Math.max(1, Math.round(visibleWidth * scale));
    const drawHeight = Math.max(1, Math.round(visibleHeight * scale));
    const drawX = Math.round((targetSize - drawWidth) / 2);
    const drawY = targetSize - drawHeight - padding;

    ctx.drawImage(
      frameCanvas,
      minX,
      minY,
      visibleWidth,
      visibleHeight,
      drawX,
      drawY,
      drawWidth,
      drawHeight,
    );
  }
}

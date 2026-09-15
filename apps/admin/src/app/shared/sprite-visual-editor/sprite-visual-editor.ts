import { AfterViewInit, Component, ElementRef, EventEmitter, Input, Output, ViewChild, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ItemImpactVisual, ItemProjectileVisual, ItemVisualEffects, ProjectileDirection } from '@aetheria/types';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'admin-sprite-visual-editor',
  imports: [FormsModule],
  templateUrl: './sprite-visual-editor.html',
  styles: `
    :host { display: contents; }
    label { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; color: #8fa2b5; font-size: 12px; }
    input, textarea, select { background: #0d141d; color: #e6eef6; border: 1px solid #2b3546; border-radius: 6px; padding: 8px; }
    .wide { grid-column: 1 / -1; }
    .visual-editor { display: grid; grid-template-columns: minmax(300px, 1fr) 260px; gap: 12px; align-items: start; }
    .sheet-box { overflow: auto; max-height: 360px; border: 1px solid #263244; border-radius: 8px; background: #0b111a; }
    canvas { display: block; }
    .dir-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
    .dir-btn { display: flex; justify-content: space-between; padding: 7px 8px; text-align: left; border: 1px solid #34445c; background: #1b2636; color: #d9e6f2; border-radius: 6px; cursor: pointer; }
    .dir-btn.active { border-color: #7fd0a0; color: #7fd0a0; }
    .mini-hint { color: #8fa2b5; font-size: 11px; margin: 4px 0 8px; }
  `,
})
export class SpriteVisualEditor implements AfterViewInit {
  @ViewChild('projectileCanvas') projectileCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('impactCanvas') impactCanvas?: ElementRef<HTMLCanvasElement>;

  @Output() readonly visualChange = new EventEmitter<ItemVisualEffects | null>();

  @Input() showProjectile = true;
  @Input() showImpact = true;

  private visualState = signal<ItemVisualEffects>({});
  private emitted: ItemVisualEffects | null = null;

  @Input() set visual(value: ItemVisualEffects | null | undefined) {
    if (value === this.emitted) return;
    this.emitted = null;
    this.visualState.set({ ...(value ?? {}) });
    void this.loadVisualSheets();
  }

  readonly projectileDirections: ProjectileDirection[] = ['north', 'northEast', 'east', 'southEast', 'south', 'southWest', 'west', 'northWest'];
  readonly projectileDirectionLabel: Record<ProjectileDirection, string> = {
    north: '↑ North',
    northEast: '↗ NorthEast',
    east: '→ East',
    southEast: '↘ SouthEast',
    south: '↓ South',
    southWest: '↙ SouthWest',
    west: '← West',
    northWest: '↖ NorthWest',
  };
  readonly selectedProjectileDirection = signal<ProjectileDirection>('south');
  readonly error = signal<string | null>(null);

  private projectileImage: HTMLImageElement | null = null;
  private impactImage: HTMLImageElement | null = null;

  constructor(private readonly api: ApiService) {}

  ngAfterViewInit() {
    void this.loadVisualSheets();
  }

  projectile(): ItemProjectileVisual {
    return this.visualState().projectile ?? blankProjectile();
  }

  impact(): ItemImpactVisual {
    return this.visualState().impact ?? blankImpact();
  }

  private emit() {
    const value = this.visualState();
    this.emitted = value;
    this.visualChange.emit(value);
  }

  patchProjectile(patch: Partial<ItemProjectileVisual>) {
    const projectile = { ...this.projectile(), ...patch };
    this.visualState.update((v) => ({ ...v, projectile }));
    this.emit();
    if ('sprite' in patch || 'frameWidth' in patch || 'frameHeight' in patch) void this.loadProjectileSheet();
    this.redrawVisuals();
  }

  patchProjectileFrame(direction: ProjectileDirection, frame: number) {
    const projectile = this.projectile();
    this.patchProjectile({ frames: { ...projectile.frames, [direction]: frame } });
  }

  patchImpact(patch: Partial<ItemImpactVisual>) {
    const impact = { ...this.impact(), ...patch };
    this.visualState.update((v) => ({ ...v, impact }));
    this.emit();
    if ('sprite' in patch || 'frameWidth' in patch || 'frameHeight' in patch) void this.loadImpactSheet();
    this.redrawVisuals();
  }

  setImpactFrames(value: string) {
    this.patchImpact({ frames: value.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v)) });
  }

  async onProjectileAssetFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const res = await this.api.uploadSpriteAsset(file);
      this.patchProjectile({ spriteAssetId: res.spriteAssetId, sprite: '' });
      await this.loadProjectileSheet();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  async onImpactAssetFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const res = await this.api.uploadSpriteAsset(file);
      this.patchImpact({ spriteAssetId: res.spriteAssetId, sprite: '' });
      await this.loadImpactSheet();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  async loadVisualSheets() {
    await Promise.all([this.loadProjectileSheet(), this.loadImpactSheet()]);
  }

  async loadProjectileSheet() {
    const projectile = this.projectile();
    this.projectileImage = await this.loadImage(projectile.sprite, projectile.spriteAssetId);
    this.redrawVisuals();
  }

  async loadImpactSheet() {
    const impact = this.impact();
    this.impactImage = await this.loadImage(impact.sprite, impact.spriteAssetId);
    this.redrawVisuals();
  }

  selectProjectileDirection(direction: ProjectileDirection) {
    this.selectedProjectileDirection.set(direction);
    this.redrawVisuals();
  }

  onProjectileSheetClick(event: MouseEvent) {
    const frame = this.frameAt(event, this.projectileCanvas?.nativeElement, this.projectile(), this.projectileImage);
    if (frame === null) return;
    this.patchProjectileFrame(this.selectedProjectileDirection(), frame);
  }

  onImpactSheetClick(event: MouseEvent) {
    const frame = this.frameAt(event, this.impactCanvas?.nativeElement, this.impact(), this.impactImage);
    if (frame === null) return;
    const frames = this.impact().frames;
    this.patchImpact({ frames: event.shiftKey ? (frames.includes(frame) ? frames.filter((f) => f !== frame) : [...frames, frame].sort((a, b) => a - b)) : [frame] });
  }

  private async loadImage(src: string, spriteAssetId?: number): Promise<HTMLImageElement | null> {
    if (!src.trim() && !spriteAssetId) return null;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = spriteAssetId ? `${this.api.baseUrl()}/assets/sprite-assets/${spriteAssetId}` : this.assetPath(src);
    });
  }

  private redrawVisuals() {
    setTimeout(() => {
      this.drawSheet(this.projectileCanvas?.nativeElement, this.projectileImage, this.projectile().frameWidth, this.projectile().frameHeight, new Set(Object.values(this.projectile().frames)), this.projectile().frames[this.selectedProjectileDirection()]);
      this.drawSheet(this.impactCanvas?.nativeElement, this.impactImage, this.impact().frameWidth, this.impact().frameHeight, new Set(this.impact().frames));
    });
  }

  private drawSheet(canvas: HTMLCanvasElement | undefined, image: HTMLImageElement | null, frameWidth: number, frameHeight: number, selected: Set<number>, active?: number) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!image || !image.complete || !image.naturalWidth || !image.naturalHeight || frameWidth <= 0 || frameHeight <= 0) {
      canvas.width = 280;
      canvas.height = 90;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#8fa2b5';
      ctx.font = '12px monospace';
      ctx.fillText('Informe um sprite/path válido.', 12, 45);
      return;
    }
    const zoom = 2;
    const cols = Math.max(1, Math.floor(image.naturalWidth / frameWidth));
    const rows = Math.max(1, Math.floor(image.naturalHeight / frameHeight));
    canvas.width = cols * frameWidth * zoom;
    canvas.height = rows * frameHeight * zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    ctx.font = '10px monospace';
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const frame = y * cols + x;
        const px = x * frameWidth * zoom;
        const py = y * frameHeight * zoom;
        ctx.strokeStyle = active === frame ? '#f0c14b' : selected.has(frame) ? '#7fd0a0' : 'rgba(255,255,255,0.22)';
        ctx.lineWidth = active === frame ? 3 : selected.has(frame) ? 2 : 1;
        ctx.strokeRect(px + 0.5, py + 0.5, frameWidth * zoom - 1, frameHeight * zoom - 1);
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(px + 2, py + 2, 24, 13);
        ctx.fillStyle = '#d9e6f2';
        ctx.fillText(String(frame), px + 5, py + 12);
      }
    }
  }

  private frameAt(event: MouseEvent, canvas: HTMLCanvasElement | undefined, visual: { frameWidth: number; frameHeight: number }, image: HTMLImageElement | null): number | null {
    if (!canvas || !image || visual.frameWidth <= 0 || visual.frameHeight <= 0) return null;
    const rect = canvas.getBoundingClientRect();
    const cols = Math.max(1, Math.floor(image.naturalWidth / visual.frameWidth));
    const rows = Math.max(1, Math.floor(image.naturalHeight / visual.frameHeight));
    const x = Math.floor((event.clientX - rect.left) / (rect.width / cols));
    const y = Math.floor((event.clientY - rect.top) / (rect.height / rows));
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    return y * cols + x;
  }

  private assetPath(src: string): string {
    if (/^https?:\/\//.test(src) || src.startsWith('/') || src.startsWith('assets/')) return src;
    return `assets/effects/${src}`;
  }
}

function blankProjectile(): ItemProjectileVisual {
  return {
    sprite: '',
    frameWidth: 32,
    frameHeight: 32,
    speedPxPerSecond: 520,
    frames: { north: 0, northEast: 1, east: 2, southEast: 3, south: 4, southWest: 5, west: 6, northWest: 7 },
  };
}

function blankImpact(): ItemImpactVisual {
  return { sprite: '', frameWidth: 32, frameHeight: 32, frames: [0], fps: 12 };
}

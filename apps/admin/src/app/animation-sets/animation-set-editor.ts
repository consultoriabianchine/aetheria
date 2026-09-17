import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { AnimationDirection, AnimationFrameDefinition, AnimationSequence, CreatureAnimationType } from '@aetheria/types';
import { APPEARANCE_PALETTE } from '@aetheria/config';
import { recolorCanvas } from '@aetheria/shared';
import { ApiService, type AdminAnimationSetConfig } from '../core/api.service';

const ANIMATION_TYPES: CreatureAnimationType[] = ['idle', 'walk', 'attack', 'cast', 'hit', 'death', 'spawn'];
const DIRECTIONS: AnimationDirection[] = ['north', 'east', 'south', 'west'];
const DIRECTION_LABEL: Record<AnimationDirection, string> = { north: '↑', east: '→', south: '↓', west: '←' };

@Component({
  selector: 'admin-animation-set-editor',
  imports: [RouterLink],
  templateUrl: './animation-set-editor.html',
  styleUrls: ['./animation-set-editor.scss'],
})
export class AnimationSetEditor implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('sheetCanvas') sheetCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewCanvas') previewCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('tilePreviewCanvas') tilePreviewCanvas!: ElementRef<HTMLCanvasElement>;

  readonly name = signal('');
  readonly spriteAssetId = signal<number>(0);
  readonly spriteWidth = signal(32);
  readonly spriteHeight = signal(32);
  readonly sheetColumns = signal(16);
  readonly sheetRows = signal(45);
  readonly supportsColorization = signal(false);
  readonly colorMaskMode = signal<'none' | 'paired_frames' | 'separate_asset'>('none');
  readonly sequences = signal<AnimationSequence[]>([]);
  readonly selectedSeq = signal(-1);
  readonly selectedFrames = signal<number[]>([]);
  readonly selectedTimelineFrame = signal(-1);
  readonly selectionMode = signal<'visual' | 'mask'>('visual');
  readonly previewMode = signal<'visual' | 'mask' | 'colorized'>('visual');
  readonly testColors = signal({ head: '#f2c14e', primary: '#d94f4f', secondary: '#4f86d9', detail: '#f4f4f4' });
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);
  readonly zoom = signal(4);
  readonly playing = signal(false);
  readonly showGrid = signal(true);

  // posicionamento do sprite (mesmo modelo do editor de criaturas)
  readonly activeTab = signal<'animation' | 'positioning'>('animation');
  readonly anchorX = signal(16);
  readonly anchorY = signal(32);
  readonly offsetX = signal(0);
  readonly offsetY = signal(0);
  readonly visualBoundsWidth = signal(32);
  readonly visualBoundsHeight = signal(32);
  readonly bodyWidth = signal(32);
  readonly bodyHeight = signal(32);
  readonly bodyOffsetX = signal(0);
  readonly bodyOffsetY = signal(0);
  readonly projectileOriginX = signal(0);
  readonly projectileOriginY = signal(0);

  // preview 5x5
  readonly showGridPreview = signal(true);
  readonly showRenderBounds = signal(true);
  readonly showVisualBounds = signal(true);
  readonly showBody = signal(true);
  readonly showHudAnchor = signal(true);
  readonly showAnchor = signal(true);
  readonly showProjectileOrigin = signal(true);
  readonly previewAnim = signal<CreatureAnimationType>('idle');
  readonly previewBaseX = signal(2);
  readonly previewBaseY = signal(2);

  readonly animations = ANIMATION_TYPES;
  readonly directions = DIRECTIONS;
  readonly directionLabel = DIRECTION_LABEL;
  readonly palette = APPEARANCE_PALETTE;
  readonly newAnim = signal<CreatureAnimationType>('walk');
  readonly newDir = signal<AnimationDirection>('south');

  private sheetImage: HTMLImageElement | null = null;
  private raf = 0;
  private lastTick = 0;
  private elapsed = 0;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  get id(): string {
    return this.route.snapshot.paramMap.get('id') ?? 'new';
  }

  get totalFrames(): number {
    return this.sheetColumns() * this.sheetRows();
  }

  get currentSequence(): AnimationSequence | null {
    const i = this.selectedSeq();
    return i >= 0 && i < this.sequences().length ? this.sequences()[i] : null;
  }

  async ngOnInit() {
    const qAsset = Number(this.route.snapshot.queryParamMap.get('spriteAssetId'));
    if (qAsset) this.spriteAssetId.set(qAsset);

    if (this.id !== 'new') {
      try {
        const set = await this.api.getAnimationSet(Number(this.id));
        this.name.set(set.name);
        if (set.spriteAssetId) this.spriteAssetId.set(set.spriteAssetId);
        this.spriteWidth.set(set.config.spriteWidth);
        this.spriteHeight.set(set.config.spriteHeight);
        this.sheetColumns.set(set.config.sheetColumns);
        this.sheetRows.set(set.config.sheetRows);
        this.supportsColorization.set(set.config.supportsColorization ?? false);
        this.colorMaskMode.set(set.config.colorMaskMode ?? 'none');
        this.anchorX.set(set.config.anchor?.x ?? set.config.spriteWidth / 2);
        this.anchorY.set(set.config.anchor?.y ?? set.config.spriteHeight);
        this.offsetX.set(set.config.offsetX ?? 0);
        this.offsetY.set(set.config.offsetY ?? 0);
        this.visualBoundsWidth.set(set.config.visualBounds?.width ?? set.config.spriteWidth);
        this.visualBoundsHeight.set(set.config.visualBounds?.height ?? set.config.spriteHeight);
        this.bodyWidth.set(set.config.bodyWidth ?? set.config.spriteWidth);
        this.bodyHeight.set(set.config.bodyHeight ?? set.config.spriteHeight);
        this.bodyOffsetX.set(set.config.bodyOffsetX ?? 0);
        this.bodyOffsetY.set(set.config.bodyOffsetY ?? 0);
        this.projectileOriginX.set(set.config.sockets?.projectileOrigin?.x ?? set.config.spriteWidth / 2);
        this.projectileOriginY.set(set.config.sockets?.projectileOrigin?.y ?? set.config.spriteHeight / 2);
        this.sequences.set((structuredClone(set.config.animations) as AnimationSequence[]).map((seq) => ({ ...seq, frames: seq.frames.map((frame) => this.frameDefinition(frame)) })));
      } catch (e) {
        this.error.set((e as Error).message);
      }
    }

    await this.loadSheet();
    this.redraw();
  }

  ngAfterViewInit() {
    this.redraw();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
  }

  async loadSheet() {
    const id = this.spriteAssetId();
    if (!id) { this.sheetImage = null; return; }
    this.sheetImage = await new Promise<HTMLImageElement>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img);
      img.src = `${this.api.baseUrl()}/assets/sprite-assets/${id}`;
    });
  }

  async onAssetFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const res = await this.api.uploadSpriteAsset(file);
      this.spriteAssetId.set(res.spriteAssetId);
      this.dirty.set(true);
      await this.loadSheet();
      this.redraw();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  // ------------------------------------------------------------------ grid

  frameRect(index: number) {
    const w = this.spriteWidth();
    const h = this.spriteHeight();
    const cols = this.sheetColumns();
    return { sx: (index % cols) * w, sy: Math.floor(index / cols) * h, sw: w, sh: h };
  }

  onSheetClick(event: MouseEvent) {
    const canvas = this.sheetCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (rect.width / this.sheetColumns()));
    const y = Math.floor((event.clientY - rect.top) / (rect.height / this.sheetRows()));
    const index = y * this.sheetColumns() + x;
    if (index >= this.totalFrames) return;
    if (this.selectionMode() === 'mask' && this.selectedSeq() >= 0 && this.selectedTimelineFrame() >= 0) {
      const seq = this.currentSequence;
      if (seq) {
        const frames = seq.frames.map((frame, i) => i === this.selectedTimelineFrame() ? { ...this.frameDefinition(frame), maskFrameIndex: index } : this.frameDefinition(frame));
        this.updateSequence(this.selectedSeq(), { ...seq, frames });
        this.selectionMode.set('visual');
        this.redrawSheet();
        return;
      }
    }
    const sel = this.selectedFrames();
    if (event.shiftKey) {
      this.selectedFrames.set(sel.includes(index) ? sel.filter((i) => i !== index) : [...sel, index].sort((a, b) => a - b));
    } else {
      this.selectedFrames.set([index]);
    }
    this.redrawSheet();
  }

  clearSelection() {
    this.selectedFrames.set([]);
    this.redrawSheet();
  }

  onGridChange() {
    this.dirty.set(true);
    this.redraw();
  }

  // ------------------------------------------------------------- sequences

  addSequence() {
    const seq: AnimationSequence = { animation: this.newAnim(), direction: this.newDir(), frames: [], frameDurationMs: 140, loop: true };
    this.sequences.update((list) => [...list, seq]);
    this.selectedSeq.set(this.sequences().length - 1);
    this.dirty.set(true);
  }

  selectSequence(i: number) {
    this.selectedSeq.set(i);
  }

  removeSequence(i: number) {
    this.sequences.update((list) => list.filter((_, idx) => idx !== i));
    this.selectedSeq.set(-1);
    this.dirty.set(true);
  }

  addSelectedToTimeline() {
    const i = this.selectedSeq();
    const seq = this.currentSequence;
    if (i < 0 || !seq) return;
    this.updateSequence(i, { ...seq, frames: [...seq.frames, ...this.selectedFrames().map((frame) => ({ frameIndex: frame }))] });
  }

  setTimelineFrames(frames: AnimationFrameDefinition[]) {
    const i = this.selectedSeq();
    const seq = this.currentSequence;
    if (!seq) return;
    this.updateSequence(i, { ...seq, frames });
  }

  moveFrame(pos: number, dir: -1 | 1) {
    const i = this.selectedSeq();
    const seq = this.currentSequence;
    if (!seq) return;
    const frames = [...seq.frames];
    const target = pos + dir;
    if (target < 0 || target >= frames.length) return;
    [frames[pos], frames[target]] = [frames[target], frames[pos]];
    this.updateSequence(i, { ...seq, frames });
  }

  removeFrame(pos: number) {
    const i = this.selectedSeq();
    const seq = this.currentSequence;
    if (!seq) return;
    this.updateSequence(i, { ...seq, frames: seq.frames.filter((_, idx) => idx !== pos) });
  }

  duplicateFrame(pos: number) {
    const i = this.selectedSeq();
    const seq = this.currentSequence;
    if (!seq) return;
    const frames = [...seq.frames];
    frames.splice(pos + 1, 0, frames[pos]);
    this.updateSequence(i, { ...seq, frames });
  }

  selectTimelineFrame(pos: number) {
    this.selectedTimelineFrame.set(pos);
    this.selectionMode.set('visual');
    this.redrawSheet();
    this.drawPreview();
  }

  selectMask() { if (this.selectedTimelineFrame() >= 0) this.selectionMode.set('mask'); }

  clearMask(pos = this.selectedTimelineFrame()) {
    const seq = this.currentSequence;
    if (!seq || pos < 0 || pos >= seq.frames.length) return;
    this.updateSequence(this.selectedSeq(), { ...seq, frames: seq.frames.map((frame, i) => i === pos ? { ...this.frameDefinition(frame), maskFrameIndex: undefined } : this.frameDefinition(frame)) });
  }

  autoPairSequence() {
    const seq = this.currentSequence;
    if (!seq) return;
    this.updateSequence(this.selectedSeq(), { ...seq, frames: seq.frames.map((frame) => { const visual = this.frameDefinition(frame); return { ...visual, maskFrameIndex: visual.frameIndex + 1 }; }) });
  }

  autoPairAllSequences() {
    this.sequences.update((sequences) => sequences.map((sequence) => ({
      ...sequence,
      frames: sequence.frames.map((frame) => {
        const visual = this.frameDefinition(frame);
        return { ...visual, maskFrameIndex: visual.frameIndex + 1 };
      }),
    })));
    this.dirty.set(true);
    this.redraw();
  }

  setTestColor(slot: 'head' | 'primary' | 'secondary' | 'detail', color: string) {
    this.testColors.update((colors) => ({ ...colors, [slot]: color }));
    this.drawPreview();
  }

  frameDefinition(frame: AnimationFrameDefinition | number): AnimationFrameDefinition { return typeof frame === 'number' ? { frameIndex: frame } : frame; }
  frameIndex(frame: AnimationFrameDefinition | number): number { return this.frameDefinition(frame).frameIndex; }

  updateSequence(i: number, seq: AnimationSequence) {
    this.sequences.update((list) => list.map((s, idx) => (idx === i ? seq : s)));
    this.dirty.set(true);
  }

  setSeqProp(patch: Partial<AnimationSequence>) {
    const i = this.selectedSeq();
    const seq = this.currentSequence;
    if (!seq) return;
    this.updateSequence(i, { ...seq, ...patch });
  }

  // ---------------------------------------------------------- positioning

  openPositioning() {
    this.activeTab.set('positioning');
    setTimeout(() => this.drawTilePreview(), 0);
  }

  centralizeAnchor() {
    this.anchorX.set(this.spriteWidth() / 2);
    this.anchorY.set(this.spriteHeight());
    this.dirty.set(true);
    this.drawTilePreview();
  }

  setProjectileOriginX(value: number) {
    this.projectileOriginX.set(Math.round(value));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  setProjectileOriginY(value: number) {
    this.projectileOriginY.set(Math.round(value));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  centralizeProjectileOrigin() {
    this.projectileOriginX.set(this.spriteWidth() / 2);
    this.projectileOriginY.set(this.spriteHeight() / 2);
    this.dirty.set(true);
    this.drawTilePreview();
  }

  onTilePreviewClick(event: MouseEvent) {
    const canvas = this.tilePreviewCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (event.clientX - rect.left) * scaleX;
    const my = (event.clientY - rect.top) * scaleY;
    const TILE = 32;
    const PAD = 70;
    const bx = this.previewBaseX();
    const by = this.previewBaseY();
    const basePxX = PAD + bx * TILE + TILE / 2;
    const basePxY = PAD + by * TILE + TILE;
    const drawX = basePxX + this.offsetX() - this.anchorX();
    const drawY = basePxY + this.offsetY() - this.anchorY();
    this.projectileOriginX.set(Math.round(mx - drawX));
    this.projectileOriginY.set(Math.round(my - drawY));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  setVisualBoundsWidth(value: number) { this.visualBoundsWidth.set(Math.max(1, Math.round(value))); this.dirty.set(true); this.drawTilePreview(); }
  setVisualBoundsHeight(value: number) { this.visualBoundsHeight.set(Math.max(1, Math.round(value))); this.dirty.set(true); this.drawTilePreview(); }
  setBodyWidth(value: number) { this.bodyWidth.set(Math.max(1, Math.round(value))); this.dirty.set(true); this.drawTilePreview(); }
  setBodyHeight(value: number) { this.bodyHeight.set(Math.max(1, Math.round(value))); this.dirty.set(true); this.drawTilePreview(); }
  setBodyOffsetX(value: number) { this.bodyOffsetX.set(Math.round(value)); this.dirty.set(true); this.drawTilePreview(); }
  setBodyOffsetY(value: number) { this.bodyOffsetY.set(Math.round(value)); this.dirty.set(true); this.drawTilePreview(); }

  movePreview(dx: number, dy: number) {
    this.previewBaseX.set(Math.max(0, Math.min(4, this.previewBaseX() + dx)));
    this.previewBaseY.set(Math.max(0, Math.min(4, this.previewBaseY() + dy)));
    this.drawTilePreview();
  }

  setPreviewAnim(type: CreatureAnimationType) {
    this.previewAnim.set(type);
    this.drawTilePreview();
  }

  private previewFrameIndex(): number {
    const seq = this.sequences().find((s) => s.animation === this.previewAnim());
    if (!seq || seq.frames.length === 0) return -1;
    return this.frameIndex(seq.frames[0]);
  }

  /** Preview 5×5 tiles com debug (grid/bounds/body/anchor/projectile origin). */
  drawTilePreview() {
    if (!this.tilePreviewCanvas) return;
    const canvas = this.tilePreviewCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const TILE = 32;
    const GRID = 5;
    const PAD = 70;
    canvas.width = 300;
    canvas.height = 300;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#10151e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let ty = 0; ty < GRID; ty++) {
      for (let tx = 0; tx < GRID; tx++) {
        ctx.fillStyle = (tx + ty) % 2 === 0 ? '#3f7a35' : '#4a8a3d';
        ctx.fillRect(PAD + tx * TILE, PAD + ty * TILE, TILE, TILE);
        if (this.showGridPreview()) {
          ctx.strokeStyle = 'rgba(255,255,255,0.18)';
          ctx.lineWidth = 1;
          ctx.strokeRect(PAD + tx * TILE + 0.5, PAD + ty * TILE + 0.5, TILE, TILE);
        }
      }
    }

    const bx = this.previewBaseX();
    const by = this.previewBaseY();
    const basePxX = PAD + bx * TILE + TILE / 2;
    const basePxY = PAD + by * TILE + TILE;

    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD + bx * TILE, PAD + by * TILE, TILE, TILE);

    const drawX = basePxX + this.offsetX() - this.anchorX();
    const drawY = basePxY + this.offsetY() - this.anchorY();

    if (this.showRenderBounds()) {
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 1;
      ctx.strokeRect(drawX, drawY, this.spriteWidth(), this.spriteHeight());
    }

    if (this.showVisualBounds() && (this.visualBoundsWidth() !== this.spriteWidth() || this.visualBoundsHeight() !== this.spriteHeight())) {
      ctx.strokeStyle = '#aa00ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(drawX, drawY, this.visualBoundsWidth(), this.visualBoundsHeight());
    }

    const bodyX = basePxX + this.offsetX() + this.bodyOffsetX() - this.bodyWidth() / 2;
    const bodyY = basePxY + this.offsetY() + this.bodyOffsetY() - this.bodyHeight();

    if (this.showBody() && (this.bodyWidth() !== this.spriteWidth() || this.bodyHeight() !== this.spriteHeight() || this.bodyOffsetX() !== 0 || this.bodyOffsetY() !== 0)) {
      ctx.strokeStyle = '#ff8c00';
      ctx.lineWidth = 1;
      ctx.strokeRect(bodyX, bodyY, this.bodyWidth(), this.bodyHeight());
    }

    const cellIndex = this.previewFrameIndex();
    if (this.sheetImage && cellIndex >= 0) {
      const r = this.frameRect(cellIndex);
      ctx.drawImage(this.sheetImage, r.sx, r.sy, r.sw, r.sh, drawX, drawY, this.spriteWidth(), this.spriteHeight());
    }

    if (this.showHudAnchor()) {
      const bodyCenterX = basePxX + this.offsetX() + this.bodyOffsetX();
      const hasBody = this.bodyHeight() !== this.spriteHeight();
      const barMargin = hasBody ? 5 : 4;
      const nameMargin = 12;
      const barHeight = 4;
      const barY = bodyY - barMargin;
      const nameY = barY - barHeight - nameMargin;
      const halfW = this.bodyWidth() / 2;
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(bodyCenterX - halfW, barY);
      ctx.lineTo(bodyCenterX + halfW, barY);
      ctx.moveTo(bodyCenterX - halfW, nameY);
      ctx.lineTo(bodyCenterX + halfW, nameY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (this.showAnchor()) {
      ctx.strokeStyle = '#0000ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(basePxX + this.offsetX() - 4, basePxY + this.offsetY());
      ctx.lineTo(basePxX + this.offsetX() + 4, basePxY + this.offsetY());
      ctx.moveTo(basePxX + this.offsetX(), basePxY + this.offsetY() - 4);
      ctx.lineTo(basePxX + this.offsetX(), basePxY + this.offsetY() + 4);
      ctx.stroke();
    }

    if (this.showProjectileOrigin()) {
      const pox = drawX + this.projectileOriginX();
      const poy = drawY + this.projectileOriginY();
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(pox - 2, poy - 2, 4, 4);
    }
  }

  // ---------------------------------------------------------------- save

  async save() {
    this.error.set(null);
    this.saving.set(true);
    try {
      const config: AdminAnimationSetConfig = {
        spriteWidth: this.spriteWidth(),
        spriteHeight: this.spriteHeight(),
        sheetColumns: this.sheetColumns(),
        sheetRows: this.sheetRows(),
        anchor: { x: this.anchorX(), y: this.anchorY() },
        offsetX: this.offsetX(),
         offsetY: this.offsetY(),
         supportsColorization: this.supportsColorization(),
         colorMaskMode: this.colorMaskMode(),
         animations: this.sequences(),
      };
      if (this.visualBoundsWidth() !== this.spriteWidth() || this.visualBoundsHeight() !== this.spriteHeight()) {
        config.visualBounds = { width: this.visualBoundsWidth(), height: this.visualBoundsHeight() };
      }
      if (this.bodyWidth() !== this.spriteWidth()) config.bodyWidth = this.bodyWidth();
      if (this.bodyHeight() !== this.spriteHeight()) config.bodyHeight = this.bodyHeight();
      if (this.bodyOffsetX() !== 0) config.bodyOffsetX = this.bodyOffsetX();
      if (this.bodyOffsetY() !== 0) config.bodyOffsetY = this.bodyOffsetY();
      if (this.projectileOriginX() !== this.spriteWidth() / 2 || this.projectileOriginY() !== this.spriteHeight() / 2) {
        config.sockets = { projectileOrigin: { x: this.projectileOriginX(), y: this.projectileOriginY() } };
      }
      const res = await this.api.saveAnimationSet({ id: this.id === 'new' ? undefined : Number(this.id), name: this.name().trim() || 'Animation Set', spriteAssetId: this.spriteAssetId() || undefined, config });
      this.dirty.set(false);
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 2000);
      if (this.id === 'new') void this.router.navigate(['/animation-sets', res.animationSetId], { queryParams: { spriteAssetId: this.spriteAssetId() || undefined } });
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  // ---------------------------------------------------------------- preview

  togglePlay() {
    this.playing.set(!this.playing());
    if (this.playing()) {
      this.lastTick = performance.now();
      this.elapsed = 0;
      this.loop();
    }
  }

  stop() {
    this.playing.set(false);
    this.elapsed = 0;
    this.drawPreview();
  }

  private loop() {
    if (!this.playing()) return;
    const now = performance.now();
    this.elapsed += now - this.lastTick;
    this.lastTick = now;
    this.drawPreview();
    this.raf = requestAnimationFrame(() => this.loop());
  }

  private computeFrameIndex(seq: AnimationSequence, elapsed: number): number {
    const len = seq.frames.length;
    if (len === 0) return -1;
    const dur = Math.max(1, seq.frameDurationMs);
    const raw = Math.floor(elapsed / dur);
    return seq.loop ? raw % len : Math.min(raw, len - 1);
  }

  // ---------------------------------------------------------------- canvas

  redraw() {
    this.redrawSheet();
    this.drawPreview();
    this.drawTilePreview();
  }

  private redrawSheet() {
    if (!this.sheetCanvas) return;
    const canvas = this.sheetCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = this.spriteWidth();
    const h = this.spriteHeight();
    const cols = this.sheetColumns();
    const rows = this.sheetRows();
    canvas.width = w * cols;
    canvas.height = h * rows;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#10151e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
     if (this.sheetImage) ctx.drawImage(this.sheetImage, 0, 0, canvas.width, canvas.height);
     const visualFrames = new Set(this.sequences().flatMap((seq) => seq.frames.map((frame) => this.frameIndex(frame))));
     const maskFrames = new Set(this.sequences().flatMap((seq) => seq.frames.map((frame) => this.frameDefinition(frame).maskFrameIndex).filter((frame): frame is number => frame !== undefined)));
     ctx.font = 'bold 10px monospace';
     for (const idx of visualFrames) {
       const r = this.frameRect(idx);
       ctx.strokeStyle = '#3c9cff';
       ctx.lineWidth = 2;
       ctx.strokeRect(r.sx + 1, r.sy + 1, r.sw - 2, r.sh - 2);
       ctx.fillStyle = '#3c9cff';
       ctx.fillText('V', r.sx + 2, r.sy + 10);
     }
     for (const idx of maskFrames) {
       const r = this.frameRect(idx);
       ctx.strokeStyle = '#ff4fc3';
       ctx.lineWidth = 2;
       ctx.strokeRect(r.sx + 1, r.sy + 1, r.sw - 2, r.sh - 2);
       ctx.fillStyle = '#ff4fc3';
       ctx.fillText('M', r.sx + 2, r.sy + 10);
     }
     for (const idx of this.selectedFrames()) {
      const r = this.frameRect(idx);
      ctx.fillStyle = 'rgba(120, 200, 160, 0.25)';
      ctx.fillRect(r.sx, r.sy, r.sw, r.sh);
    }
    if (this.showGrid()) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= cols; x++) { ctx.beginPath(); ctx.moveTo(x * w + 0.5, 0); ctx.lineTo(x * w + 0.5, canvas.height); ctx.stroke(); }
      for (let y = 0; y <= rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * h + 0.5); ctx.lineTo(canvas.width, y * h + 0.5); ctx.stroke(); }
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.font = '10px monospace';
      for (let i = 0; i < this.totalFrames; i++) {
        const r = this.frameRect(i);
        ctx.fillText(String(i), r.sx + 2, r.sy + 10);
      }
    }
  }

  drawPreview() {
    if (!this.previewCanvas) return;
    const canvas = this.previewCanvas.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = this.spriteWidth();
    const h = this.spriteHeight();
    const zoom = this.zoom();
    canvas.width = w * zoom;
    canvas.height = h * zoom;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let cellIndex = -1;
    const seq = this.currentSequence;
    if (seq && seq.frames.length > 0) {
      const pos = this.playing() ? this.computeFrameIndex(seq, this.elapsed) : 0;
       const frame = this.frameDefinition(seq.frames[pos]);
       if (this.previewMode() === 'colorized' && frame.maskFrameIndex !== undefined) {
         this.drawColorizedPreview(ctx, frame.frameIndex, frame.maskFrameIndex, w * zoom, h * zoom);
         return;
       }
       cellIndex = this.previewMode() === 'mask' ? (frame.maskFrameIndex ?? -1) : frame.frameIndex;
    }
    if (this.sheetImage && cellIndex >= 0) {
      const r = this.frameRect(cellIndex);
      ctx.drawImage(this.sheetImage, r.sx, r.sy, r.sw, r.sh, 0, 0, w * zoom, h * zoom);
    } else {
      ctx.fillStyle = '#10151e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
     }
   }

  private drawColorizedPreview(ctx: CanvasRenderingContext2D, visualIndex: number, maskIndex: number, width: number, height: number) {
    if (!this.sheetImage) return;
    const frameW = this.spriteWidth();
    const frameH = this.spriteHeight();
    const visual = document.createElement('canvas');
    const mask = document.createElement('canvas');
    visual.width = mask.width = frameW;
    visual.height = mask.height = frameH;
    const visualCtx = visual.getContext('2d')!;
    const maskCtx = mask.getContext('2d')!;
    const vr = this.frameRect(visualIndex);
    const mr = this.frameRect(maskIndex);
    visualCtx.drawImage(this.sheetImage, vr.sx, vr.sy, frameW, frameH, 0, 0, frameW, frameH);
    maskCtx.drawImage(this.sheetImage, mr.sx, mr.sy, frameW, frameH, 0, 0, frameW, frameH);
    const colors = this.testColors();
    const recolored = recolorCanvas(visual, mask, frameW, frameH, { head: 1, primary: 2, secondary: 3, detail: 4 }, ['#ffffff', colors.head, colors.primary, colors.secondary, colors.detail]);
    ctx.drawImage(recolored, 0, 0, frameW, frameH, 0, 0, width, height);
  }
}

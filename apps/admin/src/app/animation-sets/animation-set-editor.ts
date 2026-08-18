import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { AnimationDirection, AnimationSequence, CreatureAnimationType } from '@aetheria/types';
import { ApiService } from '../core/api.service';

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

  readonly name = signal('');
  readonly spriteAssetId = signal<number>(0);
  readonly spriteWidth = signal(32);
  readonly spriteHeight = signal(32);
  readonly sheetColumns = signal(16);
  readonly sheetRows = signal(45);
  readonly sequences = signal<AnimationSequence[]>([]);
  readonly selectedSeq = signal(-1);
  readonly selectedFrames = signal<number[]>([]);
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly error = signal<string | null>(null);
  readonly zoom = signal(4);
  readonly playing = signal(false);
  readonly showGrid = signal(true);

  readonly animations = ANIMATION_TYPES;
  readonly directions = DIRECTIONS;
  readonly directionLabel = DIRECTION_LABEL;
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
        this.sequences.set(structuredClone(set.config.animations as AnimationSequence[]));
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
    this.updateSequence(i, { ...seq, frames: [...seq.frames, ...this.selectedFrames()] });
  }

  setTimelineFrames(frames: number[]) {
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

  // ---------------------------------------------------------------- save

  async save() {
    this.error.set(null);
    this.saving.set(true);
    try {
      const config = {
        spriteWidth: this.spriteWidth(),
        spriteHeight: this.spriteHeight(),
        sheetColumns: this.sheetColumns(),
        sheetRows: this.sheetRows(),
        animations: this.sequences(),
      };
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
      cellIndex = seq.frames[pos];
    }
    if (this.sheetImage && cellIndex >= 0) {
      const r = this.frameRect(cellIndex);
      ctx.drawImage(this.sheetImage, r.sx, r.sy, r.sw, r.sh, 0, 0, w * zoom, h * zoom);
    } else {
      ctx.fillStyle = '#10151e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
}

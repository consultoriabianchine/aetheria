import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { AnimationDirection, AnimationSequence, CreatureAnimationConfig, CreatureAnimationType } from '@aetheria/types';
import { ApiService, type CreatureDetail } from '../core/api.service';

const ANIMATION_TYPES: CreatureAnimationType[] = ['idle', 'walk', 'attack', 'cast', 'hit', 'death', 'spawn'];
const DIRECTIONS: AnimationDirection[] = ['north', 'east', 'south', 'west'];

const DIRECTION_LABEL: Record<AnimationDirection, string> = { north: '↑', east: '→', south: '↓', west: '←' };

@Component({
  selector: 'admin-creature-editor',
  imports: [RouterLink],
  templateUrl: './creature-editor.html',
  styleUrls: ['./creature-editor.scss'],
})
export class CreatureEditor implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('sheetCanvas') sheetCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewCanvas') previewCanvas!: ElementRef<HTMLCanvasElement>;

  readonly creature = signal<CreatureDetail | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);

  readonly spriteWidth = signal(32);
  readonly spriteHeight = signal(32);
  readonly sheetColumns = signal(4);
  readonly sheetRows = signal(8);

  readonly sequences = signal<AnimationSequence[]>([]);
  readonly selectedSeq = signal(-1);
  readonly selectedFrames = signal<number[]>([]);

  readonly dirty = signal(false);
  readonly version = signal<number | null>(null);

  readonly animations = ANIMATION_TYPES;
  readonly directions = DIRECTIONS;
  readonly directionLabel = DIRECTION_LABEL;

  // formulário de nova sequência
  readonly newAnim = signal<CreatureAnimationType>('walk');
  readonly newDir = signal<AnimationDirection>('south');

  // preview
  readonly zoom = signal(4);
  readonly playing = signal(false);
  readonly showGrid = signal(true);
  readonly previewSpeed = signal(1);

  private sheetImage: HTMLImageElement | null = null;
  private sheetUrl: string | null = null;
  private raf = 0;
  private lastTick = 0;
  private elapsed = 0;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
  ) {}

  get id(): number {
    return Number(this.route.snapshot.paramMap.get('id'));
  }

  get totalFrames(): number {
    return this.sheetColumns() * this.sheetRows();
  }

  get currentSequence(): AnimationSequence | null {
    const i = this.selectedSeq();
    return i >= 0 && i < this.sequences().length ? this.sequences()[i] : null;
  }

  get sheetInfo(): { width: number; height: number } | null {
    return this.sheetImage ? { width: this.sheetImage.naturalWidth, height: this.sheetImage.naturalHeight } : null;
  }

  async ngOnInit() {
    await this.reload();
  }

  ngAfterViewInit() {
    this.redraw();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.raf);
    if (this.sheetUrl) URL.revokeObjectURL(this.sheetUrl);
  }

  async reload() {
    this.error.set(null);
    try {
      const detail = await this.api.getCreature(this.id);
      this.creature.set(detail);
      this.version.set(detail.animationVersion);

      if (detail.animation) {
        const c = detail.animation;
        this.spriteWidth.set(c.spriteWidth);
        this.spriteHeight.set(c.spriteHeight);
        this.sheetColumns.set(c.sheetColumns);
        this.sheetRows.set(c.sheetRows);
        this.sequences.set(structuredClone(c.animations));
      } else {
        this.sequences.set([]);
      }

      if (detail.asset) {
        await this.loadImage(`${this.api.baseUrl()}/assets/creatures/${this.id}`);
      } else {
        this.sheetImage = null;
      }
      this.dirty.set(false);
    } catch (e) {
      this.error.set((e as Error).message);
    }
    this.redraw();
  }

  private loadImage(url: string): Promise<void> {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.sheetImage = img;
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const res = await this.api.uploadSpritesheet(this.id, file);
      const meta = res.asset;
      await this.reload();
      // define grade a partir das dimensões detectadas (múltiplos do sprite size)
      this.sheetColumns.set(Math.max(1, Math.floor(meta.imageWidth / this.spriteWidth())));
      this.sheetRows.set(Math.max(1, Math.floor(meta.imageHeight / this.spriteHeight())));
      this.dirty.set(true);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
      input.value = '';
      this.redraw();
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

  /** Auto Map: gera walk + idle para as 4 direções (colunas = direções, linhas = frames). */
  autoMap() {
    const cols = this.sheetColumns();
    const rows = this.sheetRows();
    const walkFrames = Math.max(1, Math.min(8, rows - 1));
    const idleRow = rows - 1;
    const order: AnimationDirection[] = ['south', 'east', 'north', 'west'];
    const animations: AnimationSequence[] = [];
    for (let col = 0; col < 4; col++) {
      const dir = order[col];
      const walk = [];
      for (let r = 0; r < walkFrames; r++) walk.push(r * cols + col);
      animations.push({ animation: 'walk', direction: dir, frames: walk, frameDurationMs: 120, loop: true });
      animations.push({ animation: 'idle', direction: dir, frames: [idleRow * cols + col], frameDurationMs: 400, loop: true });
    }
    this.sequences.set(animations);
    this.selectedSeq.set(0);
    this.dirty.set(true);
  }

  // ------------------------------------------------------------- sequences

  addSequence() {
    const seq: AnimationSequence = {
      animation: this.newAnim(),
      direction: this.newDir(),
      frames: [],
      frameDurationMs: 120,
      loop: true,
    };
    const list = [...this.sequences(), seq];
    this.sequences.set(list);
    this.selectedSeq.set(list.length - 1);
    this.dirty.set(true);
  }

  selectSequence(i: number) {
    this.selectedSeq.set(i);
  }

  removeSequence(i: number) {
    const list = this.sequences().filter((_, idx) => idx !== i);
    this.sequences.set(list);
    this.selectedSeq.set(-1);
    this.dirty.set(true);
  }

  addSelectedToTimeline() {
    const i = this.selectedSeq();
    if (i < 0) return;
    const seq = this.currentSequence;
    if (!seq) return;
    const frames = [...seq.frames, ...this.selectedFrames()];
    this.updateSequence(i, { ...seq, frames });
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
    const list = this.sequences().map((s, idx) => (idx === i ? seq : s));
    this.sequences.set(list);
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
      const config: CreatureAnimationConfig = {
        version: this.version() ?? 0,
        spriteWidth: this.spriteWidth(),
        spriteHeight: this.spriteHeight(),
        sheetColumns: this.sheetColumns(),
        sheetRows: this.sheetRows(),
        anchor: { x: this.spriteWidth() / 2, y: this.spriteHeight() },
        animations: this.sequences(),
      };
      const res = await this.api.saveAnimation(this.id, config, this.version() ?? undefined);
      this.version.set(res.animation.version);
      this.creature.update((c) => (c ? { ...c, animation: res.animation, animationVersion: res.animation.version } : c));
      this.dirty.set(false);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  async discard() {
    await this.reload();
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
    this.elapsed += (now - this.lastTick) * this.previewSpeed();
    this.lastTick = now;
    this.drawPreview();
    this.raf = requestAnimationFrame(() => this.loop());
  }

  private computeFrameIndex(seq: AnimationSequence, elapsed: number): number {
    const len = seq.frames.length;
    if (len === 0) return -1;
    const dur = Math.max(1, seq.frameDurationMs);
    const raw = Math.floor(elapsed / dur);
    if (seq.playbackMode === 'pingpong') {
      const period = Math.max(1, len * 2 - 2);
      const t = raw % period;
      return t < len ? t : period - t;
    }
    if (!seq.loop) return Math.min(raw, len - 1);
    return raw % len;
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

    if (this.sheetImage) {
      ctx.drawImage(this.sheetImage, 0, 0, canvas.width, canvas.height);
    }

    // seleção
    for (const idx of this.selectedFrames()) {
      const r = this.frameRect(idx);
      ctx.fillStyle = 'rgba(120, 200, 160, 0.25)';
      ctx.fillRect(r.sx, r.sy, r.sw, r.sh);
    }

    // grade + ids
    if (this.showGrid()) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= cols; x++) {
        ctx.beginPath();
        ctx.moveTo(x * w + 0.5, 0);
        ctx.lineTo(x * w + 0.5, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= rows; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * h + 0.5);
        ctx.lineTo(canvas.width, y * h + 0.5);
        ctx.stroke();
      }
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

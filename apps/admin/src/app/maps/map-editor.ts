import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';

const CELL = 22;

interface TileDef {
  id: number;
  name: string;
  color: string;
}

const TILES: TileDef[] = [
  { id: 0, name: 'Grama', color: '#4a8a3d' },
  { id: 1, name: 'Caminho', color: '#b3a06c' },
  { id: 2, name: 'Água', color: '#3d6fa3' },
  { id: 3, name: 'Árvore', color: '#2f6b2f' },
  { id: 4, name: 'Rocha', color: '#8a8d92' },
  { id: 5, name: 'Parede', color: '#565a60' },
];

@Component({
  selector: 'admin-map-editor',
  imports: [RouterLink],
  templateUrl: './map-editor.html',
  styleUrls: ['./map-editor.scss'],
})
export class MapEditor implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('canvas') canvas!: ElementRef<HTMLCanvasElement>;

  readonly name = signal('');
  readonly width = signal(20);
  readonly height = signal(16);
  readonly selectedTile = signal(0);
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly tiles = TILES;
  readonly cell = CELL;

  private grid: number[][] = [];
  private painting = false;
  private savedId: string | null = null;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  get id(): string {
    return this.route.snapshot.paramMap.get('id') ?? 'new';
  }

  async ngOnInit() {
    if (this.id !== 'new') {
      try {
        const m = await this.api.getMap(this.id);
        this.name.set(m.name);
        this.width.set(m.width);
        this.height.set(m.height);
        this.savedId = m.id;
        this.grid = Array.from({ length: m.height }, () => new Array(m.width).fill(0));
        for (const t of m.tiles) {
          if (t.y < m.height && t.x < m.width) this.grid[t.y][t.x] = t.type;
        }
      } catch (e) {
        this.error.set((e as Error).message);
      }
    } else {
      this.name.set('Nova Masmorra');
      this.initBlank();
    }
    this.redraw();
  }

  ngAfterViewInit() {
    this.redraw();
  }

  ngOnDestroy() {
    this.painting = false;
  }

  private initBlank() {
    this.grid = Array.from({ length: this.height() }, () => new Array(this.width()).fill(0));
  }

  resize() {
    const w = Math.max(4, Math.min(256, this.width()));
    const h = Math.max(4, Math.min(256, this.height()));
    this.width.set(w);
    this.height.set(h);
    const next = Array.from({ length: h }, () => new Array(w).fill(0));
    for (let y = 0; y < Math.min(h, this.grid.length); y++) {
      for (let x = 0; x < Math.min(w, this.grid[y].length); x++) {
        next[y][x] = this.grid[y][x];
      }
    }
    this.grid = next;
    this.dirty.set(true);
    this.redraw();
  }

  // ---------------------------------------------------------------- painting

  onPointerDown(e: PointerEvent) {
    this.painting = true;
    this.paintAt(e);
  }

  onPointerMove(e: PointerEvent) {
    if (this.painting) this.paintAt(e);
  }

  onPointerUp() {
    this.painting = false;
  }

  private paintAt(e: PointerEvent) {
    const rect = this.canvas.nativeElement.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / CELL);
    const y = Math.floor((e.clientY - rect.top) / CELL);
    if (x >= 0 && y >= 0 && x < this.width() && y < this.height() && this.grid[y][x] !== this.selectedTile()) {
      this.grid[y][x] = this.selectedTile();
      this.dirty.set(true);
      this.drawCell(x, y);
    }
  }

  // ---------------------------------------------------------------- canvas

  private redraw() {
    if (!this.canvas) return;
    const cv = this.canvas.nativeElement;
    cv.width = this.width() * CELL;
    cv.height = this.height() * CELL;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    for (let y = 0; y < this.height(); y++) {
      for (let x = 0; x < this.width(); x++) {
        this.paintCell(ctx, x, y);
      }
    }
  }

  private drawCell(x: number, y: number) {
    const ctx = this.canvas.nativeElement.getContext('2d');
    if (!ctx) return;
    this.paintCell(ctx, x, y);
  }

  private paintCell(ctx: CanvasRenderingContext2D, x: number, y: number) {
    const type = this.grid[y]?.[x] ?? 0;
    const def = TILES.find((t) => t.id === type) ?? TILES[0];
    ctx.fillStyle = def.color;
    ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x * CELL + 0.5, y * CELL + 0.5, CELL, CELL);
  }

  // ------------------------------------------------------------------ save

  async save() {
    this.error.set(null);
    this.saving.set(true);
    try {
      const tiles = [];
      for (let y = 0; y < this.height(); y++) {
        for (let x = 0; x < this.width(); x++) {
          tiles.push({ x, y, type: this.grid[y][x] });
        }
      }
      const res = await this.api.saveMap({
        id: this.savedId ?? undefined,
        name: this.name().trim() || 'Masmorra',
        width: this.width(),
        height: this.height(),
        tiles,
      });
      this.savedId = res.id;
      this.dirty.set(false);
      if (this.id === 'new') void this.router.navigate(['/maps', res.id]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  fill() {
    for (let y = 0; y < this.height(); y++) {
      for (let x = 0; x < this.width(); x++) {
        this.grid[y][x] = this.selectedTile();
      }
    }
    this.dirty.set(true);
    this.redraw();
  }
}

import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { TileCategory, TileDefinition, TileLayerType } from '@aetheria/types';
import { ApiService, type AdminTilesetDetail, type TileUpdateInput } from '../core/api.service';

const THUMB = 36;
const CATEGORIES: TileCategory[] = ['ground', 'path', 'water', 'wall', 'rock', 'vegetation', 'decoration', 'structure', 'stairs', 'portal', 'other'];
const LAYER_TYPES: TileLayerType[] = ['ground', 'ground_detail', 'object', 'object_above', 'collision', 'effect'];

interface Preset {
  label: string;
  apply: () => void;
}

@Component({
  selector: 'admin-tileset-editor',
  imports: [RouterLink],
  templateUrl: './tileset-editor.html',
  styleUrls: ['./tileset-editor.scss'],
})
export class TilesetEditor implements OnInit, AfterViewInit {
  @ViewChild('grid') canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly detail = signal<AdminTilesetDetail | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly uploadName = signal('');
  readonly tileSize = signal(32);
  readonly showIds = signal(false);
  readonly zoom = signal(1);
  readonly selectedIds = signal<number[]>([]);
  readonly savedNotice = signal(false);

  // formulário de edição em massa ('' = manter)
  readonly fName = signal('');
  readonly fCategory = signal('');
  readonly fLayerType = signal('');
  readonly fWalkable = signal('');
  readonly fBlocksMovement = signal('');
  readonly fBlocksProjectiles = signal('');
  readonly fBlocksVision = signal('');
  readonly fMovementCost = signal('');
  readonly fTags = signal('');
  readonly fIsWater = signal('');
  readonly fIsHazard = signal('');
  readonly fIsStairs = signal('');
  readonly fIsPortal = signal('');

  readonly categories = CATEGORIES;
  readonly layerTypes = LAYER_TYPES;

  private image: HTMLImageElement | null = null;
  private selected = new Set<number>();

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  get id(): string {
    return this.route.snapshot.paramMap.get('id') ?? 'new';
  }

  get isNew(): boolean {
    return this.id === 'new';
  }

  async ngOnInit() {
    if (!this.isNew) {
      await this.load(Number(this.id));
    }
  }

  ngAfterViewInit() {
    if (!this.isNew) this.redraw();
  }

  private async load(tilesetId: number) {
    this.loading.set(true);
    this.error.set(null);
    try {
      const detail = await this.api.getTileset(tilesetId);
      this.detail.set(detail);
      await this.loadImage(tilesetId);
      this.redraw();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  private async loadImage(tilesetId: number) {
    this.image = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = this.api.tilesetImageUrl(tilesetId);
    });
  }

  async onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.error.set(null);
    this.saving.set(true);
    try {
      const name = this.uploadName().trim() || file.name.replace(/\.[^.]+$/, '');
      const created = await this.api.uploadTileset(file, name, this.tileSize(), this.tileSize());
      await this.router.navigate(['/tilesets', created.tilesetId]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  toggleShowIds() {
    this.showIds.update((v) => !v);
    this.redraw();
  }

  zoomBy(delta: number) {
    this.zoom.set(Math.max(0.5, Math.min(2, this.zoom() + delta)));
    this.redraw();
  }

  // ------------------------------------------------------------------ canvas

  private redraw() {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;
    const d = this.detail();
    if (!d) return;
    const scale = Math.round(THUMB * this.zoom());
    canvas.width = d.columns * scale;
    canvas.height = d.rows * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < d.tiles.length; i++) {
      const tile = d.tiles[i];
      const sx = tile.sourceX;
      const sy = tile.sourceY;
      const dx = (i % d.columns) * scale;
      const dy = Math.floor(i / d.columns) * scale;
      if (this.image) {
        ctx.drawImage(this.image, sx, sy, tile.width, tile.height, dx, dy, scale, scale);
      } else {
        ctx.fillStyle = '#222a34';
        ctx.fillRect(dx, dy, scale, scale);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(dx + 0.5, dy + 0.5, scale, scale);
      if (this.selected.has(tile.tileId)) {
        ctx.strokeStyle = '#5ad88a';
        ctx.lineWidth = 2;
        ctx.strokeRect(dx + 1, dy + 1, scale - 2, scale - 2);
      }
      if (this.showIds()) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(dx, dy + scale - 10, scale, 10);
        ctx.fillStyle = '#ffffff';
        ctx.font = '8px monospace';
        ctx.fillText(`#${tile.tileId}`, dx + 2, dy + scale - 2);
      }
    }
  }

  onCanvasClick(e: MouseEvent) {
    const d = this.detail();
    if (!d) return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const scale = THUMB * this.zoom();
    const col = Math.floor((e.clientX - rect.left) / scale);
    const row = Math.floor((e.clientY - rect.top) / scale);
    if (col < 0 || row < 0 || col >= d.columns || row >= d.rows) return;
    const tile = d.tiles[row * d.columns + col];
    if (!tile) return;
    if (!e.shiftKey) this.selected.clear();
    if (this.selected.has(tile.tileId)) this.selected.delete(tile.tileId);
    else this.selected.add(tile.tileId);
    this.syncSelection();
    this.redraw();
  }

  clearSelection() {
    this.selected.clear();
    this.syncSelection();
    this.redraw();
  }

  selectAll() {
    const d = this.detail();
    if (!d) return;
    for (const t of d.tiles) this.selected.add(t.tileId);
    this.syncSelection();
    this.redraw();
  }

  private syncSelection() {
    this.selectedIds.set([...this.selected]);
    const d = this.detail();
    if (d && this.selected.size === 1) {
      const tile = d.tiles.find((t) => t.tileId === [...this.selected][0]);
      if (tile) this.loadTileIntoForm(tile);
    }
  }

  private loadTileIntoForm(tile: TileDefinition) {
    this.fName.set(tile.name ?? '');
    this.fCategory.set(tile.category);
    this.fLayerType.set(tile.layerType);
    this.fWalkable.set(String(tile.physics.walkable));
    this.fBlocksMovement.set(String(tile.physics.blocksMovement));
    this.fBlocksProjectiles.set(String(tile.physics.blocksProjectiles));
    this.fBlocksVision.set(String(tile.physics.blocksVision));
    this.fMovementCost.set(String(tile.physics.movementCost));
    this.fTags.set(tile.tags.join(', '));
    this.fIsWater.set(String(tile.isWater));
    this.fIsHazard.set(String(tile.isHazard));
    this.fIsStairs.set(String(tile.isStairs));
    this.fIsPortal.set(String(tile.isPortal));
  }

  private presets(): Preset[] {
    return [
      {
        label: 'Ground',
        apply: () => {
          this.fCategory.set('ground'); this.fLayerType.set('ground'); this.fWalkable.set('true'); this.fBlocksMovement.set('false'); this.fBlocksProjectiles.set('false'); this.fBlocksVision.set('false'); this.fIsWater.set('false');
        },
      },
      {
        label: 'Wall',
        apply: () => {
          this.fCategory.set('wall'); this.fLayerType.set('object'); this.fWalkable.set('false'); this.fBlocksMovement.set('true'); this.fBlocksProjectiles.set('true'); this.fBlocksVision.set('true');
        },
      },
      {
        label: 'Water',
        apply: () => {
          this.fCategory.set('water'); this.fLayerType.set('ground'); this.fWalkable.set('false'); this.fBlocksMovement.set('true'); this.fBlocksVision.set('false'); this.fIsWater.set('true');
        },
      },
      {
        label: 'Decoration',
        apply: () => {
          this.fCategory.set('decoration'); this.fLayerType.set('object'); this.fWalkable.set('true'); this.fBlocksMovement.set('false'); this.fBlocksVision.set('false');
        },
      },
      {
        label: 'Tree',
        apply: () => {
          this.fCategory.set('vegetation'); this.fLayerType.set('object'); this.fWalkable.set('false'); this.fBlocksMovement.set('true'); this.fBlocksVision.set('true');
        },
      },
      {
        label: 'Rock',
        apply: () => {
          this.fCategory.set('rock'); this.fLayerType.set('object'); this.fWalkable.set('false'); this.fBlocksMovement.set('true'); this.fBlocksVision.set('true');
        },
      },
    ];
  }

  applyPreset(preset: Preset) {
    preset.apply();
  }

  async saveProperties() {
    const d = this.detail();
    if (!d || this.selected.size === 0) return;
    const input = this.buildUpdateInput();
    this.saving.set(true);
    this.savedNotice.set(false);
    this.error.set(null);
    try {
      const tiles = await this.api.updateTiles(d.tilesetId, input);
      this.detail.update((cur) => (cur ? { ...cur, tiles } : cur));
      this.savedNotice.set(true);
      this.redraw();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  private buildUpdateInput(): TileUpdateInput[] {
    const patch: Omit<TileUpdateInput, 'tileId'> = {};
    if (this.fName()) patch.name = this.fName();
    if (this.fCategory()) patch.category = this.fCategory() as TileCategory;
    if (this.fLayerType()) patch.layerType = this.fLayerType() as TileLayerType;
    if (this.fWalkable() !== '') patch.walkable = this.fWalkable() === 'true';
    if (this.fBlocksMovement() !== '') patch.blocksMovement = this.fBlocksMovement() === 'true';
    if (this.fBlocksProjectiles() !== '') patch.blocksProjectiles = this.fBlocksProjectiles() === 'true';
    if (this.fBlocksVision() !== '') patch.blocksVision = this.fBlocksVision() === 'true';
    if (this.fMovementCost() !== '') patch.movementCost = Number(this.fMovementCost()) || 1;
    if (this.fTags() !== '') patch.tags = this.fTags().split(',').map((t) => t.trim()).filter(Boolean);
    if (this.fIsWater() !== '') patch.isWater = this.fIsWater() === 'true';
    if (this.fIsHazard() !== '') patch.isHazard = this.fIsHazard() === 'true';
    if (this.fIsStairs() !== '') patch.isStairs = this.fIsStairs() === 'true';
    if (this.fIsPortal() !== '') patch.isPortal = this.fIsPortal() === 'true';
    return [...this.selected].map((tileId) => ({ tileId, ...patch }));
  }

  selectedCount(): number {
    return this.selected.size;
  }

  zoomPercent(): number {
    return Math.round(this.zoom() * 100);
  }

  get presetList(): Preset[] {
    return this.presets();
  }
}

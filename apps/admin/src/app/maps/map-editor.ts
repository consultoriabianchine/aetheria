import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { createMapLayers, resizeTileLayer, tileIndex } from '@aetheria/shared';
import type { MapEntity, MapEntityType, MapLayerId, MapStatus, TileDefinition, TilesetDefinition } from '@aetheria/types';
import { MAP_LAYERS } from '@aetheria/types';
import { ApiService, type AdminTileset, type AdminTilesetDetail } from '../core/api.service';

const BASE_CELL = 32;

type Tool = 'pencil' | 'rectangle' | 'fill' | 'eraser' | 'picker' | 'select' | 'move';
type EditorMode = 'tiles' | 'entities';

interface LayerState {
  ground: (number | null)[];
  groundDetail: (number | null)[];
  objects: (number | null)[];
  objectsAbove: (number | null)[];
}

interface Snapshot {
  layers: LayerState;
  entities: MapEntity[];
}

const ENTITY_TYPES: MapEntityType[] = ['player_spawn', 'monster_spawn', 'boss_spawn', 'stairs_up', 'stairs_down', 'portal', 'chest', 'npc'];
const ENTITY_LABELS: Record<MapEntityType, string> = {
  player_spawn: 'Player Spawn',
  monster_spawn: 'Monster Spawn',
  boss_spawn: 'Boss Spawn',
  stairs_up: 'Stairs Up',
  stairs_down: 'Stairs Down',
  portal: 'Portal',
  chest: 'Chest',
  npc: 'NPC',
};
const ENTITY_COLORS: Record<MapEntityType, string> = {
  player_spawn: '#4d86ff',
  monster_spawn: '#e04d4d',
  boss_spawn: '#c65aff',
  stairs_up: '#5ad88a',
  stairs_down: '#e8c120',
  portal: '#66d9d0',
  chest: '#e89a52',
  npc: '#f0c14b',
};

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
  readonly status = signal<MapStatus>('draft');
  readonly dirty = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly activeLayer = signal<MapLayerId>('ground');
  readonly tool = signal<Tool>('pencil');
  readonly brush = signal(1);
  readonly zoom = signal(1);
  readonly gridVisible = signal(true);
  readonly collisionVisible = signal(false);
  readonly selectedTileId = signal<number | null>(null);
  readonly selectedTileIds = signal<number[]>([]);
  readonly mode = signal<EditorMode>('tiles');
  readonly entityType = signal<MapEntityType>('player_spawn');

  readonly testMode = signal(false);
  readonly testPlayer = signal<{ x: number; y: number } | null>(null);

  // paleta
  readonly tilesets = signal<AdminTileset[]>([]);
  readonly activeTilesetId = signal<number | null>(null);
  readonly tileCatalog = signal<TileDefinition[]>([]);
  readonly tileDefsById = new Map<number, TileDefinition>();
  readonly search = signal('');
  readonly categoryFilter = signal('');
  readonly favorites = signal<number[]>([]);
  readonly recent = signal<number[]>([]);
  readonly showIds = signal(false);
  readonly showFavorites = signal(false);
  readonly showRecents = signal(false);

  // estado do mapa
  private layers: LayerState = { ground: [], groundDetail: [], objects: [], objectsAbove: [] };
  private entities: MapEntity[] = [];
  private savedId: string | null = null;
  private textureImages = new Map<number, HTMLImageElement>();

  readonly tools: Tool[] = ['pencil', 'rectangle', 'fill', 'eraser', 'picker', 'select', 'move'];
  readonly brushSizes = [1, 2, 3, 5];

  // pintura
  private painting = false;
  private rectStart: { x: number; y: number } | null = null;
  private panning = false;
  private panStart = { x: 0, y: 0 };
  private panOrigin = { x: 0, y: 0 };
  private viewX = 0;
  private viewY = 0;

  // undo/redo
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  readonly layers_list = MAP_LAYERS;
  readonly entityTypes = ENTITY_TYPES;
  readonly entityLabels = ENTITY_LABELS;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
  ) {}

  get id(): string {
    return this.route.snapshot.paramMap.get('id') ?? 'new';
  }

  async ngOnInit() {
    await this.loadTilesets();
    if (this.id !== 'new') {
      try {
        const m = await this.api.getMap(this.id);
        this.name.set(m.name);
        this.width.set(m.width);
        this.height.set(m.height);
        this.status.set(m.status ?? 'draft');
        this.savedId = m.id;
        this.layers = this.normalizeLayers(m.layers);
        this.entities = m.entities ?? [];
        this.previousWidth = m.width;
        this.previousHeight = m.height;
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
    this.applyCanvasSize();
    this.redraw();
  }

  ngOnDestroy() {
    this.painting = false;
  }

  // ------------------------------------------------------------ tilesets

  private async loadTilesets() {
    try {
      const sets = await this.api.listTilesets();
      this.tilesets.set(sets);
      const details = await Promise.all(sets.map((set) => this.api.getTileset(set.tilesetId)));
      for (const detail of details) {
        for (const tile of detail.tiles) this.tileDefsById.set(tile.tileId, tile);
        await this.ensureTilesetImage(detail.tilesetId);
      }
      if (sets.length > 0) await this.selectTileset(sets[0].tilesetId);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  async selectTileset(tilesetId: number) {
    this.activeTilesetId.set(tilesetId);
    try {
      const detail = await this.api.getTileset(tilesetId);
      this.tileCatalog.set(detail.tiles);
      for (const t of detail.tiles) this.tileDefsById.set(t.tileId, t);
      await this.ensureTilesetImage(tilesetId);
      this.redraw();
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  private async ensureTilesetImage(tilesetId: number) {
    if (this.textureImages.has(tilesetId)) return;
    this.textureImages.set(tilesetId, await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = this.api.tilesetImageUrl(tilesetId);
    }).then((img) => img ?? new Image()));
  }

  tileImage(tilesetId: number): HTMLImageElement | null {
    return this.textureImages.get(tilesetId) ?? null;
  }

  get filteredTiles(): TileDefinition[] {
    const q = this.search().trim().toLowerCase();
    const cat = this.categoryFilter();
    return this.tileCatalog().filter((t) => {
      if (cat && t.category !== cat) return false;
      if (!q) return true;
      return (
        String(t.tileId).includes(q) ||
        (t.name ?? '').toLowerCase().includes(q) ||
        t.category.includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }

  get favoritesTiles(): TileDefinition[] {
    return this.favorites().map((id) => this.tileDefsById.get(id)).filter((t): t is TileDefinition => !!t);
  }

  get recentTiles(): TileDefinition[] {
    return this.recent().map((id) => this.tileDefsById.get(id)).filter((t): t is TileDefinition => !!t);
  }

  selectTile(tileId: number, multi = false) {
    const next = multi ? [...this.selectedTileIds()] : [];
    const index = next.indexOf(tileId);
    if (multi && index >= 0) next.splice(index, 1);
    else next.push(tileId);
    this.selectedTileIds.set(next);
    this.selectedTileId.set(next.length ? next[next.length - 1] : null);
    if (!next.length) return;
    const layerType = this.tileDefsById.get(tileId)?.layerType;
    if (layerType === 'ground_detail') this.activeLayer.set('groundDetail');
    else if (layerType === 'object') this.activeLayer.set('objects');
    else if (layerType === 'object_above') this.activeLayer.set('objectsAbove');
    else if (layerType === 'ground') this.activeLayer.set('ground');
    this.tool.set('pencil');
    this.mode.set('tiles');
    const recent = [tileId, ...this.recent().filter((id) => id !== tileId)].slice(0, 12);
    this.recent.set(recent);
  }

  toggleFavorite(tileId: number) {
    const fav = this.favorites();
    if (fav.includes(tileId)) this.favorites.set(fav.filter((id) => id !== tileId));
    else this.favorites.set([...fav, tileId]);
  }

  isFavorite(tileId: number): boolean {
    return this.favorites().includes(tileId);
  }

  tileTooltip(tile: TileDefinition): string {
    const walkable = tile.physics.walkable ? 'Yes' : 'No';
    const set = this.tilesets().find((s) => s.tilesetId === tile.tilesetId);
    return `Tile #${tile.tileId}\n${tile.name ?? 'Tile'}\nTileset: ${set?.name ?? tile.tilesetId}\nWalkable: ${walkable}\nLayer: ${tile.layerType}`;
  }

  // ------------------------------------------------------------- init

  private initBlank() {
    this.layers = this.freshLayers(this.width(), this.height());
    this.entities = [];
  }

  private freshLayers(w: number, h: number): LayerState {
    return createMapLayers(w, h) as LayerState;
  }

  private normalizeLayers(input: Record<MapLayerId, (number | null)[]> | undefined): LayerState {
    const base = this.freshLayers(this.width(), this.height());
    if (!input) return base;
    for (const layer of MAP_LAYERS) {
      const arr = input[layer];
      if (Array.isArray(arr)) base[layer] = arr;
    }
    return base;
  }

  private currentLayerArr(): (number | null)[] {
    return this.layers[this.activeLayer()];
  }

  // ------------------------------------------------------------- tools

  setTool(tool: Tool) {
    this.tool.set(tool);
    if (tool !== 'rectangle') this.rectStart = null;
  }

  setLayer(layer: MapLayerId) {
    this.activeLayer.set(layer);
  }

  setBrush(n: number) {
    this.brush.set(n);
  }

  setMode(mode: EditorMode) {
    this.mode.set(mode);
  }

  setEntityType(type: MapEntityType) {
    this.entityType.set(type);
  }

  zoomBy(delta: number) {
    this.setZoom(this.zoom() + delta);
  }

  setZoom(z: number) {
    this.zoom.set(Math.max(0.5, Math.min(4, z)));
    this.applyCanvasSize();
    this.redraw();
  }

  toggleGrid() {
    this.gridVisible.update((v) => !v);
    this.redraw();
  }

  toggleCollision() {
    this.collisionVisible.update((v) => !v);
    this.redraw();
  }

  toggleShowIds() {
    this.showIds.update((v) => !v);
  }

  // ------------------------------------------------------------- painting

  onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoomBy(e.deltaY < 0 ? 0.25 : -0.25);
    } else {
      this.viewX -= e.deltaX / this.zoom();
      this.viewY -= e.deltaY / this.zoom();
      this.redraw();
    }
  }

  onPointerDown(e: PointerEvent) {
    if (e.button === 1 || (e.button === 0 && (this.tool() === 'move' || this.spacePressed))) {
      this.panning = true;
      this.panStart = { x: e.clientX, y: e.clientY };
      this.panOrigin = { x: this.viewX, y: this.viewY };
      return;
    }
    if (this.mode() === 'entities') {
      if (this.tool() === 'eraser') this.removeEntityAt(e);
      else this.placeEntity(e);
      return;
    }
    if (this.tool() === 'picker') {
      this.pickAt(e);
      return;
    }
    if (this.tool() === 'fill') {
      this.fillAt(e);
      return;
    }
    if (this.tool() === 'rectangle') {
      this.pushUndo();
      this.painting = true;
      const p = this.cellAt(e);
      this.rectStart = p;
      if (p) this.paintRect(p, p);
      return;
    }
    this.painting = true;
    this.pushUndo();
    this.paintAt(e);
  }

  onPointerMove(e: PointerEvent) {
    if (this.panning) {
      this.viewX = this.panOrigin.x + (this.panStart.x - e.clientX) / this.zoom();
      this.viewY = this.panOrigin.y + (this.panStart.y - e.clientY) / this.zoom();
      this.redraw();
      return;
    }
    if (this.painting) this.paintAt(e);
  }

  onPointerUp() {
    this.painting = false;
    this.panning = false;
    this.rectStart = null;
  }

  private spacePressed = false;

  @HostListener('window:keydown', ['$event'])
  onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;

    if (e.code === 'Space') { this.spacePressed = true; e.preventDefault(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) this.redo();
      else this.undo();
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      this.redo();
      e.preventDefault();
    } else if (e.key === '1') this.setTool('pencil');
    else if (e.key === '2') this.setTool('rectangle');
    else if (e.key === '3') this.setTool('fill');
    else if (e.key === '4') this.setTool('eraser');
    else if (e.key === '5') this.setTool('picker');
    else if (e.key === '6') this.setTool('move');
    else if (e.key === 'm' || e.key === 'M') this.toggleCollision();
    else if (e.key === 'g' || e.key === 'G') this.toggleGrid();
    else if (e.altKey) this.setTool('picker');
  }

  @HostListener('window:keyup', ['$event'])
  onKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') this.spacePressed = false;
    if (!e.altKey && this.tool() === 'picker') this.setTool('pencil');
  }

  private cellAt(e: PointerEvent): { x: number; y: number } | null {
    const canvas = this.canvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const cs = BASE_CELL * this.zoom();
    const mx = (e.clientX - rect.left) / cs + this.viewX;
    const my = (e.clientY - rect.top) / cs + this.viewY;
    const x = Math.floor(mx);
    const y = Math.floor(my);
    if (x < 0 || y < 0 || x >= this.width() || y >= this.height()) return null;
    return { x, y };
  }

  private paintAt(e: PointerEvent) {
    const p = this.cellAt(e);
    if (!p) return;

    if (this.tool() === 'rectangle' && this.rectStart) {
      this.paintRect(this.rectStart, p);
      this.redraw();
      return;
    }

    if (this.tool() === 'eraser') {
      this.paintCells([[p.x, p.y]], null);
    } else if (this.tool() === 'pencil') {
      const tid = this.selectedTileId();
      if (tid == null) return;
      for (const [x, y] of this.brushCells(p.x, p.y)) this.paintPattern(x, y);
    }
    this.redraw();
  }

  private paintRect(a: { x: number; y: number }, b: { x: number; y: number }) {
    const tid = this.selectedTileId();
    if (tid == null) return;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    const cells: [number, number][] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push([x, y]);
    this.paintCells(cells, tid);
  }

  private brushCells(cx: number, cy: number): [number, number][] {
    const b = this.brush();
    const out: [number, number][] = [];
    for (let dy = 0; dy < b; dy++) {
      for (let dx = 0; dx < b; dx++) out.push([cx + dx, cy + dy]);
    }
    return out;
  }

  private paintCells(cells: [number, number][], tileId: number | null) {
    const layerId = tileId == null ? this.activeLayer() : this.layerForTile(tileId);
    const layer = this.layers[layerId];
    for (const [x, y] of cells) {
      if (x < 0 || y < 0 || x >= this.width() || y >= this.height()) continue;
      layer[tileIndex(x, y, this.width())] = tileId;
    }
    this.dirty.set(true);
  }

  private paintPattern(anchorX: number, anchorY: number) {
    const tiles = this.selectedTileIds().length ? this.selectedTileIds() : (this.selectedTileId() == null ? [] : [this.selectedTileId()!]);
    if (tiles.length <= 1) {
      if (tiles[0] != null) this.paintCells([[anchorX, anchorY]], tiles[0]);
      return;
    }
    const defs = tiles.map((id) => this.tileDefsById.get(id)).filter((tile): tile is TileDefinition => !!tile);
    const activeSet = this.tilesets().find((set) => set.tilesetId === this.activeTilesetId());
    if (!defs.length || !activeSet) return;
    const positions = defs.map((tile) => ({ tile, x: tile.index % activeSet.columns, y: Math.floor(tile.index / activeSet.columns) }));
    const minX = Math.min(...positions.map((p) => p.x));
    const minY = Math.min(...positions.map((p) => p.y));
    for (const position of positions) this.paintCells([[anchorX + position.x - minX, anchorY + position.y - minY]], position.tile.tileId);
  }

  private layerForTile(tileId: number): MapLayerId {
    const layerType = this.tileDefsById.get(tileId)?.layerType;
    if (layerType === 'ground_detail') return 'groundDetail';
    if (layerType === 'object') return 'objects';
    if (layerType === 'object_above') return 'objectsAbove';
    return 'ground';
  }

  private fillAt(e: PointerEvent) {
    const p = this.cellAt(e);
    if (!p) return;
    const tid = this.selectedTileId();
    if (tid == null) return;
    this.pushUndo();
    const layer = this.layers[this.layerForTile(tid)];
    const target = layer[tileIndex(p.x, p.y, this.width())];
    if (target === tid) return;
    const w = this.width(), h = this.height();
    const stack = [[p.x, p.y]];
    const seen = new Set<number>();
    while (stack.length) {
      const [x, y] = stack.pop()!;
      const idx = tileIndex(x, y, w);
      if (seen.has(idx)) continue;
      seen.add(idx);
      if (layer[idx] !== target) continue;
      layer[idx] = tid;
      if (x > 0) stack.push([x - 1, y]);
      if (x < w - 1) stack.push([x + 1, y]);
      if (y > 0) stack.push([x, y - 1]);
      if (y < h - 1) stack.push([x, y + 1]);
    }
    this.dirty.set(true);
    this.redraw();
  }

  private pickAt(e: PointerEvent) {
    const p = this.cellAt(e);
    if (!p) return;
    const tileId = this.layers[this.activeLayer()][tileIndex(p.x, p.y, this.width())];
    if (tileId != null) this.selectTile(tileId);
    this.setTool('pencil');
  }

  private placeEntity(e: PointerEvent) {
    const p = this.cellAt(e);
    if (!p) return;
    this.pushUndo();
    this.entities = this.entities.filter((en) => !(en.x === p.x && en.y === p.y));
    this.entities.push({ id: `e_${Date.now().toString(36)}`, type: this.entityType(), x: p.x, y: p.y });
    this.dirty.set(true);
    this.redraw();
  }

  removeEntityAt(e: PointerEvent) {
    const p = this.cellAt(e);
    if (!p) return;
    this.pushUndo();
    this.entities = this.entities.filter((en) => !(en.x === p.x && en.y === p.y));
    this.dirty.set(true);
    this.redraw();
  }

  // ------------------------------------------------------------- undo/redo

  private pushUndo() {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }

  private snapshot(): Snapshot {
    return {
      layers: {
        ground: [...this.layers.ground],
        groundDetail: [...this.layers.groundDetail],
        objects: [...this.layers.objects],
        objectsAbove: [...this.layers.objectsAbove],
      },
      entities: this.entities.map((e) => ({ ...e })),
    };
  }

  private restore(s: Snapshot) {
    this.layers = {
      ground: [...s.layers.ground],
      groundDetail: [...s.layers.groundDetail],
      objects: [...s.layers.objects],
      objectsAbove: [...s.layers.objectsAbove],
    };
    this.entities = s.entities.map((e) => ({ ...e }));
    this.dirty.set(true);
    this.redraw();
  }

  undo() {
    const s = this.undoStack.pop();
    if (!s) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }

  redo() {
    const s = this.redoStack.pop();
    if (!s) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }

  fillAll() {
    this.pushUndo();
    const tid = this.selectedTileId();
    if (tid == null) return;
    const layer = this.layers[this.layerForTile(tid)];
    layer.fill(tid);
    this.dirty.set(true);
    this.redraw();
  }

  // ------------------------------------------------------------- resize

  resize() {
    const w = Math.max(4, Math.min(128, this.width()));
    const h = Math.max(4, Math.min(128, this.height()));
    const trimming = w < this.width() || h < this.height();
    if (trimming && !confirm('Tiles fora da nova área serão removidos.')) return;
    this.pushUndo();
    const oldW = this.previousWidth;
    const oldH = this.previousHeight;
    this.width.set(w);
    this.height.set(h);
    this.layers = {
      ground: resizeTileLayer(this.layers.ground, oldW, oldH, w, h),
      groundDetail: resizeTileLayer(this.layers.groundDetail, oldW, oldH, w, h),
      objects: resizeTileLayer(this.layers.objects, oldW, oldH, w, h),
      objectsAbove: resizeTileLayer(this.layers.objectsAbove, oldW, oldH, w, h),
    };
    this.previousWidth = w;
    this.previousHeight = h;
    this.entities = this.entities.filter((en) => en.x < w && en.y < h);
    this.dirty.set(true);
    this.applyCanvasSize();
    this.redraw();
  }

  private previousWidth = 20;
  private previousHeight = 16;

  // ------------------------------------------------------------- canvas

  private applyCanvasSize() {
    const canvas = this.canvas?.nativeElement;
    if (!canvas) return;
    canvas.width = this.width() * BASE_CELL * this.zoom();
    canvas.height = this.height() * BASE_CELL * this.zoom();
  }

  private redraw() {
    const canvas = this.canvas?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cs = BASE_CELL * this.zoom();

    const order = ['ground', 'groundDetail', 'objects', 'objectsAbove'] as const;
    const drawTile = (tileId: number, x: number, y: number) => {
      const def = this.tileDefsById.get(tileId);
      const img = def ? this.textureImages.get(def.tilesetId) : null;
      if (def && img) {
        ctx.drawImage(img, def.sourceX, def.sourceY, def.width, def.height, (x - this.viewX) * cs, (y - this.viewY) * cs, cs, cs);
      } else {
        ctx.fillStyle = '#3a4653';
        ctx.fillRect((x - this.viewX) * cs, (y - this.viewY) * cs, cs, cs);
      }
    };

    for (let y = 0; y < this.height(); y++) {
      for (let x = 0; x < this.width(); x++) {
        const idx = tileIndex(x, y, this.width());
        for (const layer of order) {
          const tileId = this.layers[layer][idx];
          if (tileId != null) drawTile(tileId, x, y);
        }
      }
    }

    if (this.collisionVisible()) {
      for (let y = 0; y < this.height(); y++) {
        for (let x = 0; x < this.width(); x++) {
          const idx = tileIndex(x, y, this.width());
          const g = this.tileDefsById.get(this.layers.ground[idx] ?? 0)?.physics;
          const o = this.tileDefsById.get(this.layers.objects[idx] ?? 0)?.physics;
          const walkable = !g || ((g.walkable) && !(o?.blocksMovement));
          if (!walkable || o?.blocksMovement) {
            ctx.fillStyle = 'rgba(220, 40, 40, 0.45)';
            ctx.fillRect((x - this.viewX) * cs, (y - this.viewY) * cs, cs, cs);
          }
        }
      }
    }

    if (this.gridVisible()) {
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= this.width(); x++) {
        ctx.beginPath();
        ctx.moveTo((x - this.viewX) * cs, (-this.viewY) * cs);
        ctx.lineTo((x - this.viewX) * cs, (this.height() - this.viewY) * cs);
        ctx.stroke();
      }
      for (let y = 0; y <= this.height(); y++) {
        ctx.beginPath();
        ctx.moveTo((-this.viewX) * cs, (y - this.viewY) * cs);
        ctx.lineTo((this.width() - this.viewX) * cs, (y - this.viewY) * cs);
        ctx.stroke();
      }
    }

    for (const en of this.entities) {
      const color = ENTITY_COLORS[en.type] ?? '#ffffff';
      const cx = (en.x - this.viewX) * cs + cs / 2;
      const cy = (en.y - this.viewY) * cs + cs / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect((en.x - this.viewX) * cs + 2, (en.y - this.viewY) * cs + 2, cs - 4, cs - 4);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, cs * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.testPlayer()) {
      const tp = this.testPlayer()!;
      const cx = (tp.x - this.viewX) * cs + cs / 2;
      const cy = (tp.y - this.viewY) * cs + cs / 2;
      ctx.fillStyle = '#4d86ff';
      ctx.beginPath();
      ctx.arc(cx, cy, cs * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------- test mode

  startTest() {
    const spawn = this.entities.find((e) => e.type === 'player_spawn');
    this.testPlayer.set(spawn ? { x: spawn.x, y: spawn.y } : { x: 1, y: 1 });
    this.testMode.set(true);
  }

  stopTest() {
    this.testMode.set(false);
    this.testPlayer.set(null);
  }

  testMove(dx: number, dy: number) {
    const tp = this.testPlayer();
    if (!tp) return;
    const nx = tp.x + dx;
    const ny = tp.y + dy;
    if (nx < 0 || ny < 0 || nx >= this.width() || ny >= this.height()) return;
    const idx = tileIndex(nx, ny, this.width());
    const g = this.tileDefsById.get(this.layers.ground[idx] ?? 0)?.physics;
    const o = this.tileDefsById.get(this.layers.objects[idx] ?? 0)?.physics;
    const blocked = (g && !g.walkable) || o?.blocksMovement;
    if (blocked) return;
    this.testPlayer.set({ x: nx, y: ny });
    this.redraw();
  }

  // ------------------------------------------------------------- save/export

  async save() {
    this.error.set(null);
    this.saving.set(true);
    try {
      const res = await this.api.saveMap({
        id: this.savedId ?? undefined,
        name: this.name().trim() || 'Masmorra',
        width: this.width(),
        height: this.height(),
        status: this.status(),
        layers: this.layers,
        entities: this.entities,
       });
       this.savedId = res.id;
       const saved = await this.api.getMap(res.id);
       this.name.set(saved.name);
       this.width.set(saved.width);
       this.height.set(saved.height);
       this.status.set(saved.status ?? 'draft');
       this.layers = this.normalizeLayers(saved.layers);
       this.entities = saved.entities ?? [];
       this.previousWidth = saved.width;
       this.previousHeight = saved.height;
       this.dirty.set(false);
       this.applyCanvasSize();
       this.redraw();
       if (this.id === 'new') void this.router.navigate(['/maps', res.id]);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  exportJson() {
    const data = {
      name: this.name(),
      width: this.width(),
      height: this.height(),
      status: this.status(),
      layers: this.layers,
      entities: this.entities,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(this.name() || 'mapa').replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importJson(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        const data = JSON.parse(text);
        if (typeof data.width !== 'number' || typeof data.height !== 'number') throw new Error('JSON inválido');
        this.pushUndo();
        this.name.set(data.name ?? this.name());
        this.width.set(data.width);
        this.height.set(data.height);
        this.layers = this.normalizeLayers(data.layers);
        this.entities = data.entities ?? [];
        this.previousWidth = data.width;
        this.previousHeight = data.height;
        this.dirty.set(true);
        this.applyCanvasSize();
        this.redraw();
      } catch (e) {
        this.error.set(`Falha ao importar: ${(e as Error).message}`);
      }
    });
  }

  entityList(): MapEntity[] {
    return this.entities;
  }

  toggleFavorites() {
    this.showFavorites.update((v) => !v);
    this.showRecents.set(false);
  }

  toggleRecents() {
    this.showRecents.update((v) => !v);
    this.showFavorites.set(false);
  }

  toolLabel(tool: Tool): string {
    return { pencil: 'Pencil', rectangle: 'Rectangle', fill: 'Fill', eraser: 'Eraser', picker: 'Picker', select: 'Select', move: 'Move' }[tool];
  }

  shortcut(tool: Tool): string {
    return { pencil: '1', rectangle: '2', fill: '3', eraser: '4', picker: '5', select: '', move: '6' }[tool];
  }

  zoomPercent(): number {
    return Math.round(this.zoom() * 100);
  }

  entityColor(type: MapEntityType): string {
    return ENTITY_COLORS[type];
  }

  tileThumbStyle(t: TileDefinition): string {
    const img = this.textureImages.get(t.tilesetId);
    if (!img) return `background: #3a4653; width: 32px; height: 32px;`;
    const sw = img.width;
    const bx = (t.sourceX / sw) * 100;
    const by = (t.sourceY / img.height) * 100;
    const bs = (t.width / sw) * 100;
    return `background-image: url(${this.api.tilesetImageUrl(t.tilesetId)}); background-size: ${sw}px ${img.height}px; background-position: ${-t.sourceX}px ${-t.sourceY}px; width: 32px; height: 32px; image-rendering: pixelated;`;
  }
}

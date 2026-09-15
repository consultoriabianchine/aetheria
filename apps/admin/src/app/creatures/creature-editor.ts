import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DAMAGE_TYPES, type AnimationDirection, type AnimationSequence, type CombatAbilityDefinition, type CreatureAnimationConfig, type CreatureAnimationType, type CreatureVisualBounds, type DamageAffinities, type DamageType } from '@aetheria/types';
import { ApiService, type CreatureDetail } from '../core/api.service';

const ANIMATION_TYPES: CreatureAnimationType[] = ['idle', 'walk', 'attack', 'cast', 'hit', 'death', 'spawn'];
const DIRECTIONS: AnimationDirection[] = ['north', 'east', 'south', 'west'];

const DIRECTION_LABEL: Record<AnimationDirection, string> = { north: '↑', east: '→', south: '↓', west: '←' };

interface MonsterSpellDraft {
  abilityId: number | null;
  enabled: boolean;
  priority: number;
  chance: number;
  cooldownOverrideMs: number | null;
  minDamage: number | null;
  maxDamage: number | null;
}

interface StoredMonsterAbility {
  ability_id: number;
  enabled: boolean;
  priority: number;
  chance: number;
  cooldown_override_ms: number | null;
  parameters: Record<string, number> | null;
}

@Component({
  selector: 'admin-creature-editor',
  imports: [RouterLink],
  templateUrl: './creature-editor.html',
  styleUrls: ['./creature-editor.scss'],
})
export class CreatureEditor implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('sheetCanvas') sheetCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewCanvas') previewCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('tilePreviewCanvas') tilePreviewCanvas!: ElementRef<HTMLCanvasElement>;

  readonly creature = signal<CreatureDetail | null>(null);
  readonly error = signal<string | null>(null);
  readonly saving = signal(false);
  readonly affinities = signal<DamageAffinities>({} as DamageAffinities);
  readonly damageTypes = DAMAGE_TYPES;
  readonly activeTab = signal<'overview' | 'elements' | 'loot' | 'animation' | 'positioning' | 'spells'>('overview');

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
  readonly stats = signal<Record<string, number>>({});
  readonly loot = signal<CreatureDetail['loot']>([]);
  readonly abilities = signal<CombatAbilityDefinition[]>([]);
  readonly spells = signal<MonsterSpellDraft[]>([]);

  // posicionamento do sprite
  readonly footprintWidth = signal(1);
  readonly footprintHeight = signal(1);
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
  readonly showFootprint = signal(true);
  readonly showRenderBounds = signal(true);
  readonly showVisualBounds = signal(true);
  readonly showBody = signal(true);
  readonly showHudAnchor = signal(true);
  readonly showAnchor = signal(true);
  readonly showProjectileOrigin = signal(true);
  readonly previewAnim = signal<CreatureAnimationType>('idle');
  readonly previewBaseX = signal(2);
  readonly previewBaseY = signal(2);

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
      this.affinities.set(structuredClone(detail.damageAffinities));
      this.stats.set({ level: detail.level, health: detail.health, attack: detail.attack, defense: detail.defense, experience: detail.experience, attackSpeed: detail.attackSpeed, attackRange: detail.attackRange, viewRange: detail.viewRange, chaseRange: detail.chaseRange });
      this.loot.set(structuredClone(detail.loot));
      this.version.set(detail.animationVersion);

      const [abilities, monsterRows] = await Promise.all([this.api.listAbilities(), this.api.getMonsterAbilities(this.id)]);
      this.abilities.set(abilities);
      this.spells.set((monsterRows as StoredMonsterAbility[]).map((row) => ({
        abilityId: row.ability_id,
        enabled: row.enabled,
        priority: row.priority,
        chance: row.chance,
        cooldownOverrideMs: row.cooldown_override_ms,
        minDamage: row.parameters?.['minDamage'] ?? null,
        maxDamage: row.parameters?.['maxDamage'] ?? null,
      })));

      if (detail.animation) {
        const c = detail.animation;
        this.spriteWidth.set(c.spriteWidth);
        this.spriteHeight.set(c.spriteHeight);
        this.sheetColumns.set(c.sheetColumns);
        this.sheetRows.set(c.sheetRows);
        this.anchorX.set(c.anchor?.x ?? c.spriteWidth / 2);
        this.anchorY.set(c.anchor?.y ?? c.spriteHeight);
        this.offsetX.set(c.offsetX ?? 0);
        this.offsetY.set(c.offsetY ?? 0);
        this.visualBoundsWidth.set(c.visualBounds?.width ?? c.spriteWidth);
        this.visualBoundsHeight.set(c.visualBounds?.height ?? c.spriteHeight);
        this.bodyWidth.set(c.bodyWidth ?? c.visualBounds?.width ?? c.spriteWidth);
        this.bodyHeight.set(c.bodyHeight ?? c.visualBounds?.height ?? c.spriteHeight);
        this.bodyOffsetX.set(c.bodyOffsetX ?? 0);
        this.bodyOffsetY.set(c.bodyOffsetY ?? 0);
        this.projectileOriginX.set(c.sockets?.projectileOrigin?.x ?? c.spriteWidth / 2);
        this.projectileOriginY.set(c.sockets?.projectileOrigin?.y ?? c.spriteHeight / 2);
        this.sequences.set(structuredClone(c.animations));
      } else {
        this.sequences.set([]);
        this.anchorX.set(this.spriteWidth() / 2);
        this.anchorY.set(this.spriteHeight());
        this.offsetX.set(0);
        this.offsetY.set(0);
        this.visualBoundsWidth.set(this.spriteWidth());
        this.visualBoundsHeight.set(this.spriteHeight());
        this.bodyWidth.set(this.spriteWidth());
        this.bodyHeight.set(this.spriteHeight());
        this.bodyOffsetX.set(0);
        this.bodyOffsetY.set(0);
        this.projectileOriginX.set(this.spriteWidth() / 2);
        this.projectileOriginY.set(this.spriteHeight() / 2);
      }
      this.footprintWidth.set(detail.footprintWidth ?? 1);
      this.footprintHeight.set(detail.footprintHeight ?? 1);

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

  private buildConfig(): CreatureAnimationConfig {
    const config: CreatureAnimationConfig = {
      version: this.version() ?? 0,
      spriteWidth: this.spriteWidth(),
      spriteHeight: this.spriteHeight(),
      sheetColumns: this.sheetColumns(),
      sheetRows: this.sheetRows(),
      anchor: { x: this.anchorX(), y: this.anchorY() },
      offsetX: this.offsetX(),
      offsetY: this.offsetY(),
      animations: this.sequences(),
    };
    const visualBounds: CreatureVisualBounds = { width: this.visualBoundsWidth(), height: this.visualBoundsHeight() };
    if (visualBounds.width !== config.spriteWidth || visualBounds.height !== config.spriteHeight) {
      config.visualBounds = visualBounds;
    }
    if (this.bodyWidth() !== config.spriteWidth) config.bodyWidth = this.bodyWidth();
    if (this.bodyHeight() !== config.spriteHeight) config.bodyHeight = this.bodyHeight();
    if (this.bodyOffsetX() !== 0) config.bodyOffsetX = this.bodyOffsetX();
    if (this.bodyOffsetY() !== 0) config.bodyOffsetY = this.bodyOffsetY();
    if (this.projectileOriginX() !== config.spriteWidth / 2 || this.projectileOriginY() !== config.spriteHeight / 2) {
      config.sockets = { projectileOrigin: { x: this.projectileOriginX(), y: this.projectileOriginY() } };
    }
    return config;
  }

  async save() {
    this.error.set(null);
    this.saving.set(true);
    try {
      const res = await this.api.saveAnimation(this.id, this.buildConfig(), this.version() ?? undefined);
      this.version.set(res.animation.version);
      this.creature.update((c) => (c ? { ...c, animation: res.animation, animationVersion: res.animation.version } : c));
      this.dirty.set(false);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  async savePositioning() {
    this.error.set(null);
    this.saving.set(true);
    try {
      const res = await this.api.saveAnimation(this.id, this.buildConfig(), this.version() ?? undefined);
      this.version.set(res.animation.version);
      await this.api.saveCreatureStats(this.id, { game_footprint_width: this.footprintWidth(), game_footprint_height: this.footprintHeight() });
      this.creature.update((c) => (c ? { ...c, animation: res.animation, animationVersion: res.animation.version, footprintWidth: this.footprintWidth(), footprintHeight: this.footprintHeight() } : c));
      this.dirty.set(false);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
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

  setVisualBoundsWidth(value: number) {
    this.visualBoundsWidth.set(Math.max(1, Math.round(value)));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  setVisualBoundsHeight(value: number) {
    this.visualBoundsHeight.set(Math.max(1, Math.round(value)));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  setBodyWidth(value: number) {
    this.bodyWidth.set(Math.max(1, Math.round(value)));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  setBodyHeight(value: number) {
    this.bodyHeight.set(Math.max(1, Math.round(value)));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  setBodyOffsetX(value: number) {
    this.bodyOffsetX.set(Math.round(value));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  setBodyOffsetY(value: number) {
    this.bodyOffsetY.set(Math.round(value));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  setFootprintWidth(value: number) {
    this.footprintWidth.set(Math.max(1, Math.round(value)));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  setFootprintHeight(value: number) {
    this.footprintHeight.set(Math.max(1, Math.round(value)));
    this.dirty.set(true);
    this.drawTilePreview();
  }

  movePreview(dx: number, dy: number) {
    this.previewBaseX.set(Math.max(0, Math.min(4, this.previewBaseX() + dx)));
    this.previewBaseY.set(Math.max(0, Math.min(4, this.previewBaseY() + dy)));
    this.drawTilePreview();
  }

  setPreviewAnim(type: CreatureAnimationType) {
    this.previewAnim.set(type);
    this.drawTilePreview();
  }

  openPositioning() {
    this.activeTab.set('positioning');
    setTimeout(() => this.drawTilePreview(), 0);
  }

  async saveStats() {
    this.saving.set(true);
    try { await this.api.saveCreatureStats(this.id, this.stats()); } catch (e) { this.error.set((e as Error).message); } finally { this.saving.set(false); }
  }

  async saveLoot() {
    this.saving.set(true);
    try { await this.api.saveCreatureLoot(this.id, this.loot()); } catch (e) { this.error.set((e as Error).message); } finally { this.saving.set(false); }
  }

  setStat(key: string, value: number) {
    this.stats.update((stats) => ({ ...stats, [key]: Math.max(0, Math.round(value)) }));
  }

  addLoot() {
    this.loot.update((loot) => [...loot, { id: '', itemId: null, itemName: 'Novo item', chance: 1, minQuantity: 1, maxQuantity: 1 }]);
  }

  removeLoot(index: number) {
    this.loot.update((loot) => loot.filter((_, i) => i !== index));
  }

  updateLoot(index: number, patch: Partial<CreatureDetail['loot'][number]>) {
    this.loot.update((loot) => loot.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  }

  get monsterAbilities(): CombatAbilityDefinition[] {
    return this.abilities().filter((ability) => ability.ownerType === 'monster' || ability.ownerType === 'both');
  }

  abilityName(id: number | null): string {
    if (id == null) return '—';
    const ability = this.abilities().find((a) => a.abilityId === id);
    return ability ? `${ability.name} (${ability.damageType ?? 'heal'} · range ${ability.rangeTiles})` : `#${id}`;
  }

  spellNumber(value: unknown): number | null {
    const n = Number(value);
    return value === '' || value === null || value === undefined || Number.isNaN(n) ? null : n;
  }

  addSpell() {
    this.spells.update((spells) => [...spells, { abilityId: null, enabled: true, priority: spells.length + 1, chance: 1, cooldownOverrideMs: null, minDamage: null, maxDamage: null }]);
  }

  removeSpell(index: number) {
    this.spells.update((spells) => spells.filter((_, i) => i !== index));
  }

  updateSpell(index: number, patch: Partial<MonsterSpellDraft>) {
    this.spells.update((spells) => spells.map((spell, i) => i === index ? { ...spell, ...patch } : spell));
  }

  async saveSpells() {
    this.error.set(null);
    this.saving.set(true);
    try {
      const payload = this.spells()
        .filter((spell) => spell.abilityId != null)
        .map((spell) => {
          const parameters: Record<string, number> = {};
          if (spell.minDamage != null) parameters['minDamage'] = spell.minDamage;
          if (spell.maxDamage != null) parameters['maxDamage'] = spell.maxDamage;
          return {
            abilityId: spell.abilityId as number,
            enabled: spell.enabled,
            priority: spell.priority,
            chance: spell.chance,
            cooldownOverrideMs: spell.cooldownOverrideMs ?? undefined,
            parameters: Object.keys(parameters).length > 0 ? parameters : undefined,
          };
        });
      await this.api.saveMonsterAbilities(this.id, payload);
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  async saveAffinities() {
    this.error.set(null);
    this.saving.set(true);
    try {
      const res = await this.api.saveCreatureAffinities(this.id, this.affinities());
      this.affinities.set(res.affinities);
      this.creature.update((c) => (c ? { ...c, damageAffinities: res.affinities } : c));
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.saving.set(false);
    }
  }

  setAffinity(type: DamageType, modifier: number, immune: boolean) {
    this.affinities.update((value) => ({ ...value, [type]: { modifier: Math.max(-1, Math.min(2, modifier)), immune } }));
  }

  resetAffinities() {
    this.affinities.update((value) => Object.fromEntries(this.damageTypes.map((type) => [type, { modifier: 0, immune: false }])) as DamageAffinities);
  }

  affinityState(type: DamageType): string {
    const value = this.affinities()[type]?.modifier ?? 0;
    return value < 0 ? 'Fraqueza' : value > 0 ? 'Resistência' : 'Neutro';
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

  private previewFrameIndex(): number {
    const seq = this.sequences().find((s) => s.animation === this.previewAnim());
    if (!seq || seq.frames.length === 0) return -1;
    return seq.frames[0];
  }

  /** Preview 5x5 tiles com debug (grid/footprint/bounds/anchor/projectile origin). */
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

    if (this.showFootprint()) {
      ctx.strokeStyle = '#00ff00';
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD + bx * TILE, PAD + by * TILE, TILE * this.footprintWidth(), TILE * this.footprintHeight());
    }

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
      ctx.strokeStyle = '#ff00ff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pox - 6, poy);
      ctx.lineTo(pox + 6, poy);
      ctx.moveTo(pox, poy - 6);
      ctx.lineTo(pox, poy + 6);
      ctx.stroke();
      ctx.fillStyle = '#ff00ff';
      ctx.fillRect(pox - 2, poy - 2, 5, 5);
    }
  }
}

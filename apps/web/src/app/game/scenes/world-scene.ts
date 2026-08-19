import Phaser from 'phaser';
import { SERVER_EVENTS } from '@aetheria/protocol';
import { APPEARANCE_PALETTE, MOVE_INTERVAL_MS, TILE } from '@aetheria/config';
import type { CreatureState, Direction, ItemImpactVisual, ItemProjectileVisual, MapTile, PlayerAppearance, Position, ProjectileDirection } from '@aetheria/types';
import { WsService } from '../../core/ws.service';
import { WS_URL } from '../../core/ws.service';
import { GameState } from '../game-state';
import { CreatureAnimator, type AnimConfig, type AnimDirection, type AnimType } from '../creature-animator';
import { CreatureAssetService } from '../creature-asset.service';
import { OutfitAssetService, type OutfitAnimData } from '../outfit-asset.service';
import { recolorCanvas } from '../outfit-recolor';

const TILE_SIZE = 32;

interface EntityInfo {
  name: string;
  health: number;
  maxHealth: number;
}

interface RenderedEntity {
  kind: string;
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  healthBack?: Phaser.GameObjects.Image;
  healthFront?: Phaser.GameObjects.Image;
  spriteHeight: number;
}

interface CreatureAnimState {
  animator: CreatureAnimator;
  textureKey: string;
  moveSpeed: number;
  lastMoveAt: number;
}

function toAnimDirection(facing: Direction): AnimDirection {
  if (facing === 'north' || facing === 'northeast' || facing === 'northwest') return 'north';
  if (facing === 'south' || facing === 'southeast' || facing === 'southwest') return 'south';
  if (facing === 'west') return 'west';
  return 'east';
}

function animForState(state: CreatureState): AnimType {
  switch (state) {
    case 'ATTACK':
      return 'attack';
    case 'DEAD':
      return 'death';
    case 'WANDER':
    case 'CHASE':
    case 'RETURN':
    case 'FLEE':
      return 'walk';
    default:
      return 'idle';
  }
}

export class WorldScene extends Phaser.Scene {
  private ws!: WsService;
  private state!: GameState;
  private assets!: CreatureAssetService;
  private outfits!: OutfitAssetService;
  private tileImages: Phaser.GameObjects.Image[] = [];
  private entities = new Map<string, RenderedEntity>();
  private entityInfo = new Map<string, EntityInfo>();
  private loot = new Map<string, Phaser.GameObjects.Image>();
  private selfId = '';
  private selfEntity: RenderedEntity | null = null;
  private selfAnim: CreatureAnimState | null = null;
  private lastSeq = -1;
  private moveDir: Direction | null = null;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private creatureAnims = new Map<string, CreatureAnimState>();
  private definitionCreatureIds = new Map<string, number>();
  private loadingTextures = new Set<string>();
  private debugVisible = false;
  private debugOverlay!: Phaser.GameObjects.Text;
  private mapBounds: { width?: number; height?: number } = {};

  constructor() {
    super('World');
  }

  create(data: { ws: WsService; state: GameState; assets: CreatureAssetService; outfits: OutfitAssetService }) {
    this.ws = data.ws;
    this.state = data.state;
    this.assets = data.assets;
    this.outfits = data.outfits;
    this.load.setCORS('anonymous');
    this.buildTextures();

    this.state.sceneEvents$.subscribe((e) => {
      if (e.seq <= this.lastSeq) return;
      this.lastSeq = e.seq;
      this.handleEvent(e.event, e.data);
    });
    for (const e of this.state.drainBuffer()) {
      if (e.seq <= this.lastSeq) continue;
      this.lastSeq = e.seq;
      this.handleEvent(e.event, e.data);
    }

    this.cameras.main.setBackgroundColor('#17202a');
    this.cameras.main.setZoom(1);
    this.applyZoom(this.state.zoom());
    this.state.zoom$.subscribe((z) => this.applyZoom(z));
    this.applySmoothing(this.state.hdSmooth());
    this.state.hdSmooth$.subscribe((smooth) => this.applySmoothing(smooth));
    this.textures.on('addtexture', () => this.applySmoothing(this.state.hdSmooth()));
    this.setupKeyboard();
    this.setupDebug();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer));
  }

  // ------------------------------------------------------------------ events

  private handleEvent(event: string, data: unknown) {
    switch (event) {
      case SERVER_EVENTS.ENTER_WORLD: {
        const w = data as { character: { id: string; name: string; position: Position; appearance?: PlayerAppearance }; map: MapTile[]; width: number; height: number };
        this.resetScene(w.map, w.character.id, w.character.name, w.character.position, w.width, w.height, w.character.appearance);
        break;
      }
      case SERVER_EVENTS.ENTER_ARENA: {
        const w = data as { character: { id: string; name: string; position: Position; appearance?: PlayerAppearance }; map: MapTile[]; width: number; height: number };
        this.resetScene(w.map, w.character.id, w.character.name, w.character.position, w.width, w.height, w.character.appearance);
        break;
      }
      case SERVER_EVENTS.ENTITY_SPAWNED: {
        const s = data as { id: string; kind: string; name: string; position: Position; health?: number; maxHealth?: number };
        if (s.id === this.selfId) return;
        this.addEntity(s.id, s.kind, s.name, s.position, s.health, s.maxHealth);
        break;
      }
      case SERVER_EVENTS.ENTITY_MOVED: {
        const m = data as { id: string; position: Position };
        this.moveEntity(m.id, m.position);
        break;
      }
      case SERVER_EVENTS.ENTITY_REMOVED: {
        this.removeEntity((data as { id: string }).id);
        break;
      }
      case SERVER_EVENTS.PLAYER_MOVED: {
        const m = data as { position: Position };
        if (this.selfEntity) this.moveRendered(this.selfEntity, m.position);
        break;
      }
      case SERVER_EVENTS.ENTITY_HEALTH: {
        const h = data as { id: string; health: number; maxHealth: number };
        this.updateHealth(h.id, h.health, h.maxHealth);
        break;
      }
      case SERVER_EVENTS.CREATURE_SPAWN: {
        const c = data as {
          creatureId: string;
          definitionId: string;
          definitionCreatureId?: number;
          slug: string;
          name: string;
          position: Position;
          facing: Direction;
          state: CreatureState;
          health: number;
          maxHealth: number;
          movementSpeed?: number;
        };
        this.addCreature(c.creatureId, c.slug, c.name, c.position, c.health, c.maxHealth, c.definitionCreatureId, c.facing, c.state, c.movementSpeed ?? MOVE_INTERVAL_MS);
        break;
      }
      case SERVER_EVENTS.CREATURE_MOVE: {
        const m = data as { creatureId: string; from: Position; to: Position; facing: Direction; state: CreatureState; timestamp: number };
        this.moveCreature(m.creatureId, m.to, m.facing, m.state);
        break;
      }
      case SERVER_EVENTS.CREATURE_ATTACK: {
        const a = data as { creatureId: string; targetId: string; position: Position };
        const rendered = this.entities.get(a.creatureId);
        if (rendered) this.flashEntity(rendered);
        this.playCreatureAnim(a.creatureId, 'attack');
        break;
      }
      case SERVER_EVENTS.CREATURE_DAMAGE: {
        const d = data as { creatureId: string; attackerId: string; amount: number; critical: boolean; health: number; maxHealth: number };
        this.updateHealth(d.creatureId, d.health, d.maxHealth);
        const rendered = this.entities.get(d.creatureId);
        const x = rendered?.image.x ?? 0;
        const y = rendered?.image.y ?? 0;
        this.showDamage(x, y, d.amount, d.critical, rendered?.spriteHeight ?? TILE_SIZE);
        break;
      }
      case SERVER_EVENTS.CREATURE_DEATH: {
        const de = data as { creatureId: string; experience: number };
        if (this.state.target()?.id === de.creatureId) this.state.clearTarget();
        if (de.experience) this.state.addSystemMessage(`+${de.experience} XP`);
        this.playCreatureAnim(de.creatureId, 'death');
        const rendered = this.entities.get(de.creatureId);
        if (rendered) {
          this.tweens.add({
            targets: [rendered.image, rendered.label],
            alpha: 0.25,
            duration: 500,
            onComplete: () => {
              if (rendered.healthBack) rendered.healthBack.alpha = 0.25;
              if (rendered.healthFront) rendered.healthFront.alpha = 0.25;
            },
          });
        }
        break;
      }
      case SERVER_EVENTS.CREATURE_REMOVE: {
        this.removeEntity((data as { creatureId: string }).creatureId);
        break;
      }
      case SERVER_EVENTS.APPEARANCE_CHANGED: {
        const r = data as { entityId: string; outfitId: number; addonMask: number; colors: { head: number; primary: number; secondary: number; detail: number } };
        if (r.entityId === this.selfId) {
          void this.setupPlayerOutfit(this.selfId, { outfitId: r.outfitId, addonMask: r.addonMask, colors: r.colors });
        }
        break;
      }
      case SERVER_EVENTS.COMBAT_DAMAGE: {
        const d = data as { attackerId: string; targetId: string; amount: number; critical: boolean; delayMs?: number };
        const show = () => this.showCombatDamage(d.targetId, d.amount, d.critical);
        if (d.delayMs && d.delayMs > 0) this.time.delayedCall(d.delayMs, show);
        else show();
        break;
      }
      case SERVER_EVENTS.COMBAT_PROJECTILE: {
        const d = data as { attackerId: string; targetId: string; from: Position; to: Position; projectile: ItemProjectileVisual; impact?: ItemImpactVisual; travelTimeMs: number };
        this.playProjectile(d.attackerId, d.targetId, d.from, d.to, d.projectile, d.impact, d.travelTimeMs);
        break;
      }
      case SERVER_EVENTS.COMBAT_DEATH: {
        const de = data as { entityId: string; experience?: number };
        if (this.state.target()?.id === de.entityId) this.state.clearTarget();
        if (de.experience) this.state.addSystemMessage(`+${de.experience} XP`);
        break;
      }
      case SERVER_EVENTS.LOOT_SPAWNED: {
        const l = data as { entityId: string; position: Position };
        const x = l.position.x * TILE_SIZE + TILE_SIZE / 2;
        const y = l.position.y * TILE_SIZE + TILE_SIZE / 2;
        const img = this.add.image(x, y, 'loot').setDepth(l.position.y * 0.01 + 0.5).setOrigin(0.5);
        this.loot.set(l.entityId, img);
        break;
      }
      case SERVER_EVENTS.LOOT_REMOVED: {
        const img = this.loot.get((data as { entityId: string }).entityId);
        if (img) {
          img.destroy();
          this.loot.delete((data as { entityId: string }).entityId);
        }
        break;
      }
      case SERVER_EVENTS.ERROR: {
        this.state.addSystemMessage((data as { message: string }).message);
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ world

  private resetScene(map: MapTile[], selfId: string, selfName: string, selfPosition: Position, width?: number, height?: number, appearance?: PlayerAppearance) {
    for (const [id, ent] of this.entities) {
      ent.image.destroy();
      ent.label.destroy();
      ent.healthBack?.destroy();
      ent.healthFront?.destroy();
      void id;
    }
    this.entities.clear();
    this.entityInfo.clear();
    this.creatureAnims.clear();
    this.definitionCreatureIds.clear();
    this.selfAnim = null;
    for (const img of this.loot.values()) img.destroy();
    this.loot.clear();
    this.selfEntity = null;
    this.selfId = selfId;
    this.mapBounds = { width, height };
    this.state.clearTarget();
    this.buildMap(map);
    this.spawnSelf(selfId, selfName, selfPosition, appearance);
    this.applyCameraBounds();
  }

  private applyZoom(z: number) {
    this.cameras.main.setZoom(z);
    this.applyCameraBounds();
    this.applyTextResolution();
  }

  /** Resolução interna dos textos do mundo (mantém nítido ao dar zoom). */
  private textResolution(): number {
    return Math.max(1, Math.ceil(this.cameras.main.zoom * (window.devicePixelRatio || 1)));
  }

  private applyTextResolution() {
    const res = this.textResolution();
    for (const [, ent] of this.entities) ent.label.setResolution(res);
    this.debugOverlay?.setResolution(res);
  }

  private applyCameraBounds() {
    const cam = this.cameras.main;
    const width = this.mapBounds.width;
    const height = this.mapBounds.height;
    if (width && height) {
      const w = width * TILE_SIZE;
      const h = height * TILE_SIZE;
      cam.setBounds(0, 0, w, h);
      const viewW = cam.width / cam.zoom;
      const viewH = cam.height / cam.zoom;
      if (w < viewW || h < viewH) {
        cam.stopFollow();
        cam.centerOn(w / 2, h / 2);
      } else if (this.selfEntity) {
        cam.startFollow(this.selfEntity.image, false, 0.1, 0.1);
      }
    } else {
      cam.setBounds(0, 0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    }
  }

  private buildMap(map: MapTile[]) {
    for (const img of this.tileImages) img.destroy();
    this.tileImages = [];
    for (const tile of map) {
      const x = tile.x * TILE_SIZE + TILE_SIZE / 2;
      const y = tile.y * TILE_SIZE + TILE_SIZE / 2;
      const img = this.add.image(x, y, `tile_${tile.type}`).setDepth(0).setOrigin(0.5);
      this.tileImages.push(img);
    }
  }

  private spawnSelf(id: string, name: string, position: Position, appearance?: PlayerAppearance) {
    this.selfEntity = this.createRendered('player', name, position);
    this.entities.set(id, this.selfEntity);
    this.entityInfo.set(id, { name, health: 0, maxHealth: 0 });
    this.cameras.main.startFollow(this.selfEntity.image, false, 0.1, 0.1);
    if (appearance) void this.setupPlayerOutfit(id, appearance);
  }

  private async setupPlayerOutfit(id: string, appearance: PlayerAppearance) {
    const data = await this.outfits.loadConfig(appearance.outfitId);
    if (!data) return;
    const frameW = data.config.spriteWidth;
    const frameH = data.config.spriteHeight;
    const recolored = data.supportsColors && data.colorMaskAssetId;
    const textureKey = recolored
      ? `outfit_${appearance.outfitId}_${appearance.colors.head}_${appearance.colors.primary}_${appearance.colors.secondary}_${appearance.colors.detail}`
      : `outfit_sheet_${appearance.outfitId}`;

    if (!this.textures.exists(textureKey)) {
      if (recolored) await this.buildRecoloredOutfit(textureKey, data, appearance.colors);
      else await this.loadSheet(textureKey, this.outfits.textureUrl(appearance.outfitId), frameW, frameH);
    }

    const rendered = this.entities.get(id);
    if (!rendered || !this.textures.exists(textureKey)) return;
    const animator = new CreatureAnimator(data.config, 'south');
    animator.play('idle', this.time.now);
    this.selfAnim = { animator, textureKey, moveSpeed: MOVE_INTERVAL_MS, lastMoveAt: this.time.now };
    rendered.spriteHeight = frameH;
    rendered.image.setTexture(textureKey).setTint(0xffffff).setScale(1).setFrame(animator.frameIndex(this.time.now));
    this.repositionWorldUi(rendered);
  }

  private loadSheet(key: string, url: string, frameWidth: number, frameHeight: number): Promise<void> {
    if (this.textures.exists(key)) return Promise.resolve();
    return new Promise((resolve) => {
      this.load.spritesheet(key, url, { frameWidth, frameHeight });
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => resolve());
      this.load.start();
    });
  }

  private loadImages(entries: { key: string; url: string }[]): Promise<void> {
    const missing = entries.filter((e) => !this.textures.exists(e.key));
    if (missing.length === 0) return Promise.resolve();
    for (const e of missing) this.load.image(e.key, e.url);
    return new Promise((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => resolve());
      this.load.start();
    });
  }

  private async buildRecoloredOutfit(textureKey: string, data: OutfitAnimData, colors: PlayerAppearance['colors']): Promise<void> {
    const baseKey = `outfit_base_${data.outfitId}`;
    const maskKey = `outfit_mask_${data.outfitId}`;
    await this.loadImages([
      { key: baseKey, url: this.outfits.textureUrl(data.outfitId) },
      { key: maskKey, url: this.outfits.maskUrl(data.outfitId) },
    ]);
    const base = this.textures.get(baseKey).getSourceImage() as HTMLImageElement;
    const mask = this.textures.get(maskKey).getSourceImage() as HTMLImageElement;
    if (!base || !mask) return;
    const canvas = recolorCanvas(base, mask, base.width, base.height, colors, APPEARANCE_PALETTE);
    const img = new Image();
    img.src = canvas.toDataURL('image/png');
    await new Promise<void>((resolve) => { img.onload = () => resolve(); });
    this.textures.addSpriteSheet(textureKey, img, { frameWidth: data.config.spriteWidth, frameHeight: data.config.spriteHeight });
  }

  private addEntity(id: string, kind: string, name: string, position: Position, health?: number, maxHealth?: number) {
    const rendered = this.createRendered(kind, name, position);
    if (health !== undefined && maxHealth !== undefined) {
      this.attachHealthBar(rendered, health, maxHealth);
    }
    this.entities.set(id, rendered);
    this.entityInfo.set(id, { name, health: health ?? 0, maxHealth: maxHealth ?? 0 });
  }

  private createRendered(kind: string, name: string, position: Position): RenderedEntity {
    const x = position.x * TILE_SIZE + TILE_SIZE / 2;
    const y = position.y * TILE_SIZE + TILE_SIZE / 2;
    const color = kind === 'monster' ? 0xe04d4d : kind === 'npc' ? 0xf0c14b : 0x4d86ff;
    const image = this.add.image(x, y, 'circle').setTint(color).setOrigin(0.5, 1).setDisplaySize(TILE_SIZE, TILE_SIZE);
    const label = this.add
      .text(x, y - TILE_SIZE - 6, name, {
        fontFamily: 'Arial',
        fontSize: '11px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        resolution: this.textResolution(),
      })
      .setOrigin(0.5);
    const depth = position.y * 0.01 + 1;
    image.setDepth(depth);
    label.setDepth(depth + 0.01);
    return { kind, image, label, spriteHeight: TILE_SIZE };
  }

  private attachHealthBar(rendered: RenderedEntity, health: number, maxHealth: number) {
    const depth = rendered.image.depth;
    const back = this.add.image(rendered.image.x, rendered.image.y - rendered.spriteHeight - 4, 'barBack').setOrigin(0.5).setDepth(depth + 0.02);
    const front = this.add.image(rendered.image.x, rendered.image.y - rendered.spriteHeight - 4, 'barFront').setOrigin(0.5).setDepth(depth + 0.03);
    rendered.healthBack = back;
    rendered.healthFront = front;
    this.setBar(front, health, maxHealth);
  }

  /** Reposiciona nome/barra de vida acima do sprite (altura pode variar). */
  private repositionWorldUi(rendered: RenderedEntity) {
    const top = rendered.image.y - rendered.spriteHeight;
    rendered.label.setPosition(rendered.image.x, top - 6);
    if (rendered.healthBack && rendered.healthFront) {
      rendered.healthBack.setPosition(rendered.image.x, top - 4);
      rendered.healthFront.setPosition(rendered.image.x, top - 4);
    }
  }

  private addCreature(
    id: string,
    slug: string,
    name: string,
    position: Position,
    health: number,
    maxHealth: number,
    definitionCreatureId?: number,
    facing?: Direction,
    state?: CreatureState,
    moveSpeed = MOVE_INTERVAL_MS,
  ) {
    const rendered = this.createRendered('monster', name, position);
    this.attachHealthBar(rendered, health, maxHealth);
    this.entities.set(id, rendered);
    this.entityInfo.set(id, { name, health, maxHealth });
    void slug;
    if (definitionCreatureId) {
      this.definitionCreatureIds.set(id, definitionCreatureId);
      void this.setupCreatureAnimation(id, definitionCreatureId, facing ?? 'south', state ?? 'IDLE', moveSpeed);
    }
    this.updateDebugOverlay();
  }

  private async setupCreatureAnimation(id: string, creatureId: number, facing: Direction, state: CreatureState, moveSpeed: number) {
    const config = await this.assets.loadConfig(creatureId);
    if (!config) return;
    const textureKey = `creature_sheet_${creatureId}`;
    const apply = () => {
      const rendered = this.entities.get(id);
      if (rendered && this.textures.exists(textureKey)) this.applyCreatureTexture(id, rendered, textureKey, config, facing, state, moveSpeed);
    };
    if (this.textures.exists(textureKey)) {
      apply();
      return;
    }
    if (!this.loadingTextures.has(textureKey)) {
      this.loadingTextures.add(textureKey);
      this.load.spritesheet(textureKey, this.assets.textureUrl(creatureId), { frameWidth: config.spriteWidth, frameHeight: config.spriteHeight });
      this.load.once(Phaser.Loader.Events.COMPLETE, () => this.loadingTextures.delete(textureKey));
      this.load.start();
    }
    this.load.once(Phaser.Loader.Events.COMPLETE, apply);
  }

  private applyCreatureTexture(id: string, rendered: RenderedEntity, textureKey: string, config: AnimConfig, facing: Direction, state: CreatureState, moveSpeed: number) {
    const animator = new CreatureAnimator(config, toAnimDirection(facing));
    animator.play(animForState(state), this.time.now);
    this.creatureAnims.set(id, { animator, textureKey, moveSpeed, lastMoveAt: this.time.now });
    rendered.spriteHeight = config.spriteHeight;
    rendered.image.setTexture(textureKey).setTint(0xffffff).setScale(1).setFrame(animator.frameIndex(this.time.now));
    this.repositionWorldUi(rendered);
  }

  private updateCreatureAnim(id: string, facing: Direction, state: CreatureState) {
    const anim = this.creatureAnims.get(id);
    if (anim) {
      anim.animator.setDirection(toAnimDirection(facing));
      anim.animator.play(animForState(state), this.time.now);
      anim.lastMoveAt = this.time.now;
    }
  }

  private playCreatureAnim(id: string, type: AnimType) {
    const anim = this.creatureAnims.get(id);
    if (anim) anim.animator.playOnce(type, this.time.now);
  }

  override update(time: number) {
    for (const [id, anim] of this.creatureAnims) {
      const rendered = this.entities.get(id);
      if (!rendered) continue;
      rendered.image.setFrame(anim.animator.frameIndex(time));
      if (anim.animator.currentType === 'walk' && time - anim.lastMoveAt > anim.moveSpeed + 80) {
        anim.animator.play('idle', time);
      }
    }
    if (this.selfAnim && this.selfEntity) {
      this.selfEntity.image.setFrame(this.selfAnim.animator.frameIndex(time));
    }
  }

  private flashEntity(rendered: RenderedEntity) {
    const s = rendered.image.scaleX;
    this.tweens.add({
      targets: rendered.image,
      scaleX: s * 1.25,
      scaleY: s * 1.25,
      duration: 90,
      yoyo: true,
      ease: 'Linear',
    });
  }

  private moveEntity(id: string, position: Position) {
    const rendered = this.entities.get(id);
    if (rendered) this.moveRendered(rendered, position);
  }

  private moveCreature(id: string, position: Position, facing: Direction, state: CreatureState) {
    const anim = this.creatureAnims.get(id);
    const rendered = this.entities.get(id);
    if (rendered) this.moveRendered(rendered, position, anim?.moveSpeed ?? MOVE_INTERVAL_MS);
    this.updateCreatureAnim(id, facing, state);
  }

  private moveRendered(rendered: RenderedEntity, position: Position, duration = MOVE_INTERVAL_MS) {
    const x = position.x * TILE_SIZE + TILE_SIZE / 2;
    const y = position.y * TILE_SIZE + TILE_SIZE / 2;
    const depth = position.y * 0.01 + 1;
    rendered.image.setDepth(depth);
    rendered.label.setDepth(depth + 0.01);
    if (rendered.healthBack) {
      rendered.healthBack.setDepth(depth + 0.02);
      rendered.healthFront?.setDepth(depth + 0.03);
    }
    this.tweens.add({
      targets: rendered.image,
      x,
      y,
      duration,
      ease: 'Linear',
      onUpdate: () => this.repositionWorldUi(rendered),
    });
  }

  private removeEntity(id: string) {
    const rendered = this.entities.get(id);
    if (rendered) {
      rendered.image.destroy();
      rendered.label.destroy();
      rendered.healthBack?.destroy();
      rendered.healthFront?.destroy();
      this.entities.delete(id);
      this.entityInfo.delete(id);
      this.creatureAnims.delete(id);
      this.definitionCreatureIds.delete(id);
      if (id === this.selfId) this.selfEntity = null;
    }
  }

  private updateHealth(id: string, health: number, maxHealth: number) {
    const info = this.entityInfo.get(id);
    if (info) {
      info.health = health;
      info.maxHealth = maxHealth;
    }
    const rendered = this.entities.get(id);
    if (rendered && rendered.healthFront) {
      this.setBar(rendered.healthFront, health, maxHealth);
    }
  }

  private setBar(front: Phaser.GameObjects.Image, health: number, maxHealth: number) {
    const ratio = Math.max(0, Math.min(1, health / Math.max(1, maxHealth)));
    front.setDisplaySize(Math.max(1, ratio * TILE_SIZE), 5);
  }

  // ------------------------------------------------------------------ input

  private setupKeyboard() {
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    const cursors = this.input.keyboard!.createCursorKeys();
    const check = () => {
      if (this.state.inArena()) {
        if (this.moveDir) {
          this.moveDir = null;
          this.ws.send({ type: 'game.input', direction: null });
        }
        return;
      }
      const up = this.keys['W'].isDown || cursors.up.isDown;
      const down = this.keys['S'].isDown || cursors.down.isDown;
      const left = this.keys['A'].isDown || cursors.left.isDown;
      const right = this.keys['D'].isDown || cursors.right.isDown;
      let dir: Direction | null = null;
      if (up && right) dir = 'northeast';
      else if (up && left) dir = 'northwest';
      else if (down && right) dir = 'southeast';
      else if (down && left) dir = 'southwest';
      else if (up) dir = 'north';
      else if (down) dir = 'south';
      else if (left) dir = 'west';
      else if (right) dir = 'east';
      if (dir !== this.moveDir) {
        this.moveDir = dir;
        this.ws.send({ type: 'game.input', direction: dir });
        this.updateSelfAnim(dir);
      }
    };
    this.input.keyboard!.on('keydown', check);
    this.input.keyboard!.on('keyup', check);
  }

  private updateSelfAnim(dir: Direction | null) {
    if (!this.selfAnim) return;
    if (dir) {
      this.selfAnim.animator.setDirection(toAnimDirection(dir));
      this.selfAnim.animator.play('walk', this.time.now);
    } else {
      this.selfAnim.animator.play('idle', this.time.now);
    }
  }

  private setupDebug() {
    this.debugOverlay = this.add
      .text(10, 10, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#9be0ff',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 6, y: 4 },
        resolution: this.textResolution(),
      })
      .setDepth(500)
      .setScrollFactor(0)
      .setOrigin(0)
      .setVisible(false);
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        this.debugVisible = !this.debugVisible;
        this.debugOverlay.setVisible(this.debugVisible);
        this.updateDebugOverlay();
      }
    });
    this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        if (this.debugVisible) this.updateDebugOverlay();
      },
    });
  }

  private updateDebugOverlay() {
    if (!this.debugVisible) return;
    const creatures = [...this.entities.values()].filter((e) => e.kind === 'monster').length;
    this.debugOverlay.setText(
      [
        `FPS: ${Math.round(this.game.loop.actualFps)}`,
        `Entidades: ${this.entities.size}`,
        `Criaturas: ${creatures}`,
        `Sprites: ${this.creatureAnims.size}`,
        `Zoom: ${this.cameras.main.zoom.toFixed(2)}`,
      ].join('\n'),
    );
  }

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    const tx = Math.round(pointer.worldX / TILE_SIZE);
    const ty = Math.round(pointer.worldY / TILE_SIZE);

    for (const [id, ent] of this.entities) {
      if (id === this.selfId) continue;
      const ex = Math.round(ent.image.x / TILE_SIZE);
      const ey = Math.round(ent.image.y / TILE_SIZE);
      if (ex === tx && ey === ty) {
        if (ent.kind === 'npc') {
          this.ws.send({ type: 'npc.interact', npcId: id });
        } else {
          this.selectTarget(id, ent);
        }
        return;
      }
    }

    for (const [id, img] of this.loot) {
      const lx = Math.round(img.x / TILE_SIZE);
      const ly = Math.round(img.y / TILE_SIZE);
      if (lx === tx && ly === ty) {
        this.ws.send({ type: 'game.pickup', entityId: id });
        return;
      }
    }
  }

  private selectTarget(id: string, ent: RenderedEntity) {
    const info = this.entityInfo.get(id);
    this.state.target.set({
      id,
      name: info?.name ?? 'Alvo',
      health: info?.health ?? 0,
      maxHealth: info?.maxHealth ?? 0,
    });
    this.ws.send({ type: 'game.attack', targetId: id });
  }

  private showDamage(x: number, y: number, amount: number, critical: boolean, spriteHeight = TILE_SIZE) {
    const text = this.add
      .text(x, y - spriteHeight - 8, String(amount), {
        fontFamily: 'Arial',
        fontSize: critical ? '20px' : '15px',
        color: critical ? '#ffcf3f' : '#ff6b6b',
        stroke: '#1a1a1a',
        strokeThickness: 3,
        resolution: this.textResolution(),
      })
      .setOrigin(0.5)
      .setDepth(100);
    this.tweens.add({
      targets: text,
      y: y - spriteHeight - 24,
      alpha: 0,
      duration: 700,
      onComplete: () => text.destroy(),
    });
  }

  private showCombatDamage(targetId: string, amount: number, critical: boolean) {
    const info = this.entityInfo.get(targetId);
    if (!info && targetId !== this.selfId) return;
    const ent = this.entities.get(targetId);
    const x = ent?.image.x ?? (this.selfEntity && targetId === this.selfId ? this.selfEntity.image.x : 0);
    const y = ent?.image.y ?? (this.selfEntity && targetId === this.selfId ? this.selfEntity.image.y : 0);
    const h = ent?.spriteHeight ?? (this.selfEntity && targetId === this.selfId ? this.selfEntity.spriteHeight : TILE_SIZE);
    this.showDamage(x, y, amount, critical, h);
  }

  private playProjectile(attackerId: string, targetId: string, from: Position, to: Position, projectile: ItemProjectileVisual, impact: ItemImpactVisual | undefined, travelTimeMs: number) {
    if (!projectile.sprite && !projectile.spriteAssetId) return;
    const textureKey = this.effectTextureKey('projectile', projectile.sprite || String(projectile.spriteAssetId ?? ''), projectile.frameWidth, projectile.frameHeight);
    const start = this.entityCenter(attackerId, from);
    const end = this.entityCenter(targetId, to);
    const frame = projectile.frames[this.projectileDirection(from, to)] ?? 0;
    const run = () => {
      if (!this.textures.exists(textureKey)) return;
      const shot = this.add.image(start.x + (projectile.offsetX ?? 0), start.y + (projectile.offsetY ?? 0), textureKey, frame).setDepth(90).setOrigin(0.5);
      this.tweens.add({
        targets: shot,
        x: end.x,
        y: end.y,
        duration: Math.max(80, travelTimeMs),
        onComplete: () => {
          shot.destroy();
          if (impact?.sprite || impact?.spriteAssetId) this.playImpact(end.x, end.y, impact);
        },
      });
    };
    if (this.textures.exists(textureKey)) run();
    else {
      this.load.spritesheet(textureKey, this.assetPath(projectile.sprite, projectile.spriteAssetId), { frameWidth: projectile.frameWidth, frameHeight: projectile.frameHeight });
      this.load.once(Phaser.Loader.Events.COMPLETE, run);
      this.load.start();
    }
  }

  private playImpact(x: number, y: number, impact: ItemImpactVisual) {
    const textureKey = this.effectTextureKey('impact', impact.sprite || String(impact.spriteAssetId ?? ''), impact.frameWidth, impact.frameHeight);
    const run = () => {
      if (!this.textures.exists(textureKey)) return;
      const key = `${textureKey}:anim:${impact.frames.join('-')}:${impact.fps ?? 12}`;
      if (!this.anims.exists(key)) {
        this.anims.create({ key, frames: impact.frames.map((frame) => ({ key: textureKey, frame })), frameRate: impact.fps ?? 12, repeat: 0 });
      }
      const sprite = this.add.sprite(x, y, textureKey, impact.frames[0] ?? 0).setDepth(95).setOrigin(0.5);
      sprite.play(key);
      sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => sprite.destroy());
      this.time.delayedCall(Math.max(120, ((impact.frames.length || 1) / (impact.fps ?? 12)) * 1000 + 80), () => sprite.destroy());
    };
    if (this.textures.exists(textureKey)) run();
    else {
      this.load.spritesheet(textureKey, this.assetPath(impact.sprite, impact.spriteAssetId), { frameWidth: impact.frameWidth, frameHeight: impact.frameHeight });
      this.load.once(Phaser.Loader.Events.COMPLETE, run);
      this.load.start();
    }
  }

  private entityCenter(entityId: string, fallback: Position): { x: number; y: number } {
    const ent = this.entities.get(entityId) ?? (entityId === this.selfId ? this.selfEntity : null);
    return ent ? { x: ent.image.x, y: ent.image.y } : { x: fallback.x * TILE_SIZE + TILE_SIZE / 2, y: fallback.y * TILE_SIZE + TILE_SIZE / 2 };
  }

  private projectileDirection(from: Position, to: Position): ProjectileDirection {
    const dx = Math.sign(to.x - from.x);
    const dy = Math.sign(to.y - from.y);
    if (dx === 0 && dy < 0) return 'north';
    if (dx > 0 && dy < 0) return 'northEast';
    if (dx > 0 && dy === 0) return 'east';
    if (dx > 0 && dy > 0) return 'southEast';
    if (dx === 0 && dy > 0) return 'south';
    if (dx < 0 && dy > 0) return 'southWest';
    if (dx < 0 && dy === 0) return 'west';
    return 'northWest';
  }

  private effectTextureKey(kind: string, sprite: string, frameWidth: number, frameHeight: number): string {
    return `${kind}:${sprite}:${frameWidth}x${frameHeight}`.replace(/[^a-zA-Z0-9:_-]+/g, '_');
  }

  private assetPath(sprite: string, spriteAssetId?: number): string {
    if (spriteAssetId) return `${WS_URL}/assets/sprite-assets/${spriteAssetId}`;
    if (/^https?:\/\//.test(sprite) || sprite.startsWith('/') || sprite.startsWith('assets/')) return sprite;
    return `assets/effects/${sprite}`;
  }

  // ------------------------------------------------------------------ textures

  private buildTextures() {
    if (this.textures.exists('tile_0')) return;
    this.makeTile(TILE.GRASS, '#4a8a3d', '#57964a', '#3f7a35');
    this.makeTile(TILE.PATH, '#b3a06c', '#c0ad78', '#a3925f');
    this.makeTile(TILE.WATER, '#3d6fa3', '#4a7db3', '#35628f');
    this.makeTile(TILE.TREE, '#4a8a3d', '#57964a', '#3f7a35');
    this.makeTile(TILE.ROCK, '#8a8d92', '#979a9f', '#7b7e83');
    this.makeTile(TILE.WALL, '#565a60', '#62666c', '#4a4e54');

    this.makeCircle('circle', '#ffffff');
    this.makeLoot();
    this.makeBar('barBack', '#3a3f45');
    this.makeBar('barFront', '#e0413f');
  }

  /** Aplica HD (linear/anti-aliasing) ou pixel art (nearest) a todas as texturas. */
  private applySmoothing(smooth: boolean) {
    const filter = smooth ? Phaser.Textures.FilterMode.LINEAR : Phaser.Textures.FilterMode.NEAREST;
    for (const key of this.textures.getTextureKeys()) {
      this.textures.get(key)?.setFilter(filter);
    }
    this.cameras.main.setRoundPixels(!smooth);
  }

  private makeTile(type: number, base: string, light: string, dark: string) {
    const tex = this.textures.createCanvas(`tile_${type}`, TILE_SIZE, TILE_SIZE);
    if (!tex) return;
    const ctx = tex.getContext();
    const k = TILE_SIZE / 48;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? light : dark;
      ctx.fillRect(Math.floor(Math.random() * TILE_SIZE), Math.floor(Math.random() * TILE_SIZE), 2, 2);
    }
    if (type === TILE.TREE) {
      ctx.fillStyle = '#2f6b2f';
      ctx.beginPath();
      ctx.arc(TILE_SIZE / 2, TILE_SIZE / 2, 16 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3f8a3f';
      ctx.beginPath();
      ctx.arc(TILE_SIZE / 2 - 5 * k, TILE_SIZE / 2 - 5 * k, 8 * k, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === TILE.ROCK) {
      ctx.fillStyle = '#6f7278';
      ctx.beginPath();
      ctx.arc(TILE_SIZE / 2, TILE_SIZE / 2, 14 * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a8d92';
      ctx.beginPath();
      ctx.arc(TILE_SIZE / 2 - 3 * k, TILE_SIZE / 2 - 3 * k, 8 * k, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === TILE.WATER) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2 * k;
      ctx.beginPath();
      ctx.moveTo(6 * k, 20 * k);
      ctx.quadraticCurveTo(12 * k, 16 * k, 18 * k, 20 * k);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(24 * k, 32 * k);
      ctx.quadraticCurveTo(30 * k, 28 * k, 36 * k, 32 * k);
      ctx.stroke();
    } else if (type === TILE.WALL) {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2 * k;
      ctx.strokeRect(4 * k, 4 * k, TILE_SIZE - 8 * k, TILE_SIZE - 8 * k);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(4 * k, 4 * k, TILE_SIZE - 8 * k, 4 * k);
    }
    tex.refresh();
  }

  private makeCircle(key: string, color: string) {
    const tex = this.textures.createCanvas(key, 34, 34);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 34, 34);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(17, 17, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
    tex.refresh();
  }

  private makeLoot() {
    const tex = this.textures.createCanvas('loot', 26, 26);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 26, 26);
    ctx.fillStyle = '#8a5a2b';
    ctx.beginPath();
    ctx.arc(13, 13, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6f4520';
    ctx.beginPath();
    ctx.arc(13, 13, 6, 0, Math.PI * 2);
    ctx.fill();
    tex.refresh();
  }

  private makeBar(key: string, color: string) {
    const tex = this.textures.createCanvas(key, 28, 5);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 28, 5);
    tex.refresh();
  }
}

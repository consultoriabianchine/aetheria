import Phaser from 'phaser';
import { SERVER_EVENTS } from '@aetheria/protocol';
import { APPEARANCE_PALETTE, CREATURE_HUD_CONFIG, MOVE_INTERVAL_MS, TILE, TILE_SIZE_PX, WORLD_TEXT_COLORS, WORLD_TEXT_FONT, WORLD_TEXT_THEME, calculateCreatureHealthBarWidth } from '@aetheria/config';
import { anchorOrigin, resolveAnchor, resolveSockets, tileBase } from '@aetheria/shared';
import type { CreatureState, DamageType, Direction, ItemImpactVisual, ItemProjectileVisual, MapRenderData, MapTile, PlayerAppearance, Position, ProjectileDirection, TileRenderDef } from '@aetheria/types';
import { WsService } from '../../core/ws.service';
import { WS_URL } from '../../core/ws.service';
import { GameState } from '../game-state';
import { CreatureAnimator, type AnimConfig, type AnimDirection, type AnimType } from '../creature-animator';
import { CreatureAssetService } from '../creature-asset.service';
import { OutfitAssetService, type OutfitAnimData } from '../outfit-asset.service';
import { recolorCanvas, recolorSpriteSheet } from '../outfit-recolor';
import { CombatTextManager } from '../combat-text/combat-text-manager';
import type { Subscription } from 'rxjs';

const TILE_SIZE = TILE_SIZE_PX;
const BAR_HEIGHT = CREATURE_HUD_CONFIG.healthBarHeight;

interface EntityInfo {
  name: string;
  health: number;
  maxHealth: number;
}

interface ResolvedSockets {
  feet: { x: number; y: number };
  center: { x: number; y: number };
  head: { x: number; y: number };
  projectileOrigin: { x: number; y: number };
}

/** Corpo visual atual/estável da criatura (âncora do HUD, não o footprint). */
interface RenderBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface RenderedEntity {
  kind: string;
  image: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  healthBack?: Phaser.GameObjects.Image;
  healthFront?: Phaser.GameObjects.Image;
  healthBorder?: Phaser.GameObjects.Image;
  healthBarWidth: number;
  health: number;
  maxHealth: number;
  spriteWidth: number;
  spriteHeight: number;
  visualBoundsWidth: number;
  visualBoundsHeight: number;
  bodyWidth: number;
  bodyHeight: number;
  bodyOffsetX: number;
  bodyOffsetY: number;
  hasBody: boolean;
  anchorX: number;
  anchorY: number;
  offsetX: number;
  offsetY: number;
  footprintWidth: number;
  footprintHeight: number;
  moveSpeed?: number;
  baseX: number;
  baseY: number;
  sockets: ResolvedSockets;
}

interface CreatureAnimState {
  animator: CreatureAnimator;
  textureKey: string;
  moveSpeed: number;
  lastMoveAt: number;
}

interface CreatureVisualMove {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedAt: number;
  durationMs: number;
}

interface CreatureDebugInfo {
  path?: Position[];
  targetId?: string;
  blocked?: boolean;
  targetPosition?: Position;
  score?: number;
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

function healthColor(ratio: number): number {
  if (ratio > 0.5) return 0x46c14a;
  if (ratio > 0.3) return 0xe8c120;
  if (ratio > 0.1) return 0xe0403f;
  return 0x7d1a1a;
}

/**
 * Corpo real visível da criatura (bodyWidth/bodyHeight), alinhado pelos pés.
 * Âncora de nome, barra de HP e dano. Exclui pixels transparentes do frame
 * (ex.: sprite 64×64 com corpo 40×40). Fallback: caixa do sprite.
 */
function bodyBoundsOf(ent: RenderedEntity): RenderBounds {
  const width = ent.bodyWidth > 0 ? ent.bodyWidth : ent.spriteWidth;
  const height = ent.bodyHeight > 0 ? ent.bodyHeight : ent.spriteHeight;
  const centerX = ent.baseX + ent.offsetX + ent.bodyOffsetX;
  const top = ent.baseY + ent.offsetY - height + ent.bodyOffsetY;
  return {
    left: centerX - width / 2,
    top,
    right: centerX + width / 2,
    bottom: top + height,
    width,
    height,
    centerX,
    centerY: top + height / 2,
  };
}

export class WorldScene extends Phaser.Scene {
  private ws!: WsService;
  private state!: GameState;
  private assets!: CreatureAssetService;
  private outfits!: OutfitAssetService;
  private tileImages: Phaser.GameObjects.Image[] = [];
  private mapBuildVersion = 0;
  private tileRenderDefs = new Map<number, TileRenderDef>();
  private entities = new Map<string, RenderedEntity>();
  private entityInfo = new Map<string, EntityInfo>();
  private loot = new Map<string, Phaser.GameObjects.Image>();
  private selfId = '';
  private selfEntity: RenderedEntity | null = null;
  private selfAnim: CreatureAnimState | null = null;
  private playerAnims = new Map<string, CreatureAnimState>();
  private lastSeq = -1;
  private moveDir: Direction | null = null;
  private selfMoveSpeed = MOVE_INTERVAL_MS;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private creatureAnims = new Map<string, CreatureAnimState>();
  private creatureMoves = new Map<string, CreatureVisualMove>();
  private creatureDebug = new Map<string, CreatureDebugInfo>();
  private definitionCreatureIds = new Map<string, number>();
  private loadingTextures = new Set<string>();
  private debugVisible = false;
  private debugOverlay!: Phaser.GameObjects.Text;
  private entityDebugVisible = (globalThis as { __SHOW_ENTITY_DEBUG__?: boolean }).__SHOW_ENTITY_DEBUG__ === true;
  private debugGraphics!: Phaser.GameObjects.Graphics;
  private mapBounds: { width?: number; height?: number } = {};
  private combatText!: CombatTextManager;
  private sceneReady = false;
  private pendingSceneEvents: { seq: number; event: string; data: unknown }[] = [];
  private sceneEventsSubscription?: Subscription;
  private panning = false;
  private panStart = { x: 0, y: 0 };
  private lastPan = { x: 0, y: 0 };
  private static readonly PAN_THRESHOLD = 6;

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
    this.combatText = new CombatTextManager(this, (entityId) => {
      const entity = this.entities.get(entityId) ?? (entityId === this.selfId ? this.selfEntity : null);
      if (!entity) return null;
      const p = entity.sockets.center;
      return {
        x: entity.baseX + entity.offsetX - entity.anchorX + p.x,
        y: entity.baseY + entity.offsetY - entity.anchorY + p.y,
      };
    });

    this.sceneEventsSubscription = this.state.sceneEvents$.subscribe((e) => {
      if (!this.sceneReady) {
        this.pendingSceneEvents.push(e);
        return;
      }
      if (e.seq <= this.lastSeq) return;
      this.lastSeq = e.seq;
      this.handleEvent(e.event, e.data);
    });
    this.events.once(Phaser.Scenes.Events.UPDATE, () => {
      this.sceneReady = true;
      const events = [...this.pendingSceneEvents, ...this.state.drainBuffer()].sort((a, b) => a.seq - b.seq);
      this.pendingSceneEvents = [];
      for (const e of events) {
        if (e.seq <= this.lastSeq) continue;
        this.lastSeq = e.seq;
        this.handleEvent(e.event, e.data);
      }
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.sceneReady = false;
      this.pendingSceneEvents = [];
      this.sceneEventsSubscription?.unsubscribe();
      this.sceneEventsSubscription = undefined;
    });

    this.cameras.main.setBackgroundColor('#17202a');
    this.cameras.main.setZoom(1);
    this.applyZoom(this.state.zoom());
    this.state.zoom$.subscribe((z) => this.applyZoom(z));
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.applyTextResolution());
    this.applySmoothing(this.state.hdSmooth());
    this.state.hdSmooth$.subscribe((smooth) => this.applySmoothing(smooth));
    this.textures.on('addtexture', () => this.applySmoothing(this.state.hdSmooth()));
    this.setupKeyboard();
    this.setupDebug();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => this.onPointerMove(pointer));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.onPointerUp(pointer));
  }

  // ------------------------------------------------------------------ events

  private handleEvent(event: string, data: unknown) {
    switch (event) {
      case SERVER_EVENTS.ENTER_WORLD: {
        const w = data as { character: { id: string; name: string; position: Position; appearance?: PlayerAppearance; health: number; maxHealth: number; movementSpeed?: number }; map: MapTile[]; width: number; height: number; render?: MapRenderData };
        this.selfMoveSpeed = w.character.movementSpeed ?? MOVE_INTERVAL_MS;
        this.resetScene(w.map, w.character.id, w.character.name, w.character.position, w.width, w.height, w.character.appearance, w.character.health, w.character.maxHealth, w.render);
        break;
      }
      case SERVER_EVENTS.ENTER_ARENA: {
        const w = data as { character: { id: string; name: string; position: Position; appearance?: PlayerAppearance; health: number; maxHealth: number; movementSpeed?: number }; members?: { id: string; name: string; position: Position; appearance?: PlayerAppearance; health: number; maxHealth: number; movementSpeed?: number }[]; map: MapTile[]; width: number; height: number; render?: MapRenderData };
        this.selfMoveSpeed = w.character.movementSpeed ?? MOVE_INTERVAL_MS;
        this.resetScene(w.map, w.character.id, w.character.name, w.character.position, w.width, w.height, w.character.appearance, w.character.health, w.character.maxHealth, w.render);
        for (const member of w.members ?? []) {
          if (member.id === this.selfId) continue;
          this.spawnPlayerEntity(member.id, member.name, member.position, member.appearance, member.health, member.maxHealth, member.movementSpeed ?? MOVE_INTERVAL_MS);
        }
        break;
      }
      case SERVER_EVENTS.ENTER_ABYSS: {
        const w = data as { character: { id: string; name: string; position: Position; appearance?: PlayerAppearance; health: number; maxHealth: number; movementSpeed?: number }; map: MapTile[]; width: number; height: number; render?: MapRenderData };
        this.selfMoveSpeed = w.character.movementSpeed ?? MOVE_INTERVAL_MS;
        this.resetScene(w.map, w.character.id, w.character.name, w.character.position, w.width, w.height, w.character.appearance, w.character.health, w.character.maxHealth, w.render);
        break;
      }
      case SERVER_EVENTS.ENTITY_SPAWNED: {
        const s = data as { id: string; kind: string; name: string; position: Position; health?: number; maxHealth?: number; movementSpeed?: number; appearance?: PlayerAppearance };
        if (s.id === this.selfId) return;
        if (s.kind === 'player') this.spawnPlayerEntity(s.id, s.name, s.position, s.appearance, s.health, s.maxHealth, s.movementSpeed ?? MOVE_INTERVAL_MS);
        else this.addEntity(s.id, s.kind, s.name, s.position, s.health, s.maxHealth);
        break;
      }
      case SERVER_EVENTS.ENTITY_MOVED: {
        const m = data as { id: string; position: Position; facing?: Direction };
        this.moveEntity(m.id, m.position);
        if (m.facing) this.updatePlayerAnimDirection(m.id, m.facing);
        break;
      }
      case SERVER_EVENTS.ENTITY_REMOVED: {
        this.removeEntity((data as { id: string }).id);
        break;
      }
      case SERVER_EVENTS.PLAYER_MOVED: {
        const m = data as { position: Position; facing?: Direction };
        if (this.selfEntity) this.movePlayerRendered(m.position, this.selfMoveSpeed);
        const facing = m.facing ?? this.moveDir;
        if (facing) this.updateSelfAnim(facing);
        break;
      }
      case SERVER_EVENTS.ENTITY_HEALTH: {
        const h = data as { id: string; health: number; maxHealth: number };
        this.updateHealth(h.id, h.health, h.maxHealth);
        break;
      }
      case SERVER_EVENTS.STATS_UPDATE: {
        const s = data as { health: number; maxHealth: number; movementSpeed?: number };
        if (s.movementSpeed) this.selfMoveSpeed = s.movementSpeed;
        if (this.selfAnim) {
          this.selfAnim.moveSpeed = this.selfMoveSpeed;
          this.selfAnim.animator.setWalkCycleMs(this.selfMoveSpeed);
        }
        const rendered = this.entities.get(this.selfId);
        if (rendered && rendered.healthFront) this.setBar(rendered.healthFront, s.health, s.maxHealth, rendered.healthBarWidth);
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
          footprintWidth?: number;
          footprintHeight?: number;
          isBoss?: boolean;
        };
        this.addCreature(c.creatureId, c.slug, c.name, c.position, c.health, c.maxHealth, c.definitionCreatureId, c.facing, c.state, c.movementSpeed ?? MOVE_INTERVAL_MS, c.footprintWidth, c.footprintHeight, c.isBoss);
        break;
      }
      case SERVER_EVENTS.CREATURE_MOVE: {
        const m = data as { creatureId: string; from: Position; to: Position; facing: Direction; state: CreatureState; timestamp: number; path?: Position[]; targetId?: string; blocked?: boolean; targetPosition?: Position; score?: number };
        this.moveCreature(m.creatureId, m.to, m.facing, m.state);
        if (m.path) this.creatureDebug.set(m.creatureId, { path: m.path, targetId: m.targetId, blocked: m.blocked, targetPosition: m.targetPosition, score: m.score });
        break;
      }
      case SERVER_EVENTS.CREATURE_ATTACK: {
        const a = data as { creatureId: string; targetId: string; position: Position; facing?: Direction };
        const rendered = this.entities.get(a.creatureId);
        if (rendered) this.flashEntity(rendered);
        if (a.facing) {
          const anim = this.creatureAnims.get(a.creatureId);
          if (anim) anim.animator.setDirection(toAnimDirection(a.facing));
        }
        this.playCreatureAnim(a.creatureId, 'attack');
        break;
      }
      case SERVER_EVENTS.CREATURE_DAMAGE: {
        const d = data as { creatureId: string; attackerId: string; amount: number; damageType?: DamageType; critical: boolean; health: number; maxHealth: number };
        this.updateHealth(d.creatureId, d.health, d.maxHealth);
        this.combatText.spawnDamage({ targetId: d.creatureId, amount: d.amount, damageType: d.damageType, critical: d.critical });
        break;
      }
      case SERVER_EVENTS.CREATURE_DEATH: {
        const de = data as { creatureId: string; experience: number };
        if (this.state.target()?.id === de.creatureId) this.state.clearTarget();
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
              if (rendered.healthBorder) rendered.healthBorder.alpha = 0.25;
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
        if (this.entities.has(r.entityId)) {
          void this.setupPlayerOutfit(r.entityId, { outfitId: r.outfitId, addonMask: r.addonMask, colors: r.colors });
        }
        break;
      }
      case SERVER_EVENTS.COMBAT_DAMAGE: {
        const d = data as { attackerId: string; targetId: string; amount: number; damageType?: DamageType; critical: boolean; delayMs?: number; criticalImpact?: ItemImpactVisual; position?: Position };
        this.combatText.spawnDamage(d);
        if (d.critical && d.criticalImpact) {
          const base = d.position ? tileBase(d.position, TILE_SIZE) : null;
          const play = () => {
            if (base) this.playImpact(base.x, base.y, d.criticalImpact!);
            else {
              const c = this.entityCenter(d.targetId, { x: 0, y: 0, z: 0 });
              this.playImpact(c.x, c.y, d.criticalImpact!);
            }
          };
          if (d.delayMs) this.time.delayedCall(d.delayMs, play);
          else play();
        }
        break;
      }
      case SERVER_EVENTS.COMBAT_HEAL: {
        const h = data as { sourceId: string; targetId: string; amount: number; critical: boolean; delayMs?: number };
        this.combatText.spawnHealing(h);
        break;
      }
      case SERVER_EVENTS.COMBAT_PROJECTILE: {
        const d = data as { attackerId: string; targetId: string; from: Position; to: Position; projectile?: ItemProjectileVisual; impact?: ItemImpactVisual; travelTimeMs: number };
        this.playProjectile(d.attackerId, d.targetId, d.from, d.to, d.projectile, d.impact, d.travelTimeMs);
        break;
      }
      case SERVER_EVENTS.COMBAT_AREA: {
        const d = data as { attackerId: string; targetId: string; from: Position; center: Position; tiles: Position[]; projectile?: ItemProjectileVisual; impact?: ItemImpactVisual; travelTimeMs: number };
        this.playArea(d.attackerId, d.targetId, d.from, d.center, d.tiles, d.projectile, d.impact, d.travelTimeMs);
        break;
      }
      case SERVER_EVENTS.COMBAT_DEATH: {
        const de = data as { entityId: string; experience?: number };
        if (this.state.target()?.id === de.entityId) this.state.clearTarget();
        if (de.experience) this.state.addSystemMessage(`+${de.experience} XP`);
        break;
      }
      case SERVER_EVENTS.XP_GAINED: {
        const xp = data as { amount: number; characterId?: string };
        this.combatText.spawnXp({ targetId: xp.characterId ?? this.selfId, amount: xp.amount });
        break;
      }
      case SERVER_EVENTS.GOLD_GAINED: {
        const g = data as { amount: number; position?: Position };
        this.combatText.spawnGold({ targetId: this.selfId, amount: g.amount, position: g.position ? tileBase(g.position, TILE_SIZE) : undefined });
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

  private resetScene(map: MapTile[], selfId: string, selfName: string, selfPosition: Position, width?: number, height?: number, appearance?: PlayerAppearance, health = 0, maxHealth = 0, render?: MapRenderData) {
    for (const [id, ent] of this.entities) {
      ent.image.destroy();
      ent.label.destroy();
      ent.healthBack?.destroy();
      ent.healthFront?.destroy();
      ent.healthBorder?.destroy();
      void id;
    }
    this.entities.clear();
    this.entityInfo.clear();
    this.creatureAnims.clear();
    this.creatureMoves.clear();
    this.creatureDebug.clear();
    this.playerAnims.clear();
    this.definitionCreatureIds.clear();
    this.selfAnim = null;
    this.combatText.clear();
    for (const img of this.loot.values()) img.destroy();
    this.loot.clear();
    this.selfEntity = null;
    this.selfId = selfId;
    this.mapBounds = { width, height };
    this.state.clearTarget();
    this.buildMap(map, width, height, render);
    this.spawnSelf(selfId, selfName, selfPosition, appearance, health, maxHealth);
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

  private buildMap(map: MapTile[], width?: number, height?: number, render?: MapRenderData) {
    const buildVersion = ++this.mapBuildVersion;
    for (const img of this.tileImages) img.destroy();
    this.tileImages = [];
    this.tileRenderDefs.clear();
    if (render?.layers && width && render.tiles.length > 0 && render.tilesets.length > 0) {
      this.drawBasicMap(map);
      void this.buildTilesetMap(render, width, buildVersion);
      return;
    }
    this.drawBasicMap(map);
  }

  private drawBasicMap(map: MapTile[]) {
    for (const tile of map) {
      const x = tile.x * TILE_SIZE + TILE_SIZE / 2;
      const y = tile.y * TILE_SIZE + TILE_SIZE / 2;
      const img = this.add.image(x, y, `tile_${tile.type}`).setDepth(0).setOrigin(0.5);
      this.tileImages.push(img);
    }
  }

  private async buildTilesetMap(render: MapRenderData, width: number, buildVersion: number) {
    for (const def of render.tiles) this.tileRenderDefs.set(def.tileId, def);
    const tilesetMeta = new Map<number, { columns: number; tileWidth: number; tileHeight: number }>();
    await this.loadTilesetSheets(
      render.tilesets.map((t) => {
        tilesetMeta.set(t.tilesetId, { columns: t.columns, tileWidth: t.tileWidth, tileHeight: t.tileHeight });
        return { key: `tileset_${t.tilesetId}`, url: `${WS_URL}${t.imageUrl}`, frameWidth: t.tileWidth, frameHeight: t.tileHeight };
      }),
    );
    if (buildVersion !== this.mapBuildVersion) return;
    if (render.tilesets.some((tileset) => !this.textures.exists(`tileset_${tileset.tilesetId}`))) return;

    const layerDepth: Record<'ground' | 'groundDetail' | 'objects' | 'objectsAbove', (y: number) => number> = {
      ground: () => 0,
      groundDetail: () => 1,
      objects: (y) => y * 0.01 + 10,
      objectsAbove: (y) => y * 0.01 + 100,
    };

    const layers = render.layers;
    for (const layerId of ['ground', 'groundDetail', 'objects', 'objectsAbove'] as const) {
      const arr = layers[layerId];
      if (!Array.isArray(arr)) continue;
      for (let i = 0; i < arr.length; i++) {
        const tileId = arr[i];
        if (tileId == null) continue;
        const def = this.tileRenderDefs.get(tileId);
        if (!def) continue;
        const meta = tilesetMeta.get(def.tilesetId);
        if (!meta) continue;
        const frame = (def.sourceY / meta.tileHeight) * meta.columns + def.sourceX / meta.tileWidth;
        const cy = Math.floor(i / width);
        const x = (i % width) * TILE_SIZE;
        const y = cy * TILE_SIZE;
        const img = this.add
          .image(x, y, `tileset_${def.tilesetId}`, frame)
          .setOrigin(0, 0)
          .setDepth(layerDepth[layerId](cy));
        this.tileImages.push(img);
      }
    }
  }

  private spawnSelf(id: string, name: string, position: Position, appearance?: PlayerAppearance, health = 0, maxHealth = 0) {
    this.selfEntity = this.createRendered('player', name, position);
    this.entities.set(id, this.selfEntity);
    this.entityInfo.set(id, { name, health, maxHealth });
    this.attachHealthBar(this.selfEntity, health, maxHealth);
    this.repositionWorldUi(this.selfEntity);
    this.cameras.main.startFollow(this.selfEntity.image, false, 0.1, 0.1);
    if (appearance) void this.setupPlayerOutfit(id, appearance);
  }

  private async setupPlayerOutfit(id: string, appearance: PlayerAppearance, moveSpeed = this.selfMoveSpeed) {
    const data = await this.outfits.loadConfig(appearance.outfitId);
    if (!data) return;
    const frameW = data.config.spriteWidth;
    const frameH = data.config.spriteHeight;
    const hasExplicitPairs = data.config.animations.some((sequence) => sequence.frames.some((frame) => typeof frame !== 'number' && frame.maskFrameIndex !== undefined));
    const pairedMask = data.supportsColors && data.config.supportsColorization !== false && (data.config.colorMaskMode === 'paired_frames' || hasExplicitPairs);
    const legacyMask = data.supportsColors && data.colorMaskAssetId && data.config.colorMaskMode !== 'paired_frames';
    const recolored = pairedMask || legacyMask;
    const textureKey = recolored
      ? `outfit_${appearance.outfitId}_${appearance.colors.head}_${appearance.colors.primary}_${appearance.colors.secondary}_${appearance.colors.detail}`
      : `outfit_sheet_${appearance.outfitId}`;

    if (!this.textures.exists(textureKey)) {
      try {
        if (recolored) await this.buildRecoloredOutfit(textureKey, data, appearance.colors);
        else await this.loadSheet(textureKey, this.outfits.textureUrl(appearance.outfitId), frameW, frameH);
      } catch (error) {
        console.error('[Appearance] Falha ao montar outfit recolorido', { outfitId: appearance.outfitId, textureKey, error });
        return;
      }
    }

    const rendered = this.entities.get(id);
    if (!rendered || !this.textures.exists(textureKey)) return;
    const animator = new CreatureAnimator(data.config, 'south');
    animator.setWalkCycleMs(moveSpeed);
    animator.play('idle', this.time.now);
    if (id === this.selfId) {
      this.selfAnim = { animator, textureKey, moveSpeed, lastMoveAt: this.time.now };
    } else {
      this.playerAnims.set(id, { animator, textureKey, moveSpeed, lastMoveAt: this.time.now });
    }
    this.applyEntityVisual(rendered, data.config);
    rendered.image.setTexture(textureKey).setTint(0xffffff).setScale(1).setFrame(animator.frameIndex(this.time.now));
    this.applyVisualTransform(rendered);
  }

  private spawnPlayerEntity(id: string, name: string, position: Position, appearance?: PlayerAppearance, health = 0, maxHealth = 0, moveSpeed = MOVE_INTERVAL_MS) {
    const rendered = this.createRendered('player', name, position);
    this.attachHealthBar(rendered, health, maxHealth);
    this.repositionWorldUi(rendered);
    this.entities.set(id, rendered);
    this.entityInfo.set(id, { name, health, maxHealth });
    if (appearance) void this.setupPlayerOutfit(id, appearance, moveSpeed);
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

  private loadTilesetSheets(entries: { key: string; url: string; frameWidth: number; frameHeight: number }[]): Promise<void> {
    const missing = entries.filter((e) => !this.textures.exists(e.key));
    if (missing.length === 0) return Promise.resolve();
    for (const e of missing) this.load.spritesheet(e.key, e.url, { frameWidth: e.frameWidth, frameHeight: e.frameHeight });
    return new Promise((resolve) => {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      this.load.once(Phaser.Loader.Events.FILE_LOAD_ERROR, () => resolve());
      this.load.start();
    });
  }

  private async buildRecoloredOutfit(textureKey: string, data: OutfitAnimData, colors: PlayerAppearance['colors']): Promise<void> {
    const paired = data.config.supportsColorization !== false && (data.config.colorMaskMode === 'paired_frames' || data.config.animations.some((sequence) => sequence.frames.some((frame) => typeof frame !== 'number' && frame.maskFrameIndex !== undefined)));
    const base = await this.loadOutfitImage(this.outfits.textureUrl(data.outfitId));
    const mask = paired ? base : await this.loadOutfitImage(this.outfits.maskUrl(data.outfitId));
    if (!base || !mask) return;
    const frames = data.config.animations.flatMap((sequence) => sequence.frames.map((frame) => typeof frame === 'number' ? { frameIndex: frame } : frame));
    const canvas = paired
      ? recolorSpriteSheet(base, mask, base.width, base.height, data.config.spriteWidth, data.config.spriteHeight, frames, colors, APPEARANCE_PALETTE)
      : recolorCanvas(base, mask, base.width, base.height, colors, APPEARANCE_PALETTE);
    const img = new Image();
    img.src = canvas.toDataURL('image/png');
    await new Promise<void>((resolve) => { img.onload = () => resolve(); });
    this.textures.addSpriteSheet(textureKey, img, { frameWidth: data.config.spriteWidth, frameHeight: data.config.spriteHeight });
  }

  private loadOutfitImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Não foi possível carregar ${url}`));
      image.src = url;
    });
  }

  private addEntity(id: string, kind: string, name: string, position: Position, health?: number, maxHealth?: number) {
    const rendered = this.createRendered(kind, name, position);
    if (health !== undefined && maxHealth !== undefined) {
      this.attachHealthBar(rendered, health, maxHealth);
    }
    this.repositionWorldUi(rendered);
    this.entities.set(id, rendered);
    this.entityInfo.set(id, { name, health: health ?? 0, maxHealth: maxHealth ?? 0 });
  }

  private createRendered(kind: string, name: string, position: Position, isBoss = false): RenderedEntity {
    const base = tileBase(position, TILE_SIZE);
    const anchor = resolveAnchor(TILE_SIZE, TILE_SIZE);
    const color = kind === 'monster' ? 0xe04d4d : kind === 'npc' ? 0xf0c14b : 0x4d86ff;
    const image = this.add.image(base.x, base.y, 'circle').setTint(color).setOrigin(0.5, 1).setDisplaySize(TILE_SIZE, TILE_SIZE);
    const label = this.add
      .text(base.x, base.y, name, {
        fontFamily: WORLD_TEXT_FONT,
        fontStyle: String(WORLD_TEXT_THEME.fontWeight),
        fontSize: `${this.nameFontSize(kind, isBoss)}px`,
        color: this.nameColor(kind, isBoss),
        stroke: WORLD_TEXT_THEME.stroke.color,
        strokeThickness: WORLD_TEXT_THEME.stroke.width,
        resolution: this.textResolution(),
        align: 'center',
      })
      .setOrigin(0.5);
    const depth = position.y * 0.01 + 20;
    image.setDepth(depth);
    label.setDepth(depth + 0.01);
    return {
      kind,
      image,
      label,
      healthBarWidth: calculateCreatureHealthBarWidth(TILE_SIZE),
      health: 0,
      maxHealth: 0,
      spriteWidth: TILE_SIZE,
      spriteHeight: TILE_SIZE,
      visualBoundsWidth: TILE_SIZE,
      visualBoundsHeight: TILE_SIZE,
      bodyWidth: TILE_SIZE,
      bodyHeight: TILE_SIZE,
      bodyOffsetX: 0,
      bodyOffsetY: 0,
      hasBody: false,
      anchorX: anchor.x,
      anchorY: anchor.y,
      offsetX: 0,
      offsetY: 0,
      footprintWidth: 1,
      footprintHeight: 1,
      baseX: base.x,
      baseY: base.y,
      sockets: resolveSockets(TILE_SIZE, TILE_SIZE),
    };
  }

  private nameFontSize(kind: string, isBoss: boolean): number {
    if (isBoss) return WORLD_TEXT_THEME.sizes.bossName;
    return kind === 'monster' ? WORLD_TEXT_THEME.sizes.monsterName : WORLD_TEXT_THEME.sizes.entityName;
  }

  private nameColor(kind: string, isBoss: boolean): string {
    if (isBoss) return WORLD_TEXT_COLORS.bossName;
    if (kind === 'monster') return WORLD_TEXT_COLORS.monsterName;
    if (kind === 'npc') return WORLD_TEXT_COLORS.npcName;
    return WORLD_TEXT_COLORS.playerName;
  }

  private attachHealthBar(rendered: RenderedEntity, health: number, maxHealth: number) {
    rendered.health = health;
    rendered.maxHealth = maxHealth;
    const depth = rendered.image.depth;
    const bounds = bodyBoundsOf(rendered);
    const w = rendered.healthBarWidth;
    const x = bounds.centerX - w / 2;
    const y = bounds.top - this.barTopMargin(rendered);
    const back = this.add.image(x, y, this.barTexture('barBack', w)).setOrigin(0, 0.5).setDepth(depth + 0.02);
    const front = this.add.image(x, y, this.barTexture('barFront', w)).setOrigin(0, 0.5).setDepth(depth + 0.03);
    const border = this.add.image(x, y, this.barTexture('barBorder', w)).setOrigin(0, 0.5).setDepth(depth + 0.04);
    rendered.healthBack = back;
    rendered.healthFront = front;
    rendered.healthBorder = border;
    this.setBar(rendered.healthFront, health, maxHealth, w);
  }

  /** Margem entre o topo do corpo e a barra de HP (body vs sprite). */
  private barTopMargin(rendered: RenderedEntity): number {
    return rendered.hasBody ? CREATURE_HUD_CONFIG.bodyTopMargin : CREATURE_HUD_CONFIG.healthBarMargin;
  }

  /** Reposiciona nome/barra de vida acima do corpo real usando o body bounds. */
  private repositionWorldUi(rendered: RenderedEntity) {
    const bounds = bodyBoundsOf(rendered);
    const x = bounds.centerX;
    if (rendered.healthBack && rendered.healthFront && rendered.healthBorder) {
      const w = rendered.healthBarWidth;
      const barY = bounds.top - this.barTopMargin(rendered);
      const nameY = barY - CREATURE_HUD_CONFIG.healthBarHeight - CREATURE_HUD_CONFIG.nameMargin;
      rendered.label.setPosition(x, nameY);
      rendered.healthBack.setPosition(x - w / 2, barY);
      rendered.healthFront.setPosition(x - w / 2, barY);
      rendered.healthBorder.setPosition(x - w / 2, barY);
    } else {
      rendered.label.setPosition(x, bounds.top - CREATURE_HUD_CONFIG.nameMargin);
    }
  }

  /** Aplica dimensões/anchor/offset/sockets/bounds de um AnimConfig a uma entidade. */
  private applyEntityVisual(rendered: RenderedEntity, config: AnimConfig) {
    const anchor = resolveAnchor(config.spriteWidth, config.spriteHeight, config.anchor);
    rendered.spriteWidth = config.spriteWidth;
    rendered.spriteHeight = config.spriteHeight;
    rendered.visualBoundsWidth = config.visualBounds?.width ?? config.spriteWidth;
    rendered.visualBoundsHeight = config.visualBounds?.height ?? config.spriteHeight;
    rendered.bodyWidth = config.bodyWidth ?? rendered.visualBoundsWidth;
    rendered.bodyHeight = config.bodyHeight ?? rendered.visualBoundsHeight;
    rendered.bodyOffsetX = config.bodyOffsetX ?? 0;
    rendered.bodyOffsetY = config.bodyOffsetY ?? 0;
    rendered.hasBody = config.bodyHeight !== undefined;
    rendered.healthBarWidth = calculateCreatureHealthBarWidth(rendered.bodyWidth);
    rendered.anchorX = anchor.x;
    rendered.anchorY = anchor.y;
    rendered.offsetX = config.offsetX ?? 0;
    rendered.offsetY = config.offsetY ?? 0;
    rendered.sockets = resolveSockets(config.spriteWidth, config.spriteHeight, config.sockets);
    this.refitHealthBar(rendered);
    this.applyVisualTransform(rendered);
  }

  /** Atualiza a textura/preenchimento da barra quando a largura muda. */
  private refitHealthBar(rendered: RenderedEntity) {
    if (!rendered.healthBack || !rendered.healthFront || !rendered.healthBorder) return;
    const w = rendered.healthBarWidth;
    rendered.healthBack.setTexture(this.barTexture('barBack', w));
    rendered.healthFront.setTexture(this.barTexture('barFront', w));
    rendered.healthBorder.setTexture(this.barTexture('barBorder', w));
    this.setBar(rendered.healthFront, rendered.health, rendered.maxHealth, w);
  }

  /** Desenha o sprite relativamente à base (anchor + offset) e reposiciona a UI. */
  private applyVisualTransform(rendered: RenderedEntity) {
    const origin = anchorOrigin({ x: rendered.anchorX, y: rendered.anchorY }, rendered.spriteWidth, rendered.spriteHeight);
    rendered.image.setOrigin(origin.x, origin.y).setPosition(rendered.baseX + rendered.offsetX, rendered.baseY + rendered.offsetY);
    this.repositionWorldUi(rendered);
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
    footprintWidth = 1,
    footprintHeight = 1,
    isBoss = false,
  ) {
    const rendered = this.createRendered('monster', name, position, isBoss);
    rendered.footprintWidth = footprintWidth;
    rendered.footprintHeight = footprintHeight;
    rendered.moveSpeed = moveSpeed;
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
    animator.setWalkCycleMs(moveSpeed);
    animator.play(animForState(state), this.time.now);
    this.creatureAnims.set(id, { animator, textureKey, moveSpeed, lastMoveAt: this.time.now });
    this.applyEntityVisual(rendered, config);
    rendered.image.setTexture(textureKey).setTint(0xffffff).setScale(1).setFrame(animator.frameIndex(this.time.now));
    this.applyVisualTransform(rendered);
  }

  private updateCreatureAnim(id: string, facing: Direction, state: CreatureState) {
    const anim = this.creatureAnims.get(id);
    if (anim) {
      anim.animator.setDirection(toAnimDirection(facing));
      const nextType = animForState(state);
      if (anim.animator.currentType !== nextType) anim.animator.play(nextType, this.time.now);
      if (nextType === 'walk') anim.lastMoveAt = this.time.now;
    }
  }

  private updatePlayerAnimDirection(id: string, facing: Direction) {
    const anim = this.playerAnims.get(id);
    if (!anim) return;
    anim.animator.setDirection(toAnimDirection(facing));
    if (anim.animator.currentType !== 'walk') anim.animator.play('walk', this.time.now);
    anim.lastMoveAt = this.time.now;
  }

  private playCreatureAnim(id: string, type: AnimType) {
    const anim = this.creatureAnims.get(id);
    if (anim) anim.animator.playOnce(type, this.time.now);
  }

  override update(time: number) {
    this.combatText.update(time);
    for (const [id, anim] of this.creatureAnims) {
      const rendered = this.entities.get(id);
      if (!rendered) continue;
      const move = this.creatureMoves.get(id);
      if (move) {
        const t = Math.min(1, Math.max(0, (time - move.startedAt) / Math.max(1, move.durationMs)));
        rendered.baseX = Phaser.Math.Linear(move.fromX, move.toX, t);
        rendered.baseY = Phaser.Math.Linear(move.fromY, move.toY, t);
        this.applyVisualTransform(rendered);
        if (t >= 1) this.creatureMoves.delete(id);
      }
      rendered.image.setFrame(anim.animator.frameIndex(time));
      if (!this.creatureMoves.has(id) && anim.animator.currentType === 'walk' && time - anim.lastMoveAt > anim.moveSpeed + 80) {
        anim.animator.play('idle', time);
      }
    }
    for (const [id, anim] of this.playerAnims) {
      const rendered = this.entities.get(id);
      if (!rendered) continue;
      rendered.image.setFrame(anim.animator.frameIndex(time));
      if (anim.animator.currentType === 'walk' && time - anim.lastMoveAt > anim.moveSpeed + 80) {
        anim.animator.play('idle', time);
      }
    }
    if (this.selfAnim && this.selfEntity) {
      this.selfEntity.image.setFrame(this.selfAnim.animator.frameIndex(time));
      const isMoving = this.tweens.getTweensOf(this.selfEntity).length > 0;
      if (!isMoving && this.selfAnim.animator.currentType === 'walk' && time - this.selfAnim.lastMoveAt > this.selfAnim.moveSpeed + 80) {
        this.selfAnim.animator.play('idle', time);
      }
    }
    if (this.entityDebugVisible) this.drawEntityDebug();
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
    if (!rendered) return;
    const anim = this.playerAnims.get(id);
    this.moveRendered(rendered, position, anim?.moveSpeed ?? rendered.moveSpeed ?? MOVE_INTERVAL_MS);
  }

  private moveCreature(id: string, position: Position, facing: Direction, state: CreatureState) {
    const anim = this.creatureAnims.get(id);
    const rendered = this.entities.get(id);
    if (rendered) this.moveCreatureRendered(id, rendered, position, anim?.moveSpeed ?? rendered.moveSpeed ?? MOVE_INTERVAL_MS);
    this.updateCreatureAnim(id, facing, state);
  }

  private moveCreatureRendered(id: string, rendered: RenderedEntity, position: Position, duration: number) {
    const to = tileBase(position, TILE_SIZE);
    const depth = position.y * 0.01 + 20;
    rendered.image.setDepth(depth);
    rendered.label.setDepth(depth + 0.01);
    if (rendered.healthBack) {
      rendered.healthBack.setDepth(depth + 0.02);
      rendered.healthFront?.setDepth(depth + 0.03);
      rendered.healthBorder?.setDepth(depth + 0.04);
    }
    const dx = Math.abs(rendered.baseX - to.x);
    const dy = Math.abs(rendered.baseY - to.y);
    if (dx > TILE_SIZE * 2 || dy > TILE_SIZE * 2) {
      rendered.baseX = to.x;
      rendered.baseY = to.y;
      this.creatureMoves.delete(id);
      this.applyVisualTransform(rendered);
      return;
    }
    this.creatureMoves.set(id, {
      fromX: rendered.baseX,
      fromY: rendered.baseY,
      toX: to.x,
      toY: to.y,
      startedAt: this.time.now,
      durationMs: Math.max(80, duration),
    });
  }

  private movePlayerRendered(position: Position, duration: number) {
    if (!this.selfEntity) return;
    const activeTween = this.tweens.getTweensOf(this.selfEntity)[0];
    if (activeTween) activeTween.stop();
    this.moveRenderedImmediateTween(this.selfEntity, position, duration);
  }

  private moveRenderedImmediateTween(rendered: RenderedEntity, position: Position, duration: number) {
    const to = tileBase(position, TILE_SIZE);
    this.tweens.add({ targets: rendered, baseX: to.x, baseY: to.y, duration, ease: 'Linear', onUpdate: () => this.applyVisualTransform(rendered) });
  }

  private moveRendered(rendered: RenderedEntity, position: Position, duration = MOVE_INTERVAL_MS) {
    const to = tileBase(position, TILE_SIZE);
    const depth = position.y * 0.01 + 20;
    rendered.image.setDepth(depth);
    rendered.label.setDepth(depth + 0.01);
    if (rendered.healthBack) {
      rendered.healthBack.setDepth(depth + 0.02);
      rendered.healthFront?.setDepth(depth + 0.03);
      rendered.healthBorder?.setDepth(depth + 0.04);
    }
    this.tweens.killTweensOf(rendered);
    this.tweens.add({ targets: rendered, baseX: to.x, baseY: to.y, duration, ease: 'Linear', onUpdate: () => this.applyVisualTransform(rendered) });
  }

  private removeEntity(id: string) {
    const rendered = this.entities.get(id);
    if (rendered) {
      rendered.image.destroy();
      rendered.label.destroy();
      rendered.healthBack?.destroy();
      rendered.healthFront?.destroy();
      rendered.healthBorder?.destroy();
      this.entities.delete(id);
      this.entityInfo.delete(id);
      this.creatureAnims.delete(id);
      this.creatureMoves.delete(id);
      this.creatureDebug.delete(id);
      this.playerAnims.delete(id);
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
    if (rendered) {
      rendered.health = health;
      rendered.maxHealth = maxHealth;
    }
    if (rendered && rendered.healthFront) {
      this.setBar(rendered.healthFront, health, maxHealth, rendered.healthBarWidth);
    }
  }

  private setBar(front: Phaser.GameObjects.Image, health: number, maxHealth: number, width: number) {
    const ratio = Math.max(0, Math.min(1, health / Math.max(1, maxHealth)));
    front.setDisplaySize(Math.max(1, ratio * width), BAR_HEIGHT);
    front.setTint(healthColor(ratio));
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
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        if (this.state.inInstance()) this.applyCameraBounds();
      }
    });
  }

  private updateSelfAnim(dir: Direction | null) {
    if (!this.selfAnim) return;
    if (dir) {
      this.selfAnim.animator.setDirection(toAnimDirection(dir));
      this.selfAnim.animator.play('walk', this.time.now);
      this.selfAnim.lastMoveAt = this.time.now;
    } else {
      if (!this.selfEntity || this.tweens.getTweensOf(this.selfEntity).length === 0) {
        this.selfAnim.animator.play('idle', this.time.now);
      }
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
    this.debugGraphics = this.add.graphics().setDepth(500).setVisible(this.entityDebugVisible);
    this.input.keyboard!.on('keydown', (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        this.debugVisible = !this.debugVisible;
        this.debugOverlay.setVisible(this.debugVisible);
        this.updateDebugOverlay();
      }
      if (event.key === 'F4') {
        this.entityDebugVisible = !this.entityDebugVisible;
        this.debugGraphics.setVisible(this.entityDebugVisible);
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

  /**
   * Debug: tile (amarelo), footprint (verde), render bounds (vermelho),
   * visual bounds estável (roxo), corpo real (laranja), anchor (azul) e
   * âncoras do HUD (nome/HP) a partir do topo do corpo.
   */
  private drawEntityDebug() {
    const g = this.debugGraphics;
    g.clear();
    for (const [, ent] of this.entities) {
      const tileX = Math.floor(ent.baseX / TILE_SIZE) * TILE_SIZE;
      const tileY = Math.floor(ent.baseY / TILE_SIZE) * TILE_SIZE;
      const topLeftX = ent.baseX + ent.offsetX - ent.anchorX;
      const topLeftY = ent.baseY + ent.offsetY - ent.anchorY;
      const body = bodyBoundsOf(ent);
      g.lineStyle(1, 0xffff00, 0.7).strokeRect(tileX, tileY, TILE_SIZE, TILE_SIZE);
      g.lineStyle(1, 0x00ff00, 0.9).strokeRect(tileX, tileY, TILE_SIZE * ent.footprintWidth, TILE_SIZE * ent.footprintHeight);
      g.lineStyle(1, 0xff0000, 0.9).strokeRect(topLeftX, topLeftY, ent.spriteWidth, ent.spriteHeight);
      if (ent.visualBoundsWidth !== ent.spriteWidth || ent.visualBoundsHeight !== ent.spriteHeight) {
        g.lineStyle(1, 0xaa00ff, 0.9).strokeRect(ent.baseX + ent.offsetX - ent.visualBoundsWidth / 2, ent.baseY + ent.offsetY - ent.visualBoundsHeight, ent.visualBoundsWidth, ent.visualBoundsHeight);
      }
      if (ent.bodyWidth !== ent.spriteWidth || ent.bodyHeight !== ent.spriteHeight || ent.bodyOffsetX !== 0 || ent.bodyOffsetY !== 0) {
        g.lineStyle(1, 0xff8c00, 0.9).strokeRect(body.left, body.top, body.width, body.height);
      }
      g.lineStyle(1, 0x0000ff, 0.9);
      g.strokeLineShape(new Phaser.Geom.Line(ent.baseX + ent.offsetX - 4, ent.baseY + ent.offsetY, ent.baseX + ent.offsetX + 4, ent.baseY + ent.offsetY));
      g.strokeLineShape(new Phaser.Geom.Line(ent.baseX + ent.offsetX, ent.baseY + ent.offsetY - 4, ent.baseX + ent.offsetX, ent.baseY + ent.offsetY + 4));
      g.lineStyle(1, 0x00ffff, 0.7);
      const barY = body.top - this.barTopMargin(ent);
      const nameY = barY - CREATURE_HUD_CONFIG.healthBarHeight - CREATURE_HUD_CONFIG.nameMargin;
      g.strokeLineShape(new Phaser.Geom.Line(body.left, barY, body.right, barY));
      g.strokeLineShape(new Phaser.Geom.Line(body.left, nameY, body.right, nameY));
    }
    for (const [id, info] of this.creatureDebug) {
      const ent = this.entities.get(id);
      if (!ent) continue;
      const path = info.path ?? [];
      for (let i = 0; i < path.length; i++) {
        const p = tileBase(path[i], TILE_SIZE);
        if (i === 0) {
          g.lineStyle(1, 0xffff00, 0.95).strokeRect(p.x - TILE_SIZE / 2, p.y - TILE_SIZE, TILE_SIZE, TILE_SIZE);
        } else {
          g.lineStyle(1, 0x00aaff, 0.8).strokeRect(p.x - TILE_SIZE / 2, p.y - TILE_SIZE, TILE_SIZE, TILE_SIZE);
        }
      }
      if (info.blocked) {
        g.lineStyle(2, 0xff0000, 0.95).strokeRect(ent.baseX - TILE_SIZE / 2, ent.baseY - TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
      if (info.targetPosition) {
        const tp = tileBase(info.targetPosition, TILE_SIZE);
        g.lineStyle(1, 0x00ffff, 0.85);
        g.strokeLineShape(new Phaser.Geom.Line(ent.baseX, ent.baseY, tp.x, tp.y));
      }
    }
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
    this.panning = false;
    this.panStart = { x: pointer.x, y: pointer.y };
    this.lastPan = { x: pointer.x, y: pointer.y };
    if (!this.state.inInstance()) {
      this.handlePointerClick(pointer);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (!pointer.isDown || !this.state.inInstance()) return;
    const cam = this.cameras.main;
    if (!this.panning) {
      const dx = pointer.x - this.panStart.x;
      const dy = pointer.y - this.panStart.y;
      if (Math.abs(dx) + Math.abs(dy) < WorldScene.PAN_THRESHOLD) return;
      this.panning = true;
      cam.stopFollow();
      this.lastPan = { x: pointer.x, y: pointer.y };
      return;
    }
    const dx = pointer.x - this.lastPan.x;
    const dy = pointer.y - this.lastPan.y;
    this.lastPan = { x: pointer.x, y: pointer.y };
    if (dx === 0 && dy === 0) return;
    cam.scrollX = cam.clampX(cam.scrollX - dx / cam.zoom);
    cam.scrollY = cam.clampY(cam.scrollY - dy / cam.zoom);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer) {
    if (this.state.inInstance() && !this.panning) {
      this.handlePointerClick(pointer);
    }
    this.panning = false;
  }

  private handlePointerClick(pointer: Phaser.Input.Pointer) {
    const tx = Math.round(pointer.worldX / TILE_SIZE);
    const ty = Math.round(pointer.worldY / TILE_SIZE);

    for (const [id, ent] of this.entities) {
      if (id === this.selfId) continue;
      const ex = Math.round(ent.baseX / TILE_SIZE);
      const ey = Math.round(ent.baseY / TILE_SIZE);
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


  private playProjectile(attackerId: string, targetId: string, from: Position, to: Position, projectile: ItemProjectileVisual | undefined, impact: ItemImpactVisual | undefined, travelTimeMs: number) {
    if (!this.sys.isActive()) return;
    const end = this.entityCenter(targetId, to);
    const impactBase = tileBase(to, TILE_SIZE);
    if (!projectile?.sprite && !projectile?.spriteAssetId) {
      if (impact?.sprite || impact?.spriteAssetId) this.playImpact(impactBase.x, impactBase.y, impact);
      return;
    }
    const textureKey = this.effectTextureKey('projectile', projectile.sprite || String(projectile.spriteAssetId ?? ''), projectile.frameWidth, projectile.frameHeight);
    const start = this.entitySocket(attackerId, from, 'projectileOrigin');
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
          if (impact?.sprite || impact?.spriteAssetId) this.playImpact(impactBase.x, impactBase.y, impact);
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

  private playArea(attackerId: string, targetId: string, from: Position, center: Position, tiles: Position[], projectile: ItemProjectileVisual | undefined, impact: ItemImpactVisual | undefined, travelTimeMs: number) {
    const end = tileBase(center, TILE_SIZE);
    const playImpactOnAllTiles = () => {
      if (!impact?.sprite && !impact?.spriteAssetId) return;
      for (const tile of tiles) {
        const p = tileBase(tile, TILE_SIZE);
        this.playImpact(p.x, p.y, impact);
      }
    };
    if (!projectile?.sprite && !projectile?.spriteAssetId) {
      playImpactOnAllTiles();
      return;
    }
    const textureKey = this.effectTextureKey('projectile', projectile.sprite || String(projectile.spriteAssetId ?? ''), projectile.frameWidth, projectile.frameHeight);
    const start = this.entitySocket(attackerId, from, 'projectileOrigin');
    const frame = projectile.frames[this.projectileDirection(from, center)] ?? 0;
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
          playImpactOnAllTiles();
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
    if (!this.sys.isActive()) return;
    const textureKey = this.effectTextureKey('impact', impact.sprite || String(impact.spriteAssetId ?? ''), impact.frameWidth, impact.frameHeight);
    const run = () => {
      if (!this.textures.exists(textureKey)) return;
      const key = `${textureKey}:anim:${impact.frames.join('-')}:${impact.fps ?? 12}`;
      if (!this.anims.exists(key)) {
        this.anims.create({ key, frames: impact.frames.map((frame) => ({ key: textureKey, frame })), frameRate: impact.fps ?? 12, repeat: 0 });
      }
      const growsFromRight = impact.frameWidth === 64 && impact.frameHeight === 64;
      const sprite = this.add
        .sprite(growsFromRight ? x + TILE_SIZE / 2 : x, y, textureKey, impact.frames[0] ?? 0)
        .setDepth(95)
        .setOrigin(growsFromRight ? 1 : 0.5, 1);
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

  private entitySocket(entityId: string, fallback: Position, socket: keyof ResolvedSockets): { x: number; y: number } {
    const ent = this.entities.get(entityId) ?? (entityId === this.selfId ? this.selfEntity : null);
    if (ent) {
      const p = ent.sockets[socket];
      return {
        x: ent.baseX + ent.offsetX - ent.anchorX + p.x,
        y: ent.baseY + ent.offsetY - ent.anchorY + p.y,
      };
    }
    return tileBase(fallback, TILE_SIZE);
  }

  private entityCenter(entityId: string, fallback: Position): { x: number; y: number } {
    return this.entitySocket(entityId, fallback, 'center');
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

  /**
   * Retorna a textura da barra de vida para uma largura (cacheada por tipo+largura).
   * A barra de vida escala proporcionalmente ao sprite, então a textura é
   * gerada sob demanda em vez de fixa.
   */
  private barTexture(kind: 'barBack' | 'barFront' | 'barBorder', width: number): string {
    const w = Math.max(1, Math.round(width));
    const key = `${kind}_${w}`;
    if (this.textures.exists(key)) return key;
    const tex = this.textures.createCanvas(key, w, BAR_HEIGHT);
    if (tex) {
      const ctx = tex.getContext();
      if (kind === 'barBack') {
        ctx.fillStyle = '#20242a';
        ctx.fillRect(0, 0, w, BAR_HEIGHT);
      } else if (kind === 'barFront') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, BAR_HEIGHT);
      } else {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, w - 1, BAR_HEIGHT - 1);
      }
      tex.refresh();
    }
    return key;
  }
}

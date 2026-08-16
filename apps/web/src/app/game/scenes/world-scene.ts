import Phaser from 'phaser';
import { SERVER_EVENTS } from '@aetheria/protocol';
import { TILE } from '@aetheria/config';
import type { Direction, MapTile, Position } from '@aetheria/types';
import { WsService } from '../../core/ws.service';
import { GameState } from '../game-state';
import type { CreatureCatalogService } from '../creature-catalog.service';

const TILE_SIZE = 48;
const MOVE_DURATION_MS = 235;

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
}

export class WorldScene extends Phaser.Scene {
  private ws!: WsService;
  private state!: GameState;
  private catalog!: CreatureCatalogService;
  private tileImages: Phaser.GameObjects.Image[] = [];
  private entities = new Map<string, RenderedEntity>();
  private entityInfo = new Map<string, EntityInfo>();
  private loot = new Map<string, Phaser.GameObjects.Image>();
  private selfId = '';
  private selfEntity: RenderedEntity | null = null;
  private lastSeq = -1;
  private moveDir: Direction | null = null;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private creatureSprites = new Map<string, boolean>();
  private spriteLoadInFlight = false;
  private debugVisible = false;
  private debugOverlay!: Phaser.GameObjects.Text;

  constructor() {
    super('World');
  }

  create(data: { ws: WsService; state: GameState; catalog: CreatureCatalogService }) {
    this.ws = data.ws;
    this.state = data.state;
    this.catalog = data.catalog;
    void this.catalog.ensureLoaded();
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
    this.cameras.main.setZoom(1.5);
    this.setupKeyboard();
    this.setupDebug();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onPointerDown(pointer));
  }

  // ------------------------------------------------------------------ events

  private handleEvent(event: string, data: unknown) {
    switch (event) {
      case SERVER_EVENTS.ENTER_WORLD: {
        const w = data as { character: { id: string; name: string; position: Position }; map: MapTile[] };
        this.selfId = w.character.id;
        this.buildMap(w.map);
        this.spawnSelf(w.character.id, w.character.name, w.character.position);
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
          slug: string;
          name: string;
          position: Position;
          health: number;
          maxHealth: number;
        };
        this.addCreature(c.creatureId, c.slug, c.name, c.position, c.health, c.maxHealth);
        break;
      }
      case SERVER_EVENTS.CREATURE_MOVE: {
        const m = data as { creatureId: string; from: Position; to: Position; timestamp: number };
        this.moveEntity(m.creatureId, m.to);
        break;
      }
      case SERVER_EVENTS.CREATURE_ATTACK: {
        const a = data as { creatureId: string; targetId: string; position: Position };
        const rendered = this.entities.get(a.creatureId);
        if (rendered) this.flashEntity(rendered);
        break;
      }
      case SERVER_EVENTS.CREATURE_DAMAGE: {
        const d = data as { creatureId: string; attackerId: string; amount: number; critical: boolean; health: number; maxHealth: number };
        this.updateHealth(d.creatureId, d.health, d.maxHealth);
        const rendered = this.entities.get(d.creatureId);
        const x = rendered?.image.x ?? 0;
        const y = rendered?.image.y ?? 0;
        this.showDamage(x, y, d.amount, d.critical);
        break;
      }
      case SERVER_EVENTS.CREATURE_DEATH: {
        const de = data as { creatureId: string; experience: number };
        if (this.state.target()?.id === de.creatureId) this.state.clearTarget();
        if (de.experience) this.state.addSystemMessage(`+${de.experience} XP`);
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
      case SERVER_EVENTS.COMBAT_DAMAGE: {
        const d = data as { attackerId: string; targetId: string; amount: number; critical: boolean };
        const info = this.entityInfo.get(d.targetId);
        if (info) {
          const ent = this.entities.get(d.targetId);
          const x = ent?.image.x ?? (this.selfEntity && d.targetId === this.selfId ? this.selfEntity.image.x : 0);
          const y = ent?.image.y ?? (this.selfEntity && d.targetId === this.selfId ? this.selfEntity.image.y : 0);
          this.showDamage(x, y, d.amount, d.critical);
        }
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

  private spawnSelf(id: string, name: string, position: Position) {
    this.selfEntity = this.createRendered('player', name, position);
    this.entities.set(id, this.selfEntity);
    this.entityInfo.set(id, { name, health: 0, maxHealth: 0 });
    this.cameras.main.startFollow(this.selfEntity.image, false, 0.1, 0.1);
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
    const image = this.add.image(x, y, 'circle').setTint(color).setOrigin(0.5);
    const label = this.add
      .text(x, y - 28, name, {
        fontFamily: 'Arial',
        fontSize: '11px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    const depth = position.y * 0.01 + 1;
    image.setDepth(depth);
    label.setDepth(depth + 0.01);
    return { kind, image, label };
  }

  private attachHealthBar(rendered: RenderedEntity, health: number, maxHealth: number) {
    const depth = rendered.image.depth;
    const back = this.add.image(rendered.image.x, rendered.image.y - 20, 'barBack').setOrigin(0.5).setDepth(depth + 0.02);
    const front = this.add.image(rendered.image.x, rendered.image.y - 20, 'barFront').setOrigin(0.5).setDepth(depth + 0.03);
    rendered.healthBack = back;
    rendered.healthFront = front;
    this.setBar(front, health, maxHealth);
  }

  private addCreature(id: string, slug: string, name: string, position: Position, health: number, maxHealth: number) {
    const rendered = this.createRendered('monster', name, position);
    this.attachHealthBar(rendered, health, maxHealth);
    this.entities.set(id, rendered);
    this.entityInfo.set(id, { name, health, maxHealth });
    const sprite = this.catalog.spriteFor(slug);
    if (sprite) this.loadCreatureSprite(id, slug, sprite, rendered);
    this.updateDebugOverlay();
  }

  private loadCreatureSprite(id: string, slug: string, sprite: string, rendered: RenderedEntity) {
    const textureKey = `creature_${slug}`;
    if (this.textures.exists(textureKey)) {
      this.applyCreatureSprite(rendered, textureKey);
      return;
    }
    if (this.creatureSprites.has(textureKey)) return;
    this.creatureSprites.set(textureKey, true);
    this.load.image(textureKey, `assets/${sprite}`);
    const onComplete = () => {
      this.spriteLoadInFlight = false;
      if (this.textures.exists(textureKey)) {
        this.applyCreatureSprite(this.entities.get(id), textureKey);
      }
      this.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
      this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    };
    const onError = () => {
      this.spriteLoadInFlight = false;
      this.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
      this.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    };
    this.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onError);
    if (!this.spriteLoadInFlight) {
      this.spriteLoadInFlight = true;
      this.load.start();
    }
  }

  private applyCreatureSprite(rendered: RenderedEntity | undefined, textureKey: string) {
    if (!rendered) return;
    const size = TILE_SIZE * 0.9;
    rendered.image.setTexture(textureKey).setTint(0xffffff).setDisplaySize(size, size);
    this.updateDebugOverlay();
  }

  private flashEntity(rendered: RenderedEntity) {
    this.tweens.add({
      targets: rendered.image,
      scale: 1.25,
      duration: 90,
      yoyo: true,
      ease: 'Linear',
    });
  }

  private moveEntity(id: string, position: Position) {
    const rendered = this.entities.get(id);
    if (rendered) this.moveRendered(rendered, position);
  }

  private moveRendered(rendered: RenderedEntity, position: Position) {
    const x = position.x * TILE_SIZE + TILE_SIZE / 2;
    const y = position.y * TILE_SIZE + TILE_SIZE / 2;
    const depth = position.y * 0.01 + 1;
    rendered.image.setDepth(depth);
    rendered.label.setDepth(depth + 0.01);
    if (rendered.healthBack) {
      rendered.healthBack.setDepth(depth + 0.02);
      rendered.healthFront?.setDepth(depth + 0.03);
    }
    const targets: (Phaser.GameObjects.Image | Phaser.GameObjects.Text)[] = [rendered.image, rendered.label];
    if (rendered.healthBack && rendered.healthFront) {
      targets.push(rendered.healthBack, rendered.healthFront);
    }
    this.tweens.add({ targets, x, y, duration: MOVE_DURATION_MS, ease: 'Linear' });
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
    front.setDisplaySize(Math.max(1, ratio * 28), 5);
  }

  // ------------------------------------------------------------------ input

  private setupKeyboard() {
    this.keys = this.input.keyboard!.addKeys('W,A,S,D') as Record<string, Phaser.Input.Keyboard.Key>;
    const cursors = this.input.keyboard!.createCursorKeys();
    const check = () => {
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
      }
    };
    this.input.keyboard!.on('keydown', check);
    this.input.keyboard!.on('keyup', check);
  }

  private setupDebug() {
    this.debugOverlay = this.add
      .text(10, 10, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#9be0ff',
        backgroundColor: 'rgba(0,0,0,0.55)',
        padding: { x: 6, y: 4 },
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
        `Sprites: ${this.creatureSprites.size}`,
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

  private showDamage(x: number, y: number, amount: number, critical: boolean) {
    const text = this.add
      .text(x, y - 22, String(amount), {
        fontFamily: 'Arial',
        fontSize: critical ? '20px' : '15px',
        color: critical ? '#ffcf3f' : '#ff6b6b',
        stroke: '#1a1a1a',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(100);
    this.tweens.add({
      targets: text,
      y: y - 48,
      alpha: 0,
      duration: 700,
      onComplete: () => text.destroy(),
    });
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

  private makeTile(type: number, base: string, light: string, dark: string) {
    const tex = this.textures.createCanvas(`tile_${type}`, TILE_SIZE, TILE_SIZE);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = Math.random() < 0.5 ? light : dark;
      ctx.fillRect(Math.floor(Math.random() * TILE_SIZE), Math.floor(Math.random() * TILE_SIZE), 2, 2);
    }
    if (type === TILE.TREE) {
      ctx.fillStyle = '#2f6b2f';
      ctx.beginPath();
      ctx.arc(TILE_SIZE / 2, TILE_SIZE / 2, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3f8a3f';
      ctx.beginPath();
      ctx.arc(TILE_SIZE / 2 - 5, TILE_SIZE / 2 - 5, 8, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === TILE.ROCK) {
      ctx.fillStyle = '#6f7278';
      ctx.beginPath();
      ctx.arc(TILE_SIZE / 2, TILE_SIZE / 2, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8a8d92';
      ctx.beginPath();
      ctx.arc(TILE_SIZE / 2 - 3, TILE_SIZE / 2 - 3, 8, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === TILE.WATER) {
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(6, 20);
      ctx.quadraticCurveTo(12, 16, 18, 20);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(24, 32);
      ctx.quadraticCurveTo(30, 28, 36, 32);
      ctx.stroke();
    } else if (type === TILE.WALL) {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, TILE_SIZE - 8, TILE_SIZE - 8);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(4, 4, TILE_SIZE - 8, 4);
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
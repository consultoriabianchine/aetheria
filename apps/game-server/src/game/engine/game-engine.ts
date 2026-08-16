import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  BASE_PLAYER,
  CHAT_CHANNELS,
  CHAT_MAX_LENGTH,
  CHAT_MIN_INTERVAL_MS,
  INVENTORY_SIZE,
  LOOT_LIFETIME_MS,
  MONSTER_RESPAWN_MS,
  MONSTER_SPAWNS,
  MONSTER_TEMPLATES,
  MOVE_INTERVAL_MS,
  NPC_INTERACT_RANGE,
  NPC_TEMPLATES,
  PICKUP_RANGE,
  SPAWN_POINT,
  TICK_MS,
  VIEW_DISTANCE_X,
  VIEW_DISTANCE_Y,
  xpForLevel,
} from '@aetheria/config';
import { DIRECTION_DELTAS, samePosition, tileDistance, tileKey, uid } from '@aetheria/shared';
import type {
  CharacterEquipment,
  CharacterInventory,
  CharacterSkills,
  CharacterSummary,
  Direction,
  Position,
} from '@aetheria/types';
import { getItemDef } from './item-catalog';
import { generateWorldMap } from './world-map';
import { GamePlayer, GroundItem, MonsterEntity, NpcEntity } from './world';
import { STORE, Store, StoredCharacter } from '../store/store';

export type EmitFn = (socketId: string, event: string, data: unknown) => void;

const BASE_SKILLS: CharacterSkills = {
  sword: BASE_PLAYER.skill,
  axe: BASE_PLAYER.skill,
  club: BASE_PLAYER.skill,
  distance: BASE_PLAYER.skill,
  magic: BASE_PLAYER.skill,
  defense: BASE_PLAYER.skill,
};

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class GameEngine implements OnModuleDestroy {
  private readonly logger = new Logger(GameEngine.name);

  private emitFn: EmitFn = () => {};
  private world = generateWorldMap();
  private players = new Map<string, GamePlayer>();
  private playerBySocket = new Map<string, string>();
  private monsters = new Map<string, MonsterEntity>();
  private npcs = new Map<string, NpcEntity>();
  private groundItems = new Map<string, GroundItem>();
  private tokens = new Map<string, { accountId: string; username: string; exp: number }>();
  private tickTimer: NodeJS.Timeout | null = null;
  private lastSaveAt = Date.now();

  constructor(@Inject(STORE) private readonly store: Store) {}

  start() {
    for (const npcId of Object.keys(NPC_TEMPLATES)) {
      const t = NPC_TEMPLATES[npcId];
      this.npcs.set(t.id, {
        id: t.id,
        name: t.name,
        position: { x: 32, y: 28, z: this.world.z },
        dialogue: t.dialogue,
      });
    }
    for (const spawn of MONSTER_SPAWNS) {
      this.spawnMonster(spawn.templateId, { x: spawn.x, y: spawn.y, z: spawn.z });
    }
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.logger.log(`Mundo ${this.world.width}x${this.world.height} criado (${this.world.tiles.length} tiles).`);
  }

  onModuleDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    for (const player of this.players.values()) {
      void this.persistPlayer(player).catch(() => undefined);
    }
  }

  setEmitFn(fn: EmitFn) {
    this.emitFn = fn;
  }

  emitTo(socketId: string, event: string, data: unknown) {
    this.emitFn(socketId, event, data);
  }

  private emitAll(event: string, data: unknown) {
    for (const socketId of this.playerBySocket.keys()) this.emitTo(socketId, event, data);
  }

  private emitOthers(socketId: string, event: string, data: unknown) {
    for (const sid of this.playerBySocket.keys()) {
      if (sid === socketId) continue;
      this.emitTo(sid, event, data);
    }
  }

  // ---------------------------------------------------------------- auth

  private signToken(accountId: string, username: string): string {
    const payload = Buffer.from(JSON.stringify({ a: accountId, u: username, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
    const sig = createHmac('sha256', process.env.JWT_SECRET ?? 'aetheria_dev').update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  private verifyToken(token: string): { accountId: string; username: string } | null {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = createHmac('sha256', process.env.JWT_SECRET ?? 'aetheria_dev').update(payload).digest('base64url');
    if (expected !== sig) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
        a: string;
        u: string;
        exp: number;
      };
      if (Date.now() > data.exp) return null;
      return { accountId: data.a, username: data.u };
    } catch {
      return null;
    }
  }

  async handleLogin(socketId: string, username: string, password: string) {
    const uname = username.trim();
    if (!uname || !password) {
      this.emitTo(socketId, 'auth.loginResult', { ok: false, error: 'Informe usuário e senha.' });
      return;
    }
    let account = await this.store.findAccountByUsername(uname);
    if (!account) {
      account = await this.store.createAccount(uname, bcrypt.hashSync(password, 10));
    } else if (!bcrypt.compareSync(password, account.passwordHash)) {
      this.emitTo(socketId, 'auth.loginResult', { ok: false, error: 'Senha incorreta.' });
      return;
    }
    const characters = (await this.store.listCharacters(account.id)).map((c) => this.toSummary(c));
    const token = this.signToken(account.id, account.username);
    this.tokens.set(token, { accountId: account.id, username: account.username, exp: Date.now() + TOKEN_TTL_MS });
    this.emitTo(socketId, 'auth.loginResult', { ok: true, token, accountId: account.id, characters });
  }

  async handleCreateCharacter(socketId: string, token: string, name: string) {
    const session = this.verifyToken(token);
    if (!session) {
      this.emitTo(socketId, 'auth.characterCreated', { ok: false, error: 'Sessão inválida.' });
      return;
    }
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 16 || !/^[A-Za-zÀ-ÿ0-9 ]+$/.test(trimmed)) {
      this.emitTo(socketId, 'auth.characterCreated', {
        ok: false,
        error: 'Nome deve ter entre 3 e 16 caracteres (letras, números e espaços).',
      });
      return;
    }
    const existing = await this.store.listCharacters(session.accountId);
    if (existing.length >= 3) {
      this.emitTo(socketId, 'auth.characterCreated', { ok: false, error: 'Máximo de 3 personagens por conta.' });
      return;
    }
    const all = await Promise.all(existing.map((c) => this.store.findCharacterById(c.id)));
    if (all.some((c) => c && c.name.toLowerCase() === trimmed.toLowerCase())) {
      this.emitTo(socketId, 'auth.characterCreated', { ok: false, error: 'Este nome já está em uso.' });
      return;
    }
    const character = await this.store.createCharacter(session.accountId, {
      name: trimmed,
      level: 1,
      experience: 0,
      health: BASE_PLAYER.health,
      maxHealth: BASE_PLAYER.health,
      mana: BASE_PLAYER.mana,
      maxMana: BASE_PLAYER.mana,
      position: { ...SPAWN_POINT },
      skills: { ...BASE_SKILLS },
      inventory: new Array(INVENTORY_SIZE).fill(null),
      equipment: {},
    });
    this.emitTo(socketId, 'auth.characterCreated', { ok: true, character: this.toSummary(character) });
  }

  async handleSelectCharacter(socketId: string, token: string, characterId: string) {
    const session = this.verifyToken(token);
    if (!session) {
      this.emitTo(socketId, 'auth.selectResult', { ok: false, error: 'Sessão inválida.' });
      return;
    }
    const stored = await this.store.findCharacterById(characterId);
    if (!stored || stored.accountId !== session.accountId) {
      this.emitTo(socketId, 'auth.selectResult', { ok: false, error: 'Personagem não encontrado.' });
      return;
    }
    this.removePlayerFromWorld(socketId);

    const player = new GamePlayer(stored);
    player.socketId = socketId;
    this.players.set(player.id, player);
    this.playerBySocket.set(socketId, player.id);

    this.emitTo(socketId, 'auth.selectResult', { ok: true });
    this.emitTo(socketId, 'game.enterWorld', {
      character: this.toSummary(player),
      map: this.world.tiles,
      width: this.world.width,
      height: this.world.height,
    });
    this.emitStats(player);
    this.emitInventory(player);

    this.emitOthers(socketId, 'entity.spawned', {
      id: player.id,
      kind: 'player',
      name: player.name,
      position: player.position,
      health: player.health,
      maxHealth: player.maxHealth,
      level: player.level,
    });

    for (const monster of this.monsters.values()) {
      if (monster.state === 'DEAD' || !this.inView(player.position, monster.position)) continue;
      this.emitTo(socketId, 'entity.spawned', this.monsterSpawnPayload(monster));
    }
    for (const npc of this.npcs.values()) {
      if (!this.inView(player.position, npc.position)) continue;
      this.emitTo(socketId, 'entity.spawned', { id: npc.id, kind: 'npc', name: npc.name, position: npc.position });
    }
    for (const item of this.groundItems.values()) {
      if (!this.inView(player.position, item.position)) continue;
      this.emitTo(socketId, 'loot.spawned', {
        entityId: item.id,
        itemId: item.itemId,
        name: item.name,
        quantity: item.quantity,
        position: item.position,
      });
    }
    this.logger.log(`Jogador ${player.name} entrou no mundo.`);
  }

  // ---------------------------------------------------------------- actions

  handleDisconnect(socketId: string) {
    this.removePlayerFromWorld(socketId);
  }

  private async removePlayerFromWorld(socketId: string) {
    const characterId = this.playerBySocket.get(socketId);
    if (!characterId) return;
    const player = this.players.get(characterId);
    this.playerBySocket.delete(socketId);
    if (player) {
      this.players.delete(characterId);
      this.emitAll('entity.removed', { id: characterId });
      await this.persistPlayer(player);
      this.logger.log(`Jogador ${player.name} saiu.`);
    }
  }

  handleInput(socketId: string, direction: Direction | null | undefined) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    player.moveDir = direction ?? null;
  }

  handleAttack(socketId: string, targetId: string) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    player.targetId = targetId;
  }

  async handlePickup(socketId: string, entityId: string) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    const item = this.groundItems.get(entityId);
    if (!item) {
      this.emitTo(socketId, 'error', { message: 'Item não encontrado no chão.' });
      return;
    }
    if (tileDistance(player.position, item.position) > PICKUP_RANGE) {
      this.emitTo(socketId, 'error', { message: 'Item fora de alcance.' });
      return;
    }
    if (!this.addToInventory(player, item.itemId, item.quantity)) {
      this.emitTo(socketId, 'error', { message: 'Inventário cheio.' });
      return;
    }
    this.groundItems.delete(entityId);
    this.emitAll('loot.removed', { entityId });
    this.emitInventory(player);
  }

  handleEquip(socketId: string, slotIndex: number) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    const stack = player.inventory[slotIndex];
    if (!stack) return;
    const def = getItemDef(stack.itemId);
    if (!def || !def.slot) return;
    const slot = def.slot;
    if (player.equipment[slot]) {
      this.emitTo(socketId, 'error', { message: `Já existe item equipado em ${slot}.` });
      return;
    }
    player.inventory[slotIndex] = null;
    player.equipment[slot] = { itemId: stack.itemId, quantity: 1 };
    this.emitInventory(player);
    this.emitStats(player);
  }

  handleUnequip(socketId: string, slot: string) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    const stack = player.equipment[slot as keyof CharacterEquipment];
    if (!stack) return;
    const idx = player.inventory.findIndex((s) => s === null);
    if (idx === -1) {
      this.emitTo(socketId, 'error', { message: 'Inventário cheio.' });
      return;
    }
    player.equipment[slot as keyof CharacterEquipment] = undefined;
    player.inventory[idx] = { itemId: stack.itemId, quantity: 1 };
    this.emitInventory(player);
    this.emitStats(player);
  }

  handleChat(socketId: string, channel: string, message: string) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    const text = message.trim();
    if (!text || text.length > CHAT_MAX_LENGTH) return;
    if (!(CHAT_CHANNELS as readonly string[]).includes(channel)) return;
    const now = Date.now();
    if (now - player.lastChatAt < CHAT_MIN_INTERVAL_MS) return;
    player.lastChatAt = now;
    this.emitAll('chat.message', { channel, from: player.name, text });
  }

  handleNpcInteract(socketId: string, npcId: string) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    const npc = this.npcs.get(npcId);
    if (!npc) return;
    if (tileDistance(player.position, npc.position) > NPC_INTERACT_RANGE) {
      this.emitTo(socketId, 'error', { message: 'Você está muito longe do NPC.' });
      return;
    }
    this.emitTo(socketId, 'npc.dialog', { npcId: npc.id, title: npc.dialogue.title, lines: npc.dialogue.lines });
  }

  // ---------------------------------------------------------------- helpers

  private playerForSocket(socketId: string): GamePlayer | null {
    const characterId = this.playerBySocket.get(socketId);
    return characterId ? this.players.get(characterId) ?? null : null;
  }

  private toSummary(c: StoredCharacter | GamePlayer): CharacterSummary {
    const accountId = 'accountId' in c ? c.accountId : (c as StoredCharacter).accountId;
    return {
      id: c.id,
      accountId,
      name: c.name,
      level: c.level,
      experience: c.experience,
      health: c.health,
      maxHealth: c.maxHealth,
      mana: c.mana,
      maxMana: c.maxMana,
      position: { ...c.position },
      skills: { ...c.skills },
    };
  }

  private inView(a: Position, b: Position): boolean {
    return a.z === b.z && Math.abs(a.x - b.x) <= VIEW_DISTANCE_X && Math.abs(a.y - b.y) <= VIEW_DISTANCE_Y;
  }

  private isWalkable(p: Position): boolean {
    const tile = this.world.byKey.get(tileKey(p.x, p.y, p.z));
    return !!tile && tile.walkable;
  }

  private isOccupied(p: Position, exceptId?: string): boolean {
    for (const player of this.players.values()) {
      if (player.id === exceptId) continue;
      if (samePosition(player.position, p)) return true;
    }
    for (const monster of this.monsters.values()) {
      if (monster.state === 'DEAD') continue;
      if (samePosition(monster.position, p)) return true;
    }
    return false;
  }

  private tryStep(entity: GamePlayer | MonsterEntity, direction: Direction, exceptId?: string): boolean {
    const delta = DIRECTION_DELTAS[direction];
    const next: Position = {
      x: entity.position.x + delta.dx,
      y: entity.position.y + delta.dy,
      z: entity.position.z,
    };
    if (!this.isWalkable(next)) return false;
    if (this.isOccupied(next, exceptId)) return false;
    entity.position = next;
    return true;
  }

  private monsterSpawnPayload(monster: MonsterEntity) {
    return {
      id: monster.id,
      kind: 'monster' as const,
      name: monster.template.name,
      position: monster.position,
      health: monster.health,
      maxHealth: monster.maxHealth,
      level: monster.template.level,
    };
  }

  private addToInventory(player: GamePlayer, itemId: string, quantity: number): boolean {
    const def = getItemDef(itemId);
    if (!def) return false;
    if (def.stackable) {
      const existing = player.inventory.find((s) => s && s.itemId === itemId);
      if (existing) {
        existing.quantity += quantity;
        return true;
      }
    }
    const idx = player.inventory.findIndex((s) => s === null);
    if (idx === -1) return false;
    player.inventory[idx] = { itemId, quantity };
    return true;
  }

  private emitStats(player: GamePlayer) {
    this.emitTo(player.socketId ?? '', 'stats.update', {
      health: player.health,
      maxHealth: player.maxHealth,
      mana: player.mana,
      maxMana: player.maxMana,
      level: player.level,
      experience: player.experience,
      skills: player.skills,
    });
  }

  private emitInventory(player: GamePlayer) {
    const inventory: CharacterInventory = {
      slots: player.inventory.map((s) => (s ? { ...s } : null)),
      equipment: { ...player.equipment },
    };
    this.emitTo(player.socketId ?? '', 'inventory.update', { inventory });
  }

  private attackValue(player: GamePlayer): number {
    const weapon = player.equipment.weapon ? getItemDef(player.equipment.weapon.itemId) : undefined;
    return player.attackBase + (weapon?.attack ?? 0);
  }

  private defenseValue(target: GamePlayer | MonsterEntity): number {
    if (target instanceof MonsterEntity) return target.template.defense;
    let def = target.defenseBase;
    for (const slot of ['head', 'armor', 'legs', 'boots', 'shield', 'ring', 'amulet'] as const) {
      const item = target.equipment[slot];
      if (item) def += getItemDef(item.itemId)?.defense ?? 0;
    }
    return def;
  }

  // ---------------------------------------------------------------- combat

  private dealDamage(attacker: { id: string; attackValue: () => number }, target: GamePlayer | MonsterEntity, now: number) {
    const atk = attacker.attackValue();
    const def = this.defenseValue(target);
    const critical = Math.random() < 0.06;
    let amount = Math.max(1, Math.round((atk - def) * (0.9 + Math.random() * 0.2)));
    if (critical) amount = Math.round(amount * 1.5);
    target.health = Math.max(0, target.health - amount);
    this.emitAll('combat.damage', {
      attackerId: attacker.id,
      targetId: target.id,
      amount,
      critical,
      targetHealth: target.health,
    });
    this.emitAll('entity.health', { id: target.id, health: target.health, maxHealth: target.maxHealth });
    void now;
  }

  // ---------------------------------------------------------------- tick

  private tick() {
    try {
      const now = Date.now();
      for (const player of this.players.values()) {
        if (!player.socketId) continue;
        this.processPlayerMove(player, now);
        this.processPlayerAttack(player, now);
      }
      for (const monster of this.monsters.values()) {
        if (monster.state === 'DEAD') continue;
        this.processMonster(monster, now);
      }
      this.processGroundItems(now);
      this.processRespawns(now);
      if (now - this.lastSaveAt > 10_000) {
        this.lastSaveAt = now;
        for (const player of this.players.values()) void this.persistPlayer(player).catch(() => undefined);
      }
    } catch (err) {
      this.logger.error('Erro no tick do jogo', err instanceof Error ? err.stack : String(err));
    }
  }

  private processPlayerMove(player: GamePlayer, now: number) {
    if (!player.moveDir) return;
    if (now < player.nextMoveAt) return;
    if (this.tryStep(player, player.moveDir, player.id)) {
      player.nextMoveAt = now + MOVE_INTERVAL_MS;
      this.emitTo(player.socketId ?? '', 'player.moved', { position: { ...player.position } });
      this.emitOthers(player.socketId ?? '', 'entity.moved', { id: player.id, position: { ...player.position } });
    } else {
      player.nextMoveAt = now + 100;
    }
  }

  private processPlayerAttack(player: GamePlayer, now: number) {
    if (!player.targetId) return;
    const target = this.monsters.get(player.targetId) ?? (this.players.get(player.targetId) as GamePlayer | MonsterEntity | undefined);
    if (!target || target.health <= 0 || target.position.z !== player.position.z) {
      player.targetId = null;
      return;
    }
    if (tileDistance(player.position, target.position) > 1.5) return;
    if (now < player.attackCooldownUntil) return;
    player.attackCooldownUntil = now + 700;
    this.dealDamage({ id: player.id, attackValue: () => this.attackValue(player) }, target, now);
    if (target.health <= 0) {
      if (target instanceof MonsterEntity) this.monsterKilled(player, target, now);
      else this.playerKilled(target as GamePlayer, now);
    }
  }

  private processMonster(monster: MonsterEntity, now: number) {
    const nearest = this.nearestPlayerInRange(monster);
    if (nearest) {
      monster.targetId = nearest.id;
      if (monster.state === 'IDLE' || monster.state === 'WANDER') monster.state = 'CHASE';
    }

    switch (monster.state) {
      case 'IDLE': {
        if (!nearest && now >= monster.nextMoveAt && Math.random() < 0.2) {
          this.monsterWander(monster, now);
        }
        break;
      }
      case 'WANDER': {
        monster.state = 'IDLE';
        break;
      }
      case 'CHASE': {
        if (!nearest) {
          if (tileDistance(monster.position, monster.spawn) > 1) monster.state = 'RETURN';
          else monster.state = 'IDLE';
          break;
        }
        if (tileDistance(monster.position, nearest.position) <= monster.template.attackRange) {
          monster.state = 'ATTACK';
          break;
        }
        if (tileDistance(monster.position, monster.spawn) > monster.template.leashRadius) {
          monster.state = 'RETURN';
          break;
        }
        this.monsterStepToward(monster, nearest.position, now);
        break;
      }
      case 'ATTACK': {
        if (!nearest) {
          monster.state = 'CHASE';
          break;
        }
        if (tileDistance(monster.position, nearest.position) > monster.template.attackRange) {
          monster.state = 'CHASE';
          break;
        }
        if (now < monster.attackCooldownUntil) break;
        monster.attackCooldownUntil = now + monster.template.attackInterval;
        this.dealDamage(
          { id: monster.id, attackValue: () => monster.template.attack },
          nearest,
          now,
        );
        if (nearest.health <= 0) this.playerKilled(nearest, now);
        break;
      }
      case 'RETURN': {
        if (tileDistance(monster.position, monster.spawn) <= 1) {
          monster.state = 'IDLE';
          break;
        }
        this.monsterStepToward(monster, monster.spawn, now);
        break;
      }
      case 'DEAD':
        break;
    }
  }

  private nearestPlayerInRange(monster: MonsterEntity): GamePlayer | null {
    let best: GamePlayer | null = null;
    let bestDist = monster.template.aggroRadius;
    for (const player of this.players.values()) {
      if (player.position.z !== monster.position.z) continue;
      const d = tileDistance(monster.position, player.position);
      if (d <= bestDist) {
        bestDist = d;
        best = player;
      }
    }
    return best;
  }

  private monsterWander(monster: MonsterEntity, now: number) {
    monster.state = 'WANDER';
    const dirs: Direction[] = ['north', 'east', 'south', 'west'];
    const dir = dirs[Math.floor(Math.random() * dirs.length)];
    if (this.tryStep(monster, dir)) {
      monster.nextMoveAt = now + MOVE_INTERVAL_MS;
      this.emitAll('entity.moved', { id: monster.id, position: { ...monster.position } });
    }
  }

  private monsterStepToward(monster: MonsterEntity, target: Position, now: number) {
    if (now < monster.nextMoveAt) return;
    const dx = Math.sign(target.x - monster.position.x);
    const dy = Math.sign(target.y - monster.position.y);
    const candidates: Direction[] = [];
    if (dx !== 0) candidates.push(dx > 0 ? 'east' : 'west');
    if (dy !== 0) candidates.push(dy > 0 ? 'south' : 'north');
    if (dx !== 0 && dy !== 0) candidates.push(this.diagonal(dx, dy));
    for (const dir of candidates) {
      if (this.tryStep(monster, dir)) {
        monster.nextMoveAt = now + MOVE_INTERVAL_MS;
        this.emitAll('entity.moved', { id: monster.id, position: { ...monster.position } });
        return;
      }
    }
  }

  private diagonal(dx: number, dy: number): Direction {
    if (dx > 0 && dy < 0) return 'northeast';
    if (dx > 0 && dy > 0) return 'southeast';
    if (dx < 0 && dy < 0) return 'northwest';
    return 'southwest';
  }

  private monsterKilled(player: GamePlayer, monster: MonsterEntity, now: number) {
    monster.state = 'DEAD';
    monster.health = 0;
    monster.respawnAt = now + MONSTER_RESPAWN_MS;
    this.emitAll('entity.removed', { id: monster.id });
    this.emitAll('combat.death', { entityId: monster.id, experience: monster.template.experience });
    this.grantExperience(player, monster.template.experience);
    this.spawnLoot(monster);
  }

  private playerKilled(player: GamePlayer, now: number) {
    this.emitAll('combat.death', { entityId: player.id });
    this.emitAll('entity.removed', { id: player.id });
    player.health = player.maxHealth;
    player.mana = player.maxMana;
    player.position = { ...SPAWN_POINT };
    player.targetId = null;
    player.moveDir = null;
    this.emitTo(player.socketId ?? '', 'player.moved', { position: { ...player.position } });
    this.emitTo(player.socketId ?? '', 'stats.update', {
      health: player.health,
      maxHealth: player.maxHealth,
      mana: player.mana,
      maxMana: player.maxMana,
      level: player.level,
      experience: player.experience,
      skills: player.skills,
    });
    this.emitOthers(player.socketId ?? '', 'entity.spawned', {
      id: player.id,
      kind: 'player',
      name: player.name,
      position: player.position,
      health: player.health,
      maxHealth: player.maxHealth,
      level: player.level,
    });
    void now;
  }

  private grantExperience(player: GamePlayer, amount: number) {
    player.experience += amount;
    while (player.experience >= xpForLevel(player.level)) {
      player.experience -= xpForLevel(player.level);
      player.level++;
      player.maxHealth += 15;
      player.maxMana += 5;
      player.attackBase += 1;
      player.defenseBase += Math.ceil(player.level / 3);
      player.health = player.maxHealth;
      player.mana = player.maxMana;
      this.emitTo(player.socketId ?? '', 'chat.message', { channel: 'local', from: 'Sistema', text: `Você subiu para o nível ${player.level}!` });
    }
    this.emitStats(player);
  }

  private spawnLoot(monster: MonsterEntity) {
    for (const entry of monster.template.loot) {
      if (Math.random() * 100 >= entry.weight) continue;
      const def = getItemDef(entry.itemId);
      const quantity = def?.stackable ? 1 + Math.floor(Math.random() * 3) : 1;
      const item: GroundItem = {
        id: uid('loot'),
        itemId: entry.itemId,
        name: def?.name ?? entry.itemId,
        quantity,
        position: { ...monster.position },
        expiresAt: Date.now() + LOOT_LIFETIME_MS,
      };
      this.groundItems.set(item.id, item);
      this.emitAll('loot.spawned', {
        entityId: item.id,
        itemId: item.itemId,
        name: item.name,
        quantity: item.quantity,
        position: item.position,
      });
    }
  }

  private processGroundItems(now: number) {
    for (const [id, item] of this.groundItems) {
      if (item.expiresAt <= now) {
        this.groundItems.delete(id);
        this.emitAll('loot.removed', { entityId: id });
      }
    }
  }

  private processRespawns(now: number) {
    for (const monster of this.monsters.values()) {
      if (monster.state !== 'DEAD' || !monster.respawnAt || monster.respawnAt > now) continue;
      monster.state = 'IDLE';
      monster.health = monster.maxHealth;
      monster.position = { ...monster.spawn };
      monster.respawnAt = null;
      this.emitAll('entity.spawned', this.monsterSpawnPayload(monster));
    }
  }

  private spawnMonster(templateId: string, position: Position) {
    const template = MONSTER_TEMPLATES[templateId];
    if (!template) return;
    const id = uid('m');
    this.monsters.set(id, new MonsterEntity(id, template, position));
  }

  private async persistPlayer(player: GamePlayer) {
    const now = Date.now();
    if (now - player.lastSavedAt < 5000) return;
    player.lastSavedAt = now;
    try {
      await this.store.saveCharacter(player.toStored());
    } catch (err) {
      this.logger.error(`Falha ao salvar ${player.name}: ${(err as Error).message}`);
    }
  }
}
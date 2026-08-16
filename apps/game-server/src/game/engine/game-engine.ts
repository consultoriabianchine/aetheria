import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  BASE_PLAYER,
  CHAT_CHANNELS,
  CHAT_MAX_LENGTH,
  CHAT_MIN_INTERVAL_MS,
  INVENTORY_SIZE,
  LOOT_LIFETIME_MS,
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
import { samePosition, tileDistance, tileKey, uid } from '@aetheria/shared';
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
import { GamePlayer, GroundItem, NpcEntity } from './world';
import { STORE, Store, StoredCharacter } from '../store/store';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatureAIHooks, CreatureAIService, CreatureTarget } from '../creature/creature-ai.service';
import { CreatureDataService } from '../creature/creature-data.service';
import { CreatureEntity } from '../creature/creature.entity';
import { CreatureManager } from '../creature/creature-manager.service';
import { GameLoop } from '../creature/game-loop';
import { MovementService } from '../creature/movement.service';

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
  private npcs = new Map<string, NpcEntity>();
  private groundItems = new Map<string, GroundItem>();
  private tokens = new Map<string, { accountId: string; username: string; exp: number }>();
  private lastSaveAt = Date.now();

  private movement: MovementService;
  private creatures: CreatureManager;
  private ai: CreatureAIService;
  private loop: GameLoop;
  private creatureData: CreatureDataService;

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Optional() prisma?: PrismaService,
  ) {
    this.creatureData = new CreatureDataService(prisma ?? null);
    this.movement = new MovementService(this.world, (position, exceptIds) => this.isOccupied(position, exceptIds));
    this.creatures = new CreatureManager(this.movement);
    const hooks: CreatureAIHooks = {
      movement: this.movement,
      getPlayers: () => this.playerSnapshots(),
      getPlayerById: (id) => this.playerSnapshot(id),
      broadcast: (event, data) => this.emitAll(event, data),
      onAttackPlayer: (creature, target, amount, critical, now) =>
        this.creatureAttackPlayer(creature, target.id, amount, critical, now),
    };
    this.ai = new CreatureAIService(hooks);
    this.loop = new GameLoop(TICK_MS, (_delta, now) => this.tick(now));
  }

  async start() {
    for (const npcId of Object.keys(NPC_TEMPLATES)) {
      const t = NPC_TEMPLATES[npcId];
      this.npcs.set(t.id, {
        id: t.id,
        name: t.name,
        position: { x: 32, y: 28, z: this.world.z },
        dialogue: t.dialogue,
      });
    }
    const data = await this.creatureData.load();
    const spawned = this.creatures.seed(data.definitions, data.spawns);
    for (const creature of spawned) this.emitAll('creature.spawn', this.creatureSpawnPayload(creature));
    this.loop.start();
    this.logger.log(
      `Mundo ${this.world.width}x${this.world.height} criado (${this.world.tiles.length} tiles) com ${this.creatures.size} criaturas.`,
    );
  }

  onModuleDestroy() {
    this.loop.stop();
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

    for (const creature of this.creatures.getAll()) {
      if (creature.state === 'DEAD' || !this.inView(player.position, creature.position)) continue;
      this.emitTo(socketId, 'creature.spawn', this.creatureSpawnPayload(creature));
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
    void this.removePlayerFromWorld(socketId);
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

  private playerSnapshots(): CreatureTarget[] {
    const out: CreatureTarget[] = [];
    for (const player of this.players.values()) {
      if (!player.socketId) continue;
      const snap = this.playerSnapshot(player.id);
      if (snap) out.push(snap);
    }
    return out;
  }

  private playerSnapshot(id: string) {
    const player = this.players.get(id);
    if (!player || !player.socketId) return null;
    return {
      id: player.id,
      position: { ...player.position },
      socketId: player.socketId,
      health: player.health,
      defense: this.defenseValue(player),
    };
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

  private isOccupied(position: Position, exceptIds?: Iterable<string>): boolean {
    const except = new Set(exceptIds ?? []);
    for (const player of this.players.values()) {
      if (except.has(player.id)) continue;
      if (samePosition(player.position, position)) return true;
    }
    for (const creature of this.creatures.getAll()) {
      if (creature.state === 'DEAD') continue;
      if (except.has(creature.id)) continue;
      if (samePosition(creature.position, position)) return true;
    }
    return false;
  }

  private tryStep(entity: GamePlayer, direction: Direction): boolean {
    if (this.movement.canMove(entity.position, direction, [entity.id])) {
      entity.position = this.movement.step(entity.position, direction);
      return true;
    }
    return false;
  }

  private creatureSpawnPayload(creature: CreatureEntity) {
    return {
      creatureId: creature.id,
      definitionId: creature.definitionId,
      slug: creature.definition.slug,
      name: creature.name,
      position: { ...creature.position },
      facing: creature.facing,
      state: creature.state,
      health: creature.health,
      maxHealth: creature.maxHealth,
      level: creature.definition.level,
      viewRange: creature.definition.viewRange,
      chaseRange: creature.definition.chaseRange,
      attackRange: creature.definition.attackRange,
      description: creature.definition.description,
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

  private defenseValue(target: GamePlayer | CreatureEntity): number {
    if (target instanceof CreatureEntity) return target.definition.defense;
    let def = target.defenseBase;
    for (const slot of ['head', 'armor', 'legs', 'boots', 'shield', 'ring', 'amulet'] as const) {
      const item = target.equipment[slot];
      if (item) def += getItemDef(item.itemId)?.defense ?? 0;
    }
    return def;
  }

  // ---------------------------------------------------------------- combat

  private dealDamage(
    attacker: { id: string; attackValue: () => number },
    target: GamePlayer | CreatureEntity,
    _now: number,
  ) {
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
  }

  private creatureAttackPlayer(creature: CreatureEntity, playerId: string, amount: number, critical: boolean, now: number) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.health = Math.max(0, player.health - amount);
    this.emitAll('combat.damage', {
      attackerId: creature.id,
      targetId: player.id,
      amount,
      critical,
      targetHealth: player.health,
    });
    this.emitAll('entity.health', { id: player.id, health: player.health, maxHealth: player.maxHealth });
    if (player.health <= 0) this.playerKilled(player, now);
  }

  // ---------------------------------------------------------------- tick

  private tick(now: number) {
    try {
      for (const player of this.players.values()) {
        if (!player.socketId) continue;
        this.processPlayerMove(player, now);
        this.processPlayerAttack(player, now);
      }
      this.creatures.updateCreatures(this.ai, now);
      this.processGroundItems(now);
      this.creatures.processRespawns(
        now,
        (id) => this.emitAll('creature.remove', { creatureId: id }),
        (entity) => this.emitAll('creature.spawn', this.creatureSpawnPayload(entity)),
      );
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
    if (this.tryStep(player, player.moveDir)) {
      player.nextMoveAt = now + MOVE_INTERVAL_MS;
      this.emitTo(player.socketId ?? '', 'player.moved', { position: { ...player.position } });
      this.emitOthers(player.socketId ?? '', 'entity.moved', { id: player.id, position: { ...player.position } });
    } else {
      player.nextMoveAt = now + 100;
    }
  }

  private processPlayerAttack(player: GamePlayer, now: number) {
    if (!player.targetId) return;
    const target: CreatureEntity | GamePlayer | null =
      this.creatures.getCreature(player.targetId) ?? this.players.get(player.targetId) ?? null;
    if (!target || target.health <= 0 || target.position.z !== player.position.z) {
      player.targetId = null;
      return;
    }
    if (tileDistance(player.position, target.position) > 1.5) return;
    if (now < player.attackCooldownUntil) return;
    player.attackCooldownUntil = now + 700;
    this.dealDamage({ id: player.id, attackValue: () => this.attackValue(player) }, target, now);
    if (target.health <= 0) {
      if (target instanceof CreatureEntity) this.creatureKilled(player, target, now);
      else this.playerKilled(target as GamePlayer, now);
    }
  }

  private creatureKilled(player: GamePlayer, creature: CreatureEntity, now: number) {
    creature.state = 'DEAD';
    creature.health = 0;
    creature.respawnAt = now + creature.respawnTimeMs;
    creature.targetId = null;
    creature.path = [];
    this.emitAll('creature.death', { creatureId: creature.id, experience: creature.definition.experience });
    this.grantExperience(player, creature.definition.experience);
    this.spawnLoot(creature);
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

  private spawnLoot(creature: CreatureEntity) {
    for (const entry of creature.definition.loot) {
      if (Math.random() * 100 >= entry.chance) continue;
      const def = getItemDef(entry.itemId);
      const quantity = entry.minQuantity + Math.floor(Math.random() * (entry.maxQuantity - entry.minQuantity + 1));
      const item: GroundItem = {
        id: uid('loot'),
        itemId: entry.itemId,
        name: def?.name ?? entry.itemId,
        quantity,
        position: { ...creature.position },
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
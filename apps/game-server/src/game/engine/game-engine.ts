import { createHmac } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  ARCHETYPES,
  BASE_PLAYER,
  CHAT_CHANNELS,
  CHAT_MAX_LENGTH,
  CHAT_MIN_INTERVAL_MS,
  COMBAT_FORMULA_CONFIG,
  DEFAULT_PLAYER_OUTFIT_ID,
  DEFAULT_PLAYER_OUTFIT_SLUG,
  HUNT_CATALOG,
  HUNT_CONFIG,
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
  CombatArchetype,
  CombatSkill,
  Direction,
  ItemDefinition,
  ItemVisualEffects,
  PlayerAppearance,
  Position,
} from '@aetheria/types';
import { getItemDef, loadItemCatalogFromDatabase } from './item-catalog';
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
import { HuntEngine, HuntRun } from '../hunts/hunt-engine';
import { MapRegistry } from '../map/map-registry.service';
import { HuntRegistry } from '../hunts/hunt-registry.service';
import { OutfitRegistry } from '../outfit/outfit-registry.service';
import { calculateMaxHp, calculateMaxMana } from '../stats/stat-engine';
import { calculateRegeneration } from '../regeneration/regeneration-engine';
import { trainCombatSkill } from '../skills/skill-progression';
import { aggregateCharacterCombatStats, emptyResistances } from '../combat/character-stat-aggregator';
import { calculateBasicAttack } from '../combat/basic-attack-calculator';
import { calculateMitigatedDamage } from '../combat/damage-calculator';
import { getAmmoDefinition, getWeaponDefinition } from '../combat/item-combat';

export type EmitFn = (socketId: string, event: string, data: unknown) => void;

const BASE_SKILLS: CharacterSkills = {
  melee: BASE_PLAYER.skill,
  distance: BASE_PLAYER.skill,
  magic: BASE_PLAYER.skill,
};

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PROJECTILE_SPEED_PX_PER_SECOND = 520;

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
  private creatureDefinitions = new Map<string, import('@aetheria/types').CreatureDefinition>();
  private hunts: HuntEngine;
  private readonly prisma: PrismaService | undefined;
  private readonly outfitRegistry: OutfitRegistry | undefined;

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Optional() prisma?: PrismaService,
    @Optional() mapRegistry?: MapRegistry,
    @Optional() huntRegistry?: HuntRegistry,
    @Optional() outfitRegistry?: OutfitRegistry,
  ) {
    this.prisma = prisma;
    this.outfitRegistry = outfitRegistry;
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
    this.hunts = new HuntEngine({
      getPlayer: (id) => this.players.get(id) ?? null,
      playerSnapshot: (id) => this.playerSnapshot(id),
      summarize: (player) => this.toSummary(player),
      getCreatureDefinition: (id) => this.creatureDefinitions.get(id) ?? null,
      getMap: (id) => mapRegistry?.getMap(id) ?? null,
      getHunts: () => huntRegistry?.getAll() ?? HUNT_CATALOG,
      emitTo: (socketId, event, data) => this.emitTo(socketId, event, data),
      onCreatureAttackPlayer: (creature, playerId, amount, critical, now) =>
        this.creatureAttackPlayer(creature, playerId, amount, critical, now),
      onRunFinished: (characterId, reason) => this.handleRunFinished(characterId, reason),
      onHuntCompleted: (characterId, huntId, suggestedLevel) => this.handleHuntCompleted(characterId, huntId, suggestedLevel),
      recordCompletion: (characterId, huntId, clearTimeMs) =>
        this.store.recordHuntCompletion(characterId, huntId, clearTimeMs),
      getProgress: async (characterId) => {
        const list = await this.store.listHuntProgress(characterId);
        return new Map(list.map((p) => [p.huntId, p]));
      },
    });
  }

  async start() {
    await loadItemCatalogFromDatabase(this.prisma);
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
    this.creatureDefinitions = data.definitions;
    // O hub (cidade) não possui criaturas — Hunts acontecem em arenas instanciadas.
    this.loop.start();
    this.logger.log(
      `Hub ${this.world.width}x${this.world.height} criado (${this.world.tiles.length} tiles) com ${this.creatureDefinitions.size} definições de criaturas.`,
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

  async handleCreateCharacter(socketId: string, token: string, name: string, archetypeId: CombatArchetype) {
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
    const archetype = ARCHETYPES[archetypeId];
    if (!archetype) {
      this.emitTo(socketId, 'auth.characterCreated', { ok: false, error: 'Arquétipo inválido.' });
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
    const maxHp = calculateMaxHp(1, archetype);
    const maxMana = calculateMaxMana(1, archetype);
    const equipment = Object.fromEntries(
      Object.entries(archetype.initialEquipment).map(([slot, stack]) => [slot, stack ? { ...stack } : undefined]),
    ) as CharacterEquipment;
    const skills = { ...BASE_SKILLS };
    const character = await this.store.createCharacter(session.accountId, {
      name: trimmed,
      archetype: archetypeId,
      gold: 0,
      level: 1,
      experience: 0,
      health: maxHp,
      maxHealth: maxHp,
      mana: maxMana,
      maxMana,
      position: { ...SPAWN_POINT },
      skills,
      skillProgress: (Object.keys(skills) as (keyof CharacterSkills)[]).map((skillType) => ({
        skillType,
        level: skills[skillType],
        experience: 0,
      })),
      inventory: new Array(INVENTORY_SIZE).fill(null),
      equipment,
      appearance: this.defaultPlayerAppearance(),
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

    if (!stored.appearance) {
      stored.appearance = this.defaultPlayerAppearance();
      await this.store.saveCharacter(stored);
    }

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

  // ---------------------------------------------------------------- hunts

  private async verifySession(socketId: string, token: string): Promise<{ player: GamePlayer } | null> {
    const session = this.verifyToken(token);
    const player = this.playerForSocket(socketId);
    if (!session || !player || player.accountId !== session.accountId) return null;
    return { player };
  }

  async handleHuntList(socketId: string, token: string) {
    const session = await this.verifySession(socketId, token);
    if (!session) return;
    const hunts = await Promise.all(this.hunts.listHunts().map((h) => this.hunts.toListEntry(h, session.player.id)));
    this.emitTo(socketId, 'hunt.list', { hunts });
  }

  async handleHuntStart(socketId: string, token: string, huntId: string, loopEnabled: boolean) {
    const session = await this.verifySession(socketId, token);
    if (!session) return;
    const player = session.player;
    const result = this.hunts.startHunt(player.id, huntId, loopEnabled, Date.now());
    if (!result.ok) {
      this.emitTo(socketId, 'error', { message: this.huntErrorLabel(result.error) });
      return;
    }
    this.emitOthers(socketId, 'entity.removed', { id: player.id });
    this.logger.log(`Jogador ${player.name} entrou na hunt ${huntId}.`);
  }

  handleHuntStop(socketId: string, token: string) {
    void this.verifySession(socketId, token).then((session) => {
      if (!session) return;
      if (this.hunts.stopHunt(session.player.id)) {
        this.logger.log(`Jogador ${session.player.name} abandonou a hunt.`);
      }
    });
  }

  handleHuntSetLoop(socketId: string, token: string, enabled: boolean) {
    void this.verifySession(socketId, token).then((session) => {
      if (!session) return;
      this.hunts.setLoop(session.player.id, enabled);
    });
  }

  async handleAppearanceList(socketId: string, token: string) {
    const session = await this.verifySession(socketId, token);
    if (!session) return;
    const outfits = await this.availableOutfits(session.player.id);
    this.emitTo(socketId, 'appearance.list', { outfits });
  }

  async handleAppearanceSave(socketId: string, token: string, outfitId: number, addonMask: number, colors: { head: number; primary: number; secondary: number; detail: number }) {
    const session = await this.verifySession(socketId, token);
    if (!session) return;
    const player = session.player;
    const outfits = await this.availableOutfits(player.id);
    const target = outfits.find((o) => o.outfitId === outfitId);
    if (!target) {
      this.emitTo(socketId, 'error', { message: 'Outfit não disponível para este personagem.' });
      return;
    }
    const appearance = { outfitId, addonMask: target.supportsAddons ? (addonMask & 3) : 0, colors };
    player.appearance = appearance;
    await this.persistPlayer(player);
    const payload = { entityId: player.id, outfitId: appearance.outfitId, addonMask: appearance.addonMask, colors: appearance.colors };
    this.emitTo(socketId, 'appearance.changed', payload);
    this.emitOthers(socketId, 'appearance.changed', payload);
    this.logger.log(`Jogador ${player.name} mudou a aparência para o outfit ${outfitId}.`);
  }

  private async availableOutfits(characterId: string) {
    const registry = this.outfitRegistry;
    if (!registry) return [];
    const all = registry.listOutfits().filter((o) => o.enabled && o.published);
    let grantedIds = new Set<number>();
    if (this.prisma) {
      try {
        const granted = await this.prisma.characterOutfit.findMany({ where: { character_id: characterId } });
        grantedIds = new Set(granted.map((g) => g.outfit_id));
      } catch {
        grantedIds = new Set();
      }
    }
    return all
      .filter((o) => o.availableByDefault || grantedIds.has(o.outfitId))
      .map((o) => ({ outfitId: o.outfitId, name: o.name, slug: o.slug, category: o.category, supportsColors: o.supportsColors, supportsAddons: o.supportsAddons }));
  }

  private huntErrorLabel(error: string): string {
    switch (error) {
      case 'HUNT_NOT_FOUND':
        return 'Hunt não encontrada.';
      case 'HUNT_DISABLED':
        return 'Hunt desabilitada.';
      case 'CHARACTER_ALREADY_IN_HUNT':
        return 'Você já está em uma hunt.';
      default:
        return 'Não foi possível iniciar a hunt.';
    }
  }

  /** Bônus de ouro por concluir uma Hunt (bônus de clear). */
  private handleHuntCompleted(characterId: string, huntId: string, suggestedLevel: number) {
    const player = this.players.get(characterId);
    if (!player) return;
    const bonus = HUNT_CONFIG.gold.clearBonus(suggestedLevel);
    if (bonus <= 0) return;
    player.gold += bonus;
    this.emitTo(player.socketId ?? '', 'gold.update', { gold: player.gold });
    this.emitTo(player.socketId ?? '', 'chat.message', {
      channel: 'local',
      from: 'Sistema',
      text: `Bônus de conclusão: +${bonus} gold.`,
    });
    void huntId;
  }

  /** Finaliza a run no motor e devolve o jogador ao hub. */
  private handleRunFinished(characterId: string, reason: 'completed' | 'wiped' | 'stopped') {
    const run = this.hunts.getRun(characterId);
    this.hunts.removeRun(characterId);
    const player = this.players.get(characterId);
    if (!player) return;
    player.position = { ...SPAWN_POINT };
    player.health = player.maxHealth;
    player.mana = player.maxMana;
    player.targetId = null;
    player.moveDir = null;
    const socketId = player.socketId ?? '';
    this.emitTo(socketId, 'game.enterWorld', {
      character: this.toSummary(player),
      map: this.world.tiles,
      width: this.world.width,
      height: this.world.height,
    });
    this.emitStats(player);
    this.emitInventory(player);
    this.emitTo(socketId, 'hunt.returnedToCity', {});
    this.emitOthers(socketId, 'entity.spawned', {
      id: player.id,
      kind: 'player',
      name: player.name,
      position: player.position,
      health: player.health,
      maxHealth: player.maxHealth,
      level: player.level,
    });
    this.logger.log(`Jogador ${player.name} retornou ao hub (${reason}).`);
    void run;
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
      this.hunts.removeRun(characterId);
      this.emitAll('entity.removed', { id: characterId });
      await this.persistPlayer(player);
      this.logger.log(`Jogador ${player.name} saiu.`);
    }
  }

  handleInput(socketId: string, direction: Direction | null | undefined) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    if (this.hunts.getRun(player.id)) {
      player.moveDir = null;
      return;
    }
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
      archetype: c.archetype,
      gold: c.gold,
      level: c.level,
      experience: c.experience,
      health: c.health,
      maxHealth: c.maxHealth,
      mana: c.mana,
      maxMana: c.maxMana,
      position: { ...c.position },
      skills: { ...c.skills },
      appearance: c.appearance
        ? { ...c.appearance }
        : this.defaultPlayerAppearance(),
    };
  }

  private defaultPlayerAppearance(): PlayerAppearance {
    const outfit = this.outfitRegistry?.listOutfits().find((o) => o.slug === DEFAULT_PLAYER_OUTFIT_SLUG);
    return {
      outfitId: outfit?.outfitId ?? DEFAULT_PLAYER_OUTFIT_ID,
      addonMask: 0,
      colors: outfit?.defaultColors ?? { head: 0, primary: 0, secondary: 0, detail: 0 },
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
      definitionCreatureId: creature.definition.creatureId,
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
      movementSpeed: creature.definition.movementSpeed,
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
      skillProgress: player.skillProgress.map((progress) => ({ ...progress })),
    });
  }

  private emitInventory(player: GamePlayer) {
    const inventory: CharacterInventory = {
      slots: player.inventory.map((s) => (s ? { ...s } : null)),
      equipment: { ...player.equipment },
    };
    this.emitTo(player.socketId ?? '', 'inventory.update', { inventory });
  }

  private combatStats(player: GamePlayer) {
    return aggregateCharacterCombatStats({
      level: player.level,
      maxHp: player.maxHealth,
      maxMana: player.maxMana,
      skills: player.skills,
      equipment: player.equipment,
      getItem: getItemDef,
    });
  }

  private targetCombatStats(target: GamePlayer | CreatureEntity) {
    if (target instanceof GamePlayer) return this.combatStats(target);
    return {
      level: target.definition.level,
      maxHp: target.maxHealth,
      maxMana: 0,
      armor: 0,
      defense: target.definition.defense,
      meleeSkill: 0,
      distanceSkill: 0,
      magicLevel: 0,
      criticalChance: COMBAT_FORMULA_CONFIG.baseCriticalChance,
      criticalDamage: COMBAT_FORMULA_CONFIG.baseCriticalDamage,
      accuracy: 0,
      dodge: 0,
      resistances: emptyResistances(),
    };
  }

  private defenseValue(target: GamePlayer | CreatureEntity): number {
    const stats = this.targetCombatStats(target);
    return stats.armor + stats.defense;
  }

  // ---------------------------------------------------------------- combat

  /** Roteia eventos de combate: para a run da arena se houver, senão global. */
  private emitCombatEvent(target: GamePlayer | CreatureEntity, event: string, data: unknown) {
    if (target instanceof GamePlayer) {
      const run = this.hunts.getRun(target.id);
      if (run) {
        this.emitTo(target.socketId ?? '', event, data);
        return;
      }
      this.emitAll(event, data);
      return;
    }
    const run = this.hunts.findRunByCreature(target.id);
    if (run) {
      const p = this.players.get(run.characterId);
      this.emitTo(p?.socketId ?? '', event, data);
      return;
    }
    this.emitAll(event, data);
  }

  private dealDamage(attacker: GamePlayer, target: GamePlayer | CreatureEntity, now: number): boolean {
    const weaponItem = attacker.equipment.weapon ? getItemDef(attacker.equipment.weapon.itemId) : undefined;
    const ammoItem = attacker.equipment.ammo ? getItemDef(attacker.equipment.ammo.itemId) : undefined;
    const attack = calculateBasicAttack({
      archetype: attacker.archetype,
      attacker: this.combatStats(attacker),
      loadout: { weapon: getWeaponDefinition(weaponItem), ammo: getAmmoDefinition(ammoItem) },
      rng: () => this.nextCombatRandom(attacker, now),
    });
    if (!attack.valid) return false;
    const damage = calculateMitigatedDamage({
      damage: attack.damageBeforeMitigation,
      damageType: attack.damageType,
      target: this.targetCombatStats(target),
    });
    const amount = damage.finalDamage;
    const projectileVisual = this.resolveProjectileVisual(weaponItem, ammoItem);
    const travelTimeMs = projectileVisual?.projectile ? this.projectileTravelTimeMs(attacker.position, target.position, projectileVisual) : 0;
    if (projectileVisual?.projectile) {
      this.emitCombatEvent(target, 'combat.projectile', {
        attackerId: attacker.id,
        targetId: target.id,
        from: { ...attacker.position },
        to: { ...target.position },
        projectile: projectileVisual.projectile,
        impact: projectileVisual.impact,
        travelTimeMs,
      });
    }
    target.health = Math.max(0, target.health - amount);
    this.emitCombatEvent(target, 'combat.damage', {
      attackerId: attacker.id,
      targetId: target.id,
      amount,
      critical: attack.critical,
      targetHealth: target.health,
      delayMs: travelTimeMs || undefined,
    });
    this.emitCombatEvent(target, 'entity.health', { id: target.id, health: target.health, maxHealth: target.maxHealth });
    return true;
  }

  private resolveProjectileVisual(weaponItem: ItemDefinition | undefined, ammoItem: ItemDefinition | undefined): ItemVisualEffects | null {
    const weaponType = weaponItem?.weapon?.weaponType;
    if (weaponType === 'staff') return weaponItem?.visual?.projectile ? weaponItem.visual : null;
    if (weaponType === 'bow' || weaponType === 'crossbow') return ammoItem?.visual?.projectile ? ammoItem.visual : null;
    return null;
  }

  private projectileTravelTimeMs(from: Position, to: Position, visual: ItemVisualEffects): number {
    const dx = (to.x - from.x) * 32;
    const dy = (to.y - from.y) * 32;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const speed = visual.projectile?.speedPxPerSecond || DEFAULT_PROJECTILE_SPEED_PX_PER_SECOND;
    return Math.round((distance / speed) * 1000);
  }

  private creatureAttackPlayer(creature: CreatureEntity, playerId: string, amount: number, critical: boolean, now: number) {
    const player = this.players.get(playerId);
    if (!player) return;
    const damage = calculateMitigatedDamage({
      damage: amount,
      damageType: 'physical',
      target: this.targetCombatStats(player),
    });
    const reduced = damage.finalDamage;
    player.health = Math.max(0, player.health - reduced);
    this.emitCombatEvent(player, 'combat.damage', {
      attackerId: creature.id,
      targetId: player.id,
      amount: reduced,
      critical,
      targetHealth: player.health,
    });
    this.emitCombatEvent(player, 'entity.health', { id: player.id, health: player.health, maxHealth: player.maxHealth });
    if (player.health <= 0) this.playerKilled(player, now);
  }

  private emitSkillEvents(player: GamePlayer, events: { skill: keyof CharacterSkills; oldLevel: number; newLevel: number }[]) {
    if (events.length === 0) return;
    for (const e of events) {
      this.emitTo(player.socketId ?? '', 'chat.message', {
        channel: 'local',
        from: 'Sistema',
        text: `Sua habilidade ${e.skill} avançou para o nível ${e.newLevel}!`,
      });
    }
    this.emitTo(player.socketId ?? '', 'skills.update', { skills: player.skills });
  }

  private nextCombatRandom(player: GamePlayer, now: number): number {
    const x = Math.sin(now * 12.9898 + player.id.length * 78.233 + player.experience * 0.37) * 43758.5453;
    return x - Math.floor(x);
  }

  // ---------------------------------------------------------------- tick

  private tick(now: number) {
    try {
      for (const player of this.players.values()) {
        if (!player.socketId) continue;
        this.regeneratePlayer(player, now);
        this.processPlayerMove(player, now);
        this.processPlayerAttack(player, now);
      }
      this.creatures.updateCreatures(this.ai, now);
      this.hunts.update(now);
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

  private regeneratePlayer(player: GamePlayer, now: number) {
    if (!player.lastRegenAt) player.lastRegenAt = now;
    const elapsedMs = now - player.lastRegenAt;
    if (elapsedMs < 1000) return;
    player.lastRegenAt = now;
    const result = calculateRegeneration(elapsedMs / 1000, {
      archetype: player.archetype,
      currentHp: player.health,
      currentMana: player.mana,
      maxHp: player.maxHealth,
      maxMana: player.maxMana,
    });
    if (result.finalHp !== player.health || result.finalMana !== player.mana) {
      player.health = result.finalHp;
      player.mana = result.finalMana;
      this.emitStats(player);
    }
  }

  private processPlayerMove(player: GamePlayer, now: number) {
    if (!player.moveDir) return;
    if (this.hunts.getRun(player.id)) return;
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
    const run = this.hunts.getRun(player.id);
    if (run) {
      if (!player.targetId) {
        player.targetId = this.nearestArenaCreature(run, player);
      }
      if (!player.targetId) return;
    }
    if (!player.targetId) return;
    const target: CreatureEntity | GamePlayer | null =
      (run ? run.creatures.getCreature(player.targetId) : this.creatures.getCreature(player.targetId)) ??
      this.players.get(player.targetId) ??
      null;
    if (!target || target.health <= 0 || target.position.z !== player.position.z) {
      player.targetId = null;
      return;
    }
    if (now < player.attackCooldownUntil) return;
    const weaponItem = player.equipment.weapon ? getItemDef(player.equipment.weapon.itemId) : undefined;
    const weapon = getWeaponDefinition(weaponItem);
    if (!weapon || tileDistance(player.position, target.position) > weapon.range) return;
    player.attackCooldownUntil = now + (weapon.attackIntervalMs ?? COMBAT_FORMULA_CONFIG.baseAttackGroupMs);
    const didAttack = this.dealDamage(player, target, now);
    if (!didAttack) return;
    this.trainAttackSkill(player);
    if (target.health <= 0) {
      if (target instanceof CreatureEntity) this.creatureKilled(player, target, now);
      else this.playerKilled(target as GamePlayer, now);
    }
  }

  private nearestArenaCreature(run: HuntRun, player: GamePlayer): string | null {
    let bestId: string | null = null;
    let bestDist = Infinity;
    for (const c of run.creatures.getAll()) {
      if (c.state === 'DEAD') continue;
      if (c.position.z !== player.position.z) continue;
      const d = tileDistance(player.position, c.position);
      if (d < bestDist) {
        bestDist = d;
        bestId = c.id;
      }
    }
    return bestId;
  }

  private trainAttackSkill(player: GamePlayer) {
    const skill: CombatSkill = ARCHETYPES[player.archetype].primarySkill;
    const result = trainCombatSkill(player.skills, player.skillProgress, skill, 1);
    player.skills = result.skills;
    player.skillProgress = result.progress;
    this.emitSkillEvents(player, result.events);
  }

  private creatureKilled(player: GamePlayer, creature: CreatureEntity, now: number) {
    const run = this.hunts.findRunByCreature(creature.id);
    const isBoss = !!run && run.isBossWave && creature.id === run.bossCreatureId;
    if (run) {
      run.creatures.removeCreature(creature.id);
      const socketId = player.socketId ?? '';
      this.emitTo(socketId, 'creature.death', { creatureId: creature.id, experience: creature.definition.experience });
      this.emitTo(socketId, 'creature.remove', { creatureId: creature.id });
    } else {
      creature.state = 'DEAD';
      creature.health = 0;
      creature.respawnAt = now + creature.respawnTimeMs;
      creature.targetId = null;
      creature.path = [];
      this.emitAll('creature.death', { creatureId: creature.id, experience: creature.definition.experience });
    }
    this.grantExperience(player, creature.definition.experience);
    this.grantKillGold(player, creature, isBoss);
    this.spawnLoot(creature, run);
  }

  private grantKillGold(player: GamePlayer, creature: CreatureEntity, isBoss: boolean) {
    const amount = isBoss
      ? HUNT_CONFIG.gold.boss(creature.definition.level)
      : HUNT_CONFIG.gold.perKill(creature.definition.level);
    if (amount <= 0) return;
    player.gold += amount;
    this.emitTo(player.socketId ?? '', 'gold.update', { gold: player.gold });
  }

  private playerKilled(player: GamePlayer, now: number) {
    const run = this.hunts.getRun(player.id);
    if (run) {
      this.emitTo(player.socketId ?? '', 'combat.death', { entityId: player.id });
      this.hunts.onPlayerDied(player.id, now);
      return;
    }
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
      const archetype = ARCHETYPES[player.archetype];
    while (player.experience >= xpForLevel(player.level)) {
      player.experience -= xpForLevel(player.level);
      player.level++;
      player.maxHealth = calculateMaxHp(player.level, archetype);
      player.maxMana = calculateMaxMana(player.level, archetype);
      player.attackBase = player.level + 8;
      player.defenseBase = 5 + Math.floor(player.level / 2);
      player.health = player.maxHealth;
      player.mana = player.maxMana;
      this.emitTo(player.socketId ?? '', 'chat.message', { channel: 'local', from: 'Sistema', text: `Você subiu para o nível ${player.level}!` });
    }
    this.emitStats(player);
  }

  private spawnLoot(creature: CreatureEntity, run?: HuntRun | null) {
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
      const payload = {
        entityId: item.id,
        itemId: item.itemId,
        name: item.name,
        quantity: item.quantity,
        position: item.position,
      };
      if (run) {
        const player = this.players.get(run.characterId);
        this.emitTo(player?.socketId ?? '', 'loot.spawned', payload);
      } else {
        this.emitAll('loot.spawned', payload);
      }
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

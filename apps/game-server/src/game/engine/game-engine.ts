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
  LOOT_POUCH_EXPANSION,
  LOOT_POUCH_SIZE,
  LOOT_LIFETIME_MS,
  NPC_INTERACT_RANGE,
  NPC_TEMPLATES,
  PICKUP_RANGE,
  PLAYER_AI,
  SPAWN_POINT,
  TICK_MS,
  VIEW_DISTANCE_X,
  VIEW_DISTANCE_Y,
  WEAPON_ELEMENT_OVERRIDE_CONFIG,
  xpForLevel,
} from '@aetheria/config';
import { samePosition, tileDistance, tileKey, uid } from '@aetheria/shared';
import type {
  CharacterEquipment,
  CharacterInventory,
  CharacterSkills,
  CharacterSummary,
  CombatArchetype,
  DamageType,
  CombatSkill,
  Direction,
  ItemDefinition,
  ItemStack,
  ItemVisualEffects,
  PlayerAppearance,
  PlayerCombatConfig,
  Position,
} from '@aetheria/types';
import { getItemDef, loadItemCatalogFromDatabase } from './item-catalog';
import { generateWorldMap } from './world-map';
import { GamePlayer, GroundItem, NpcEntity } from './world';
import { STORE, Store, StoredCharacter } from '../store/store';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatureAIHooks, CreatureAIService, CreatureTarget } from '../creature/creature-ai.service';
import { PlayerCombatAIService } from '../combat/player-combat-ai';
import { CreatureDataService } from '../creature/creature-data.service';
import { CreatureEntity } from '../creature/creature.entity';
import { CreatureManager } from '../creature/creature-manager.service';
import { GameLoop } from '../creature/game-loop';
import { MovementService } from '../creature/movement.service';
import { HuntEngine, HuntRun } from '../hunts/hunt-engine';
import { MapRegistry } from '../map/map-registry.service';
import { HuntRegistry } from '../hunts/hunt-registry.service';
import { OutfitRegistry } from '../outfit/outfit-registry.service';
import { ReadyQueue } from './ready-queue';
import { calculateMaxHp, calculateMaxMana } from '../stats/stat-engine';
import { calculateRegeneration } from '../regeneration/regeneration-engine';
import { trainCombatSkill } from '../skills/skill-progression';
import { aggregateCharacterCombatStats, emptyResistances } from '../combat/character-stat-aggregator';
import { calculateBasicAttack } from '../combat/basic-attack-calculator';
import { calculateMitigatedDamage } from '../combat/damage-calculator';
import { calculateRawDamage, calculateCritical, rollCritical, rollVariance } from '../combat/combat-formulas';
import { resolveDamageAffinity } from '../combat/damage-affinity-resolver';
import { getAmmoDefinition, getWeaponDefinition } from '../combat/item-combat';
import { AbilityRegistry } from '../combat/ability-registry';

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
  private playerAI = new PlayerCombatAIService();
  private loop: GameLoop;
  private creatureData: CreatureDataService;
  private creatureDefinitions = new Map<string, import('@aetheria/types').CreatureDefinition>();
  private hunts: HuntEngine;
  private readonly prisma: PrismaService | undefined;
  private readonly outfitRegistry: OutfitRegistry | undefined;
  private readonly abilityRegistry: AbilityRegistry;
  private abilityCooldowns = new Map<string, Map<number, number>>();
  private attackRotations = new Map<string, { abilityId?: number; enabled: boolean; minTargets?: number }[]>();
  private attackGroupReadyAt = new Map<string, number>();
  private healingRotations = new Map<string, { abilityId?: number; enabled: boolean; hpBelowPercent: number }[]>();
  private healingGroupReadyAt = new Map<string, number>();
  private monsterAbilities = new Map<number, { abilityId: number; priority: number; chance: number; cooldownOverrideMs?: number; parameters?: Record<string, number> }[]>();
  private monsterAbilityReadyAt = new Map<string, Map<number, number>>();
  private activeAbilityCasts = new Set<string>();
  private combatEvents = new ReadyQueue<{ key: string; playerId: string; type: 'attack' | 'heal'; readyAt: number }>();
  private combatEventReadyAt = new Map<string, number>();
  private processingCombatEvents = false;
  private huntEvents = new ReadyQueue<{ characterId: string; readyAt: number }>();
  private huntEventReadyAt = new Map<string, number>();
  private processingHuntEvents = false;
  private regenEvents = new ReadyQueue<{ playerId: string; readyAt: number }>();
  private regenEventReadyAt = new Map<string, number>();
  private moveEvents = new ReadyQueue<{ playerId: string; readyAt: number }>();
  private moveEventReadyAt = new Map<string, number>();
  private groundItemEvents = new ReadyQueue<{ itemId: string; readyAt: number }>();
  private groundItemEventReadyAt = new Map<string, number>();
  private saveEvents = new ReadyQueue<{ playerId: string; readyAt: number }>();
  private saveEventReadyAt = new Map<string, number>();

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Optional() prisma?: PrismaService,
    @Optional() mapRegistry?: MapRegistry,
    @Optional() huntRegistry?: HuntRegistry,
    @Optional() outfitRegistry?: OutfitRegistry,
    @Optional() abilityRegistry?: AbilityRegistry,
  ) {
    this.prisma = prisma;
    this.abilityRegistry = abilityRegistry ?? new AbilityRegistry(prisma as never);
    this.outfitRegistry = outfitRegistry;
    this.creatureData = new CreatureDataService(prisma ?? null);
    this.movement = new MovementService(this.world, (position, exceptIds) => this.isOccupied(position, exceptIds));
    this.creatures = new CreatureManager(this.movement);
    const hooks: CreatureAIHooks = {
      movement: this.movement,
      getPlayers: () => this.playerSnapshots(),
      getPlayerById: (id) => this.playerSnapshot(id),
      broadcast: (event, data) => this.emitAll(event, data),
      onAttackPlayer: (creature, target, amount, critical, now) => {
        void this.creatureAttackWithAbility(creature, target.id, amount, critical, now);
      },
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
      return false;
    }
    let account = await this.store.findAccountByUsername(uname);
    if (!account) {
      account = await this.store.createAccount(uname, bcrypt.hashSync(password, 10));
    } else if (!bcrypt.compareSync(password, account.passwordHash)) {
      this.emitTo(socketId, 'auth.loginResult', { ok: false, error: 'Senha incorreta.' });
      return false;
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
      return false;
    }
    const trimmed = name.trim();
    if (trimmed.length < 3 || trimmed.length > 16 || !/^[A-Za-zÀ-ÿ0-9 ]+$/.test(trimmed)) {
      this.emitTo(socketId, 'auth.characterCreated', {
        ok: false,
        error: 'Nome deve ter entre 3 e 16 caracteres (letras, números e espaços).',
      });
      return false;
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
      lootPouchSize: LOOT_POUCH_SIZE,
      lootPouch: new Array(LOOT_POUCH_SIZE).fill(null),
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
      return false;
    }
    this.removePlayerFromWorld(socketId);

    if (!stored.appearance) {
      stored.appearance = this.defaultPlayerAppearance();
      await this.store.saveCharacter(stored);
    }

    const player = new GamePlayer(stored);
    player.socketId = socketId;
    player.recomputeSpeed(getItemDef);
    this.players.set(player.id, player);
    this.playerBySocket.set(socketId, player.id);
    if (this.prisma) {
      const slots = await this.prisma.characterAttackRotationSlot.findMany({ where: { character_id: player.id, preset: 'HUNT' }, orderBy: { slot_position: 'asc' } });
      this.attackRotations.set(player.id, slots.map((slot) => ({ abilityId: slot.ability_id ?? undefined, enabled: slot.enabled, minTargets: slot.min_targets ?? undefined })));
      const heals = await this.prisma.characterHealingRotationSlot.findMany({ where: { character_id: player.id, preset: 'HUNT' }, orderBy: { slot_position: 'asc' } });
      this.healingRotations.set(player.id, heals.map((slot) => ({ abilityId: slot.ability_id ?? undefined, enabled: slot.enabled, hpBelowPercent: Number((slot.trigger as { hpBelowPercent?: number }).hpBelowPercent ?? 100) })));
      this.emitTo(socketId, 'rotation.state', { preset: 'HUNT', attack: slots, healing: heals, cooldowns: { attackGroupReadyAt: 0, healingGroupReadyAt: 0, abilityReadyAt: {} } });
    }
    const override = await this.store.getWeaponElementOverride(player.id);
    if (override) {
      player.weaponElementOverride = override;
      this.emitTo(socketId, 'combat.weaponElementOverride.applied', { override });
    }
    this.schedulePlayerRegen(player.id, Date.now() + 1000);
    this.schedulePlayerSave(player.id, Date.now() + 10_000);
    this.schedulePlayerAttackCheck(player, Date.now());
    this.schedulePlayerHealCheck(player, Date.now());

    this.emitTo(socketId, 'auth.selectResult', { ok: true });
    this.emitTo(socketId, 'abilities.update', { abilities: await this.abilityRegistry.list() });
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
    player.moveDir = null;
    this.moveEventReadyAt.delete(player.id);
    this.schedulePlayerAttackCheck(player, Date.now());
    this.schedulePlayerHealCheck(player, Date.now());
    this.scheduleHuntUpdate(player.id, Date.now());
    this.logger.log(`Jogador ${player.name} entrou na hunt ${huntId}.`);
  }

  handleHuntStop(socketId: string, token: string) {
    void this.verifySession(socketId, token).then((session) => {
      if (!session) return;
      if (this.hunts.stopHunt(session.player.id)) {
        this.huntEventReadyAt.delete(session.player.id);
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

  handleCombatConfig(socketId: string, token: string, targeting: unknown, movement: unknown) {
    void this.verifySession(socketId, token).then(async (session) => {
      if (!session) return;
      const player = session.player;
      const t = targeting as PlayerCombatConfig['targeting'];
      const m = movement as PlayerCombatConfig['movement'];
      if (!['nearest', 'furthest', 'lowestHp', 'highestHp'].includes(t)) return;
      if (!['kite', 'hold', 'engage'].includes(m)) return;
      player.combat = { targeting: t, movement: m };
      this.playerAI.clear(player.id);
      await this.persistPlayer(player);
      this.emitTo(socketId, 'combat.config', { combat: { ...player.combat } });
    });
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
    this.huntEventReadyAt.delete(characterId);
    const player = this.players.get(characterId);
    if (!player) return;
    player.position = { ...SPAWN_POINT };
    player.health = player.maxHealth;
    player.mana = player.maxMana;
    player.targetId = null;
    player.moveDir = null;
    this.moveEventReadyAt.delete(player.id);
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
      this.huntEventReadyAt.delete(characterId);
      this.regenEventReadyAt.delete(characterId);
      this.moveEventReadyAt.delete(characterId);
      this.saveEventReadyAt.delete(characterId);
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
      this.moveEventReadyAt.delete(player.id);
      return;
    }
    player.moveDir = direction ?? null;
    if (player.moveDir) this.schedulePlayerMove(player, Math.max(Date.now(), player.nextMoveAt));
    else this.moveEventReadyAt.delete(player.id);
  }

  async handleAbilityCast(socketId: string, abilityId: number, targetId?: string): Promise<boolean> {
    const playerId = this.playerBySocket.get(socketId);
    const player = playerId ? this.players.get(playerId) : undefined;
    const ability = await this.abilityRegistry.get(abilityId);
    if (!player || !ability || !ability.enabled || !['player', 'both'].includes(ability.ownerType)) {
      this.emitTo(socketId, 'ability.castFailed', { abilityId, reason: 'ABILITY_UNAVAILABLE' });
      return false;
    }
    const now = Date.now();
    const castKey = `${player.id}:${abilityId}`;
    if (this.activeAbilityCasts.has(castKey)) return false;
    this.activeAbilityCasts.add(castKey);
    const cooldowns = this.abilityCooldowns.get(player.id) ?? new Map<number, number>();
    if ((cooldowns.get(abilityId) ?? 0) > now) {
      this.emitTo(socketId, 'ability.castFailed', { abilityId, reason: 'COOLDOWN' });
      this.activeAbilityCasts.delete(castKey);
      return false;
    }
    const groupReadyAt = ability.cooldownGroup === 'healing' ? (this.healingGroupReadyAt.get(player.id) ?? 0) : (this.attackGroupReadyAt.get(player.id) ?? 0);
    if (groupReadyAt > now) { this.activeAbilityCasts.delete(castKey); this.emitTo(socketId, 'ability.castFailed', { abilityId, reason: 'GROUP_COOLDOWN' }); return false; }
    if ((ability.manaCost ?? 0) > player.mana) {
      this.activeAbilityCasts.delete(castKey);
      this.emitTo(socketId, 'ability.castFailed', { abilityId, reason: 'MANA' });
      return false;
    }
    const resolvedTargetId = targetId ?? player.targetId ?? undefined;
    const run = this.hunts.getRun(player.id);
    const target = resolvedTargetId
      ? (run?.creatures.getCreature(resolvedTargetId) ?? this.creatures.getCreature(resolvedTargetId) ?? this.players.get(resolvedTargetId))
      : undefined;
    if (ability.category !== 'heal' && (!target || tileDistance(player.position, target.position) > ability.rangeTiles)) {
      this.activeAbilityCasts.delete(castKey);
      this.emitTo(socketId, 'ability.castFailed', { abilityId, reason: 'INVALID_TARGET' });
      return false;
    }
    if (ability.cooldownGroup === 'healing') this.healingGroupReadyAt.set(player.id, now + 1000);
    else this.attackGroupReadyAt.set(player.id, now + 2000);
    player.mana -= ability.manaCost ?? 0;
    cooldowns.set(abilityId, now + ability.cooldownMs);
    this.abilityCooldowns.set(player.id, cooldowns);
    this.emitTo(socketId, 'ability.cast', { abilityId, attackerId: player.id, targetId });
    if (ability.category === 'heal') {
      const amount = Math.max(1, ability.defaultParameters?.power ?? 30);
      player.health = Math.min(player.maxHealth, player.health + amount);
      this.emitHeal(player.id, player, amount);
      this.emitStats(player);
    } else if (target) {
      this.dealAbilityDamage(player, target, ability, now);
      this.emitStats(player);
    } else {
      this.emitStats(player);
    }
    this.activeAbilityCasts.delete(castKey);
    return true;
  }

  async handleRotationLoad(socketId: string, preset: string) {
    const player = this.playerForSocket(socketId);
    if (!player || !['HUNT', 'BOSS', 'HELPER'].includes(preset) || !this.prisma) return;
    const [attack, healing] = await Promise.all([
      this.prisma.characterAttackRotationSlot.findMany({ where: { character_id: player.id, preset }, orderBy: { slot_position: 'asc' } }),
      this.prisma.characterHealingRotationSlot.findMany({ where: { character_id: player.id, preset }, orderBy: { slot_position: 'asc' } }),
    ]);
    this.attackRotations.set(player.id, attack.map((slot) => ({ abilityId: slot.ability_id ?? undefined, enabled: slot.enabled, minTargets: slot.min_targets ?? undefined })));
    this.healingRotations.set(player.id, healing.map((slot) => ({ abilityId: slot.ability_id ?? undefined, enabled: slot.enabled, hpBelowPercent: Number((slot.trigger as { hpBelowPercent?: number }).hpBelowPercent ?? 80) })));
    this.emitTo(socketId, 'rotation.state', { preset, attack, healing, saved: true, cooldowns: { attackGroupReadyAt: this.attackGroupReadyAt.get(player.id) ?? 0, healingGroupReadyAt: this.healingGroupReadyAt.get(player.id) ?? 0, abilityReadyAt: Object.fromEntries(this.abilityCooldowns.get(player.id) ?? []) } });
    this.schedulePlayerAttackCheck(player, Date.now());
    this.schedulePlayerHealCheck(player, Date.now());
  }

  handleAttackRotation(socketId: string, preset: string, slots: { position: number; abilityId?: number; enabled: boolean; minTargets?: number }[]) {
    const player = this.playerForSocket(socketId); if (!player || !['HUNT', 'BOSS', 'HELPER'].includes(preset)) return;
    const ordered = slots.sort((a, b) => a.position - b.position);
    this.attackRotations.set(player.id, ordered);
    this.schedulePlayerAttackCheck(player, Date.now());
    if (this.prisma) void this.prisma.$transaction(async (tx) => { await tx.characterAttackRotationSlot.deleteMany({ where: { character_id: player.id, preset } }); await tx.characterAttackRotationSlot.createMany({ data: ordered.map((slot) => ({ character_id: player.id, preset, slot_position: slot.position, ability_id: slot.abilityId ?? null, enabled: slot.enabled, min_targets: slot.minTargets ?? null })) }); return tx.characterAttackRotationSlot.findMany({ where: { character_id: player.id, preset }, orderBy: { slot_position: 'asc' } }); }).then((attack) => this.emitTo(socketId, 'rotation.state', { preset, attack, cooldowns: { attackGroupReadyAt: this.attackGroupReadyAt.get(player.id) ?? 0, healingGroupReadyAt: this.healingGroupReadyAt.get(player.id) ?? 0, abilityReadyAt: Object.fromEntries(this.abilityCooldowns.get(player.id) ?? []) } })).catch((error) => this.emitTo(socketId, 'error', { message: `Falha ao salvar rotação: ${error instanceof Error ? error.message : String(error)}` }));
  }

  handleHealingRotation(socketId: string, preset: string, slots: { position: number; abilityId?: number; enabled: boolean; trigger: { hpBelowPercent: number } }[]) {
    const player = this.playerForSocket(socketId); if (!player || !['HUNT', 'BOSS', 'HELPER'].includes(preset)) return;
    const ordered = slots.sort((a, b) => a.position - b.position);
    this.healingRotations.set(player.id, ordered.map((slot) => ({ abilityId: slot.abilityId, enabled: slot.enabled, hpBelowPercent: slot.trigger.hpBelowPercent })));
    this.schedulePlayerHealCheck(player, Date.now());
    if (this.prisma) void this.prisma.$transaction(async (tx) => { await tx.characterHealingRotationSlot.deleteMany({ where: { character_id: player.id, preset } }); await tx.characterHealingRotationSlot.createMany({ data: ordered.map((slot) => ({ character_id: player.id, preset, slot_position: slot.position, ability_id: slot.abilityId ?? null, enabled: slot.enabled, trigger: slot.trigger })) }); return tx.characterHealingRotationSlot.findMany({ where: { character_id: player.id, preset }, orderBy: { slot_position: 'asc' } }); }).then((healing) => this.emitTo(socketId, 'rotation.state', { preset, healing, cooldowns: { attackGroupReadyAt: this.attackGroupReadyAt.get(player.id) ?? 0, healingGroupReadyAt: this.healingGroupReadyAt.get(player.id) ?? 0, abilityReadyAt: Object.fromEntries(this.abilityCooldowns.get(player.id) ?? []) } })).catch((error) => this.emitTo(socketId, 'error', { message: `Falha ao salvar cura: ${error instanceof Error ? error.message : String(error)}` }));
  }

  handleAttack(socketId: string, targetId: string) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    player.targetId = targetId;
    this.schedulePlayerAttackCheck(player, Date.now());
  }

  handleWeaponElementOverride(socketId: string, damageType: DamageType) {
    const player = this.playerForSocket(socketId);
    if (!player || !WEAPON_ELEMENT_OVERRIDE_CONFIG.enabled) return;
    const validTypes: DamageType[] = ['physical', 'fire', 'ice', 'energy', 'earth', 'holy', 'death', 'arcane'];
    if (!validTypes.includes(damageType)) return;
    const now = Date.now();
    const equipped = Boolean(player.equipment.weapon);
    player.weaponElementOverride = {
      damageType,
      appliedAt: now,
      expiresAt: equipped ? now + WEAPON_ELEMENT_OVERRIDE_CONFIG.defaultDurationMs : now,
      paused: !equipped,
      remainingMs: equipped ? WEAPON_ELEMENT_OVERRIDE_CONFIG.defaultDurationMs : WEAPON_ELEMENT_OVERRIDE_CONFIG.defaultDurationMs,
    };
    void this.store.saveWeaponElementOverride(player.id, player.weaponElementOverride);
    this.emitTo(socketId, 'combat.weaponElementOverride.applied', { override: player.weaponElementOverride });
  }

  handleWeaponElementOverrideRemove(socketId: string) {
    const player = this.playerForSocket(socketId);
    if (!player || !player.weaponElementOverride) return;
    player.weaponElementOverride = undefined;
    void this.store.clearWeaponElementOverride(player.id);
    this.emitTo(socketId, 'combat.weaponElementOverride.removed', { reason: 'manual' });
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
    this.groundItemEventReadyAt.delete(entityId);
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
    if (slot === 'weapon') this.resumeWeaponElementOverride(player);
    player.recomputeSpeed(getItemDef);
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
    if (slot === 'weapon') this.pauseWeaponElementOverride(player);
    player.equipment[slot as keyof CharacterEquipment] = undefined;
    player.inventory[idx] = { itemId: stack.itemId, quantity: 1 };
    player.recomputeSpeed(getItemDef);
    this.emitInventory(player);
    this.emitStats(player);
  }

  private pauseWeaponElementOverride(player: GamePlayer) {
    const override = player.weaponElementOverride;
    if (!override || override.paused) return;
    override.remainingMs = Math.max(0, override.expiresAt - Date.now());
    override.paused = true;
    override.expiresAt = Date.now();
    void this.store.saveWeaponElementOverride(player.id, override);
  }

  private resumeWeaponElementOverride(player: GamePlayer) {
    const override = player.weaponElementOverride;
    if (!override || !override.paused || (override.remainingMs ?? 0) <= 0) return;
    override.paused = false;
    override.expiresAt = Date.now() + (override.remainingMs ?? 0);
    void this.store.saveWeaponElementOverride(player.id, override);
  }

  handleExpandLootPouch(socketId: string) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    if (player.lootPouchSize >= LOOT_POUCH_EXPANSION.maxSize) {
      this.emitTo(socketId, 'error', { message: 'A Bolsa de Loot já está no tamanho máximo.' });
      return false;
    }
    const cost = LOOT_POUCH_EXPANSION.goldCost(player.lootPouchSize);
    if (player.gold < cost) {
      this.emitTo(socketId, 'error', { message: `Gold insuficiente para expandir a Bolsa de Loot (${cost} gold).` });
      return false;
    }
    const nextSize = Math.min(LOOT_POUCH_EXPANSION.maxSize, player.lootPouchSize + LOOT_POUCH_EXPANSION.slotsPerUpgrade);
    player.gold -= cost;
    player.lootPouchSize = nextSize;
    while (player.lootPouch.length < nextSize) player.lootPouch.push(null);
    this.emitTo(socketId, 'gold.update', { gold: player.gold });
    this.emitInventory(player);
    this.emitTo(socketId, 'chat.message', {
      channel: 'local',
      from: 'Sistema',
      text: `Bolsa de Loot expandida para ${nextSize} slots por ${cost} gold.`,
    });
  }

  handleSellLootPouch(socketId: string) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    let total = 0;
    let sold = 0;
    player.lootPouch = player.lootPouch.map((stack) => {
      if (!stack) return null;
      const def = getItemDef(stack.itemId);
      const unitValue = this.lootSellValue(def, stack.itemId);
      total += unitValue * stack.quantity;
      sold += stack.quantity;
      return null;
    });
    if (sold <= 0) {
      this.emitTo(socketId, 'chat.message', { channel: 'local', from: 'Sistema', text: 'Bolsa de Loot vazia.' });
      return false;
    }
    player.gold += total;
    this.emitTo(socketId, 'gold.update', { gold: player.gold });
    this.emitInventory(player);
    this.emitTo(socketId, 'chat.message', {
      channel: 'local',
      from: 'Sistema',
      text: `Loot vendido: ${sold} item(ns) por ${total} gold.`,
    });
  }

  private lootSellValue(def: ItemDefinition | undefined, itemId: string): number {
    void itemId;
    return Math.max(0, def?.sellValue ?? 0);
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
      speed: 'speed' in c ? c.speed : undefined,
      movementSpeed: 'moveIntervalMs' in c ? c.moveIntervalMs : undefined,
      appearance: c.appearance
        ? { ...c.appearance }
        : this.defaultPlayerAppearance(),
      combat: c.combat ? { ...c.combat } : undefined,
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

  private addToLootPouch(player: GamePlayer, itemId: string, quantity: number): boolean {
    this.ensureLootPouchCapacity(player);
    return this.addToContainer(player.lootPouch, itemId, quantity);
  }

  private addToContainer(container: (ItemStack | null)[], itemId: string, quantity: number): boolean {
    const def = getItemDef(itemId);
    const existing = container.find((s) => s && s.itemId === itemId);
    if (existing && (def?.stackable ?? true)) {
      existing.quantity += quantity;
      return true;
    }
    const idx = container.findIndex((s) => s === null);
    if (idx === -1) return false;
    container[idx] = { itemId, quantity };
    return true;
  }

  private ensureLootPouchCapacity(player: GamePlayer) {
    player.lootPouchSize = Math.max(LOOT_POUCH_SIZE, player.lootPouchSize, player.lootPouch.length);
    while (player.lootPouch.length < player.lootPouchSize) player.lootPouch.push(null);
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
      speed: player.speed,
      movementSpeed: player.moveIntervalMs,
      skillProgress: player.skillProgress.map((progress) => ({ ...progress })),
    });
  }

  private emitInventory(player: GamePlayer) {
    this.ensureLootPouchCapacity(player);
    const inventory: CharacterInventory = {
      slots: player.inventory.map((s) => (s ? { ...s } : null)),
      lootPouchSize: player.lootPouchSize,
      lootPouch: player.lootPouch.map((s) => (s ? { ...s } : null)),
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
      speed: 0,
      resistances: emptyResistances(),
      damageAffinities: target.definition.damageAffinities,
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

  private emitHeal(sourceId: string, target: GamePlayer, amount: number, critical = false) {
    this.emitCombatEvent(target, 'combat.heal', {
      sourceId,
      targetId: target.id,
      amount,
      critical,
      targetHealth: target.health,
    });
  }

  private dealAbilityDamage(attacker: GamePlayer, target: GamePlayer | CreatureEntity, ability: import('@aetheria/types').CombatAbilityDefinition, now: number): boolean {
    const stats = this.combatStats(attacker);
    const weapon = attacker.equipment.weapon ? getWeaponDefinition(getItemDef(attacker.equipment.weapon.itemId)) : undefined;
    const ammo = attacker.equipment.ammo ? getAmmoDefinition(getItemDef(attacker.equipment.ammo.itemId)) : undefined;
    const sourcePower = ability.powerSource === 'weapon_ammo' ? (weapon?.attackPower ?? 0) + (ammo?.attackPower ?? 0) : ability.powerSource === 'weapon' ? (weapon?.attackPower ?? 0) : ability.powerSource === 'magic_weapon' ? (weapon?.magicPower ?? 0) : ability.defaultParameters?.power ?? 20;
    const skill = attacker.archetype === 'mage' ? stats.magicLevel : attacker.archetype === 'archer' ? stats.distanceSkill : stats.meleeSkill;
    const raw = calculateRawDamage({ basePower: sourcePower, flatPower: ability.defaultParameters?.flatPower, skill: attacker.archetype === 'mage' ? 'magic' : attacker.archetype === 'archer' ? 'distance' : 'melee', skillLevel: skill, level: stats.level, abilityMultiplier: ability.defaultParameters?.powerMultiplier ?? 1, variance: rollVariance(() => this.nextCombatRandom(attacker, now)) });
    const critical = rollCritical(stats.criticalChance, () => this.nextCombatRandom(attacker, now + 1));
    const damage = calculateMitigatedDamage({ damage: critical ? calculateCritical(raw, stats.criticalDamage) : raw, damageType: ability.damageType ?? 'physical', target: this.targetCombatStats(target), damageTakenModifier: resolveDamageAffinity(this.targetCombatStats(target).damageAffinities, ability.damageType ?? 'physical').modifier, immune: resolveDamageAffinity(this.targetCombatStats(target).damageAffinities, ability.damageType ?? 'physical').immune });
    target.health = Math.max(0, target.health - damage.finalDamage);
    this.emitCombatEvent(target, 'combat.damage', { attackerId: attacker.id, targetId: target.id, amount: damage.finalDamage, damageType: ability.damageType ?? 'physical', critical, targetHealth: target.health });
    this.emitCombatEvent(target, 'entity.health', { id: target.id, health: target.health, maxHealth: target.maxHealth });
    if (target.health <= 0 && target instanceof CreatureEntity) this.creatureKilled(attacker, target, now);
    return true;
  }

  private dealDamage(attacker: GamePlayer, target: GamePlayer | CreatureEntity, now: number): boolean {
    if (attacker.weaponElementOverride && now >= attacker.weaponElementOverride.expiresAt) {
      attacker.weaponElementOverride = undefined;
      void this.store.clearWeaponElementOverride(attacker.id);
      this.emitTo(attacker.socketId ?? '', 'combat.weaponElementOverride.removed', { reason: 'expired' });
    }
    const weaponItem = attacker.equipment.weapon ? getItemDef(attacker.equipment.weapon.itemId) : undefined;
    const ammoItem = attacker.equipment.ammo ? getItemDef(attacker.equipment.ammo.itemId) : undefined;
    const attack = calculateBasicAttack({
      archetype: attacker.archetype,
      attacker: this.combatStats(attacker),
      loadout: { weapon: getWeaponDefinition(weaponItem), ammo: getAmmoDefinition(ammoItem) },
      weaponElementOverride: attacker.weaponElementOverride,
      now,
      rng: () => this.nextCombatRandom(attacker, now),
    });
    if (!attack.valid) return false;
    const targetStats = this.targetCombatStats(target);
    const affinity = resolveDamageAffinity(targetStats.damageAffinities, attack.damageType);
    const damage = calculateMitigatedDamage({
      damage: attack.damageBeforeMitigation,
      damageType: attack.damageType,
      target: targetStats,
      immune: affinity.immune,
      damageTakenModifier: affinity.modifier,
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
      damageType: attack.damageType,
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

  private async creatureAttackWithAbility(creature: CreatureEntity, playerId: string, amount: number, critical: boolean, now: number) {
    const creatureId = creature.definition.creatureId;
    if (!creatureId || !this.prisma) { this.creatureAttackPlayer(creature, playerId, amount, critical, now); return; }
    let assignments = this.monsterAbilities.get(creatureId);
    if (!assignments) {
      const rows = await this.prisma.monsterAbilityAssignment.findMany({ where: { monster_id: creatureId, enabled: true }, orderBy: { priority: 'asc' } });
      assignments = rows.map((row) => ({ abilityId: row.ability_id, priority: row.priority, chance: row.chance, cooldownOverrideMs: row.cooldown_override_ms ?? undefined, parameters: (row.parameters as Record<string, number> | null) ?? undefined }));
      this.monsterAbilities.set(creatureId, assignments);
    }
    const ready = this.monsterAbilityReadyAt.get(creature.id) ?? new Map<number, number>();
    for (const assignment of assignments) {
      const ability = await this.abilityRegistry.get(assignment.abilityId);
      if (!ability || now < (ready.get(ability.abilityId) ?? 0)) continue;
      if (this.nextCombatRandomForId(creature.id, now) >= assignment.chance) continue;
      ready.set(ability.abilityId, now + (assignment.cooldownOverrideMs ?? ability.cooldownMs));
      this.monsterAbilityReadyAt.set(creature.id, ready);
      const power = assignment.parameters?.power ?? amount;
      this.creatureAttackPlayer(creature, playerId, power, critical, now, ability.damageType ?? 'physical');
      return;
    }
    this.creatureAttackPlayer(creature, playerId, amount, critical, now);
  }

  private nextCombatRandomForId(id: string, now: number): number {
    const x = Math.sin(now * 12.9898 + id.length * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  private creatureAttackPlayer(creature: CreatureEntity, playerId: string, amount: number, critical: boolean, now: number, damageType: DamageType = 'physical') {
    const player = this.players.get(playerId);
    if (!player) return;
    const damage = calculateMitigatedDamage({
      damage: amount,
      damageType,
       target: this.targetCombatStats(player),
    });
    const reduced = damage.finalDamage;
    player.health = Math.max(0, player.health - reduced);
    this.emitCombatEvent(player, 'combat.damage', {
      attackerId: creature.id,
      targetId: player.id,
      amount: reduced,
       damageType,
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

  private schedulePlayerCombat(playerId: string, type: 'attack' | 'heal', readyAt: number) {
    const key = `${playerId}:${type}`;
    const normalizedReadyAt = Math.max(0, Math.round(readyAt));
    if ((this.combatEventReadyAt.get(key) ?? -1) <= normalizedReadyAt && this.combatEventReadyAt.has(key)) return;
    this.combatEventReadyAt.set(key, normalizedReadyAt);
    this.combatEvents.push({ key, playerId, type, readyAt: normalizedReadyAt });
  }

  private schedulePlayerAttackCheck(player: GamePlayer, now: number) {
    const run = this.hunts.getRun(player.id);
    if (!run && !player.targetId) return;
    if (run && !player.targetId) {
      this.schedulePlayerCombat(player.id, 'attack', now + 250);
      return;
    }
    const magicReadyAt = this.attackGroupReadyAt.get(player.id) ?? now;
    const basicReadyAt = player.attackCooldownUntil || now;
    this.schedulePlayerCombat(player.id, 'attack', Math.min(magicReadyAt, basicReadyAt));
  }

  private schedulePlayerHealCheck(player: GamePlayer, now: number) {
    if ((this.healingRotations.get(player.id) ?? []).length === 0) return;
    this.schedulePlayerCombat(player.id, 'heal', this.healingGroupReadyAt.get(player.id) ?? now);
  }

  private async processCombatEvents(now: number) {
    if (this.processingCombatEvents) return;
    this.processingCombatEvents = true;
    try {
    if (this.combatEvents.size === 0) return;
    let processed = 0;
    while (this.combatEvents.peek() && this.combatEvents.peek()!.readyAt <= now && processed < 10_000) {
      const event = this.combatEvents.pop()!;
      if (this.combatEventReadyAt.get(event.key) !== event.readyAt) continue;
      this.combatEventReadyAt.delete(event.key);
      const player = this.players.get(event.playerId);
      if (!player?.socketId) continue;
      if (event.type === 'heal') {
        await this.processPlayerHealing(player, now);
        this.schedulePlayerHealCheck(player, Date.now());
      } else {
        await this.processPlayerAttack(player, now);
        this.schedulePlayerAttackCheck(player, Date.now());
      }
      processed++;
    }
    } finally {
      this.processingCombatEvents = false;
    }
  }

  private scheduleHuntUpdate(characterId: string, readyAt: number) {
    const normalizedReadyAt = Math.max(0, Math.round(readyAt));
    if ((this.huntEventReadyAt.get(characterId) ?? -1) <= normalizedReadyAt && this.huntEventReadyAt.has(characterId)) return;
    this.huntEventReadyAt.set(characterId, normalizedReadyAt);
    this.huntEvents.push({ characterId, readyAt: normalizedReadyAt });
  }

  private processHuntEvents(now: number) {
    if (this.processingHuntEvents) return;
    this.processingHuntEvents = true;
    try {
      if (this.huntEvents.size === 0) return;
      let processed = 0;
      while (this.huntEvents.peek() && this.huntEvents.peek()!.readyAt <= now && processed < 10_000) {
        const event = this.huntEvents.pop()!;
        if (this.huntEventReadyAt.get(event.characterId) !== event.readyAt) continue;
        this.huntEventReadyAt.delete(event.characterId);
        if (!this.hunts.hasRun(event.characterId)) continue;
        const player = this.players.get(event.characterId);
        if (player?.socketId) this.processPlayerCombatAI(player, now);
        this.hunts.updateRun(event.characterId, now);
        if (player?.socketId) this.schedulePlayerAttackCheck(player, now);
        if (this.hunts.hasRun(event.characterId)) this.scheduleHuntUpdate(event.characterId, this.hunts.nextUpdateAt(event.characterId, now));
        processed++;
      }
    } finally {
      this.processingHuntEvents = false;
    }
  }

  private schedulePlayerRegen(playerId: string, readyAt: number) {
    const normalizedReadyAt = Math.max(0, Math.round(readyAt));
    if ((this.regenEventReadyAt.get(playerId) ?? -1) <= normalizedReadyAt && this.regenEventReadyAt.has(playerId)) return;
    this.regenEventReadyAt.set(playerId, normalizedReadyAt);
    this.regenEvents.push({ playerId, readyAt: normalizedReadyAt });
  }

  private processRegenEvents(now: number) {
    let processed = 0;
    while (this.regenEvents.peek() && this.regenEvents.peek()!.readyAt <= now && processed < 10_000) {
      const event = this.regenEvents.pop()!;
      if (this.regenEventReadyAt.get(event.playerId) !== event.readyAt) continue;
      this.regenEventReadyAt.delete(event.playerId);
      const player = this.players.get(event.playerId);
      if (!player?.socketId) continue;
      this.regeneratePlayer(player, now);
      this.schedulePlayerRegen(player.id, now + 1000);
      processed++;
    }
  }

  private schedulePlayerMove(player: GamePlayer, readyAt: number) {
    if (!player.moveDir || this.hunts.getRun(player.id)) return;
    const normalizedReadyAt = Math.max(0, Math.round(readyAt));
    if ((this.moveEventReadyAt.get(player.id) ?? -1) <= normalizedReadyAt && this.moveEventReadyAt.has(player.id)) return;
    this.moveEventReadyAt.set(player.id, normalizedReadyAt);
    this.moveEvents.push({ playerId: player.id, readyAt: normalizedReadyAt });
  }

  private processMoveEvents(now: number) {
    let processed = 0;
    while (this.moveEvents.peek() && this.moveEvents.peek()!.readyAt <= now && processed < 10_000) {
      const event = this.moveEvents.pop()!;
      if (this.moveEventReadyAt.get(event.playerId) !== event.readyAt) continue;
      this.moveEventReadyAt.delete(event.playerId);
      const player = this.players.get(event.playerId);
      if (!player?.socketId || !player.moveDir) continue;
      this.processPlayerMove(player, now);
      this.schedulePlayerMove(player, player.nextMoveAt);
      processed++;
    }
  }

  private scheduleGroundItem(item: GroundItem) {
    if ((this.groundItemEventReadyAt.get(item.id) ?? -1) <= item.expiresAt && this.groundItemEventReadyAt.has(item.id)) return;
    this.groundItemEventReadyAt.set(item.id, item.expiresAt);
    this.groundItemEvents.push({ itemId: item.id, readyAt: item.expiresAt });
  }

  private processGroundItemEvents(now: number) {
    let processed = 0;
    while (this.groundItemEvents.peek() && this.groundItemEvents.peek()!.readyAt <= now && processed < 10_000) {
      const event = this.groundItemEvents.pop()!;
      if (this.groundItemEventReadyAt.get(event.itemId) !== event.readyAt) continue;
      this.groundItemEventReadyAt.delete(event.itemId);
      const item = this.groundItems.get(event.itemId);
      if (!item || item.expiresAt > now) continue;
      this.groundItems.delete(event.itemId);
      this.emitAll('loot.removed', { entityId: event.itemId });
      processed++;
    }
  }

  private schedulePlayerSave(playerId: string, readyAt: number) {
    const normalizedReadyAt = Math.max(0, Math.round(readyAt));
    if ((this.saveEventReadyAt.get(playerId) ?? -1) <= normalizedReadyAt && this.saveEventReadyAt.has(playerId)) return;
    this.saveEventReadyAt.set(playerId, normalizedReadyAt);
    this.saveEvents.push({ playerId, readyAt: normalizedReadyAt });
  }

  private processSaveEvents(now: number) {
    let processed = 0;
    while (this.saveEvents.peek() && this.saveEvents.peek()!.readyAt <= now && processed < 10_000) {
      const event = this.saveEvents.pop()!;
      if (this.saveEventReadyAt.get(event.playerId) !== event.readyAt) continue;
      this.saveEventReadyAt.delete(event.playerId);
      const player = this.players.get(event.playerId);
      if (!player?.socketId) continue;
      void this.persistPlayer(player).finally(() => { if (this.players.has(player.id)) this.schedulePlayerSave(player.id, Date.now() + 10_000); });
      processed++;
    }
  }

  private tick(now: number) {
    try {
      this.processMoveEvents(now);
      this.processRegenEvents(now);
      void this.processCombatEvents(now);
      this.processHuntEvents(now);
      this.processGroundItemEvents(now);
      this.processSaveEvents(now);
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
      player.nextMoveAt = now + player.moveIntervalMs;
      this.emitTo(player.socketId ?? '', 'player.moved', { position: { ...player.position } });
      this.emitOthers(player.socketId ?? '', 'entity.moved', { id: player.id, position: { ...player.position } });
    } else {
      player.nextMoveAt = now + 100;
    }
  }

  private processPlayerCombatAI(player: GamePlayer, now: number) {
    const run = this.hunts.getRun(player.id);
    if (!run || run.status !== 'active') {
      this.playerAI.clear(player.id);
      return;
    }
    const weaponItem = player.equipment.weapon ? getItemDef(player.equipment.weapon.itemId) : undefined;
    const attackRange = getWeaponDefinition(weaponItem)?.range ?? 1;
    if (this.playerAI.update(player, run, now, attackRange)) {
      this.emitTo(player.socketId ?? '', 'player.moved', { position: { ...player.position }, facing: player.facing });
    }
  }

  private async processPlayerHealing(player: GamePlayer, now: number) {
    if (now < (this.healingGroupReadyAt.get(player.id) ?? 0)) return;
    const hpPercent = player.maxHealth > 0 ? (player.health / player.maxHealth) * 100 : 100;
    for (const slot of this.healingRotations.get(player.id) ?? []) {
      if (!slot.enabled || slot.abilityId === undefined || hpPercent > slot.hpBelowPercent) continue;
      const ability = await this.abilityRegistry.get(slot.abilityId);
      const readyAt = this.abilityCooldowns.get(player.id)?.get(slot.abilityId) ?? 0;
      if (!ability || ability.category !== 'heal' || now < readyAt) continue;
      if (await this.handleAbilityCast(player.socketId ?? '', ability.abilityId, player.id)) return;
    }
  }

  private async processPlayerAttack(player: GamePlayer, now: number) {
    const run = this.hunts.getRun(player.id);
    if (run) {
      player.targetId = this.playerAI.selectTarget(run.creatures.getAll(), player)?.id ?? null;
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
    const groupReadyAt = this.attackGroupReadyAt.get(player.id) ?? 0;
    if (now >= groupReadyAt) {
      const rotation = this.attackRotations.get(player.id) ?? [];
      for (const slot of rotation) {
        if (!slot.enabled || slot.abilityId === undefined || (slot.minTargets ?? 0) > 1) continue;
        const ability = await this.abilityRegistry.get(slot.abilityId);
        const readyAt = this.abilityCooldowns.get(player.id)?.get(slot.abilityId) ?? 0;
        if (!ability || ability.category === 'heal' || now < readyAt || tileDistance(player.position, target.position) > ability.rangeTiles) continue;
        if (await this.handleAbilityCast(player.socketId ?? '', ability.abilityId, target.id)) return;
      }
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
    this.spawnLoot(creature, player, run);
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
      player.recomputeSpeed(getItemDef);
      player.health = player.maxHealth;
      player.mana = player.maxMana;
      this.emitTo(player.socketId ?? '', 'chat.message', { channel: 'local', from: 'Sistema', text: `Você subiu para o nível ${player.level}!` });
    }
    this.emitStats(player);
  }

  private spawnLoot(creature: CreatureEntity, player?: GamePlayer, run?: HuntRun | null) {
    const collected: string[] = [];
    let blocked = false;
    for (const entry of creature.definition.loot) {
      if (Math.random() * 100 >= entry.chance) continue;
      const def = getItemDef(entry.itemId);
      const quantity = entry.minQuantity + Math.floor(Math.random() * (entry.maxQuantity - entry.minQuantity + 1));
      if (player) {
        if (this.addToLootPouch(player, entry.itemId, quantity)) {
          collected.push(`${quantity}x ${def?.name ?? entry.itemId}`);
        } else {
          blocked = true;
        }
        continue;
      }
      const item: GroundItem = {
        id: uid('loot'),
        itemId: entry.itemId,
        name: def?.name ?? entry.itemId,
        quantity,
        position: { ...creature.position },
        expiresAt: Date.now() + LOOT_LIFETIME_MS,
      };
      this.groundItems.set(item.id, item);
      this.scheduleGroundItem(item);
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
    if (player && (collected.length > 0 || blocked)) {
      this.emitInventory(player);
      if (collected.length > 0) {
        this.emitTo(player.socketId ?? '', 'chat.message', {
          channel: 'local',
          from: 'Sistema',
          text: `Loot coletado: ${collected.join(', ')}.`,
        });
      }
      if (blocked) {
        this.emitTo(player.socketId ?? '', 'chat.message', {
          channel: 'local',
          from: 'Sistema',
          text: 'Bolsa de Loot cheia. Alguns itens não foram coletados.',
        });
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

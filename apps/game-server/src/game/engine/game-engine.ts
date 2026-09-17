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
  MAX_CHARACTERS_PER_ACCOUNT,
  NPC_INTERACT_RANGE,
  NPC_TEMPLATES,
  PARTY_CONFIG,
  PICKUP_RANGE,
  PLAYER_AI,
  SPAWN_POINT,
  TICK_MS,
  VIEW_DISTANCE_X,
  VIEW_DISTANCE_Y,
  WEAPON_ELEMENT_OVERRIDE_CONFIG,
  xpForLevel,
} from '@aetheria/config';
import { DIRECTION_DELTAS, randomIntInRange, samePosition, tileDistance, tileKey, uid } from '@aetheria/shared';
import type {
  CharacterEquipment,
  CharacterInventory,
  CharacterSkills,
  CharacterSummary,
  CombatAbilityDefinition,
  CombatArchetype,
  DamageType,
  CombatSkill,
  Direction,
  ItemDefinition,
  ItemImpactVisual,
  ItemStack,
  ItemVisualEffects,
  PlayerAppearance,
  PlayerCombatConfig,
  Position,
  ResolvedMonsterSpell,
} from '@aetheria/types';
import { getItemDef, loadItemCatalogFromDatabase } from './item-catalog';
import { generateWorldMap } from './world-map';
import { AccountStorageState, GamePlayer, GroundItem, NpcEntity } from './world';
import { STORE, Store, StoredCharacter } from '../store/store';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatureAIHooks, CreatureAIService, CreatureTarget } from '../creature/creature-ai.service';
import { PlayerCombatAIService } from '../combat/player-combat-ai';
import { CreatureDataService } from '../creature/creature-data.service';
import { CreatureEntity } from '../creature/creature.entity';
import { CreatureManager } from '../creature/creature-manager.service';
import { GameLoop } from '../creature/game-loop';
import { MovementService } from '../creature/movement.service';
import { OccupancyGrid } from '../creature/occupancy-grid';
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
import { splitPartyExperience } from '../combat/party-xp';
import { AbilityRegistry } from '../combat/ability-registry';
import { getEffectType, getEffectTypeBySlug, getShootType, loadShootEffectCatalog } from '../combat/shoot-effect-registry';

export type EmitFn = (socketId: string, event: string, data: unknown) => void;

const BASE_SKILLS: CharacterSkills = {
  melee: BASE_PLAYER.skill,
  distance: BASE_PLAYER.skill,
  magic: BASE_PLAYER.skill,
};

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PROJECTILE_SPEED_PX_PER_SECOND = 520;
const POTION_COOLDOWN_MS = 1000;
const POTIONS: Record<string, { price: number; level: number; hp?: [number, number]; mp?: [number, number] }> = {
  'health-potion': { price: 50, level: 0, hp: [150, 200] },
  'strong-health-potion': { price: 115, level: 50, hp: [300, 300] },
  'great-health-potion': { price: 225, level: 80, hp: [500, 500] },
  'ultimate-health-potion': { price: 379, level: 130, hp: [750, 750] },
  'supreme-health-potion': { price: 650, level: 200, hp: [900, 900] },
  'mana-potion': { price: 56, level: 0, mp: [75, 125] },
  'strong-mana-potion': { price: 108, level: 50, mp: [115, 185] },
  'great-mana-potion': { price: 158, level: 80, mp: [150, 250] },
  'superior-mana-potion': { price: 254, level: 100, mp: [240, 360] },
  'ultimate-mana-potion': { price: 488, level: 130, mp: [425, 575] },
  'distilled-superior-mana-potion': { price: 381, level: 130, mp: [240, 360] },
  'distilled-ultimate-mana-potion': { price: 732, level: 200, mp: [425, 575] },
  'great-spirit-potion': { price: 254, level: 80, hp: [300, 300], mp: [100, 200] },
  'ultimate-spirit-potion': { price: 488, level: 130, hp: [500, 500], mp: [150, 250] },
};

@Injectable()
export class GameEngine implements OnModuleDestroy {
  private readonly logger = new Logger(GameEngine.name);

  private emitFn: EmitFn = () => {};
  private world = generateWorldMap();
  private players = new Map<string, GamePlayer>();
  private playerBySocket = new Map<string, string>();
  private accountStorage = new Map<string, AccountStorageState>();
  private inventoryMutationLocks = new Map<string, Promise<void>>();
  private recentInventoryErrors = new Map<string, number>();
  private npcs = new Map<string, NpcEntity>();
  private groundItems = new Map<string, GroundItem>();
  private tokens = new Map<string, { accountId: string; username: string; exp: number }>();
  private lastSaveAt = Date.now();

  private movement: MovementService;
  private occupancy = new OccupancyGrid();
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
  private healingRotations = new Map<string, { position: number; abilityId?: number; potionId?: string; enabled: boolean; hpBelowPercent: number; mpBelowPercent: number; target: 'self' | 'lowest_party_member' | 'specific_party_role' }[]>();
  private healingGroupReadyAt = new Map<string, number>();
  private potionReadyAt = new Map<string, number>();
  private monsterAbilities = new Map<number, ResolvedMonsterSpell[]>();
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
    this.movement = new MovementService(
      this.world,
      (position, exceptIds) => this.occupancy.isOccupied(position, exceptIds),
      this.occupancy,
    );
    this.creatures = new CreatureManager(this.movement);
    const hooks: CreatureAIHooks = {
      movement: this.movement,
      getPlayers: () => this.playerSnapshots(),
      getPlayerById: (id) => this.playerSnapshot(id),
      broadcast: (event, data) => this.emitAll(event, data),
      onAttackPlayer: (creature, target, amount, critical, now) => {
        this.creatureAttackWithAbility(creature, target.id, amount, critical, now);
      },
      getCreatureAttackRange: (creature) => this.creatureAttackRange(creature),
    };
    this.ai = new CreatureAIService(hooks);
    this.loop = new GameLoop(TICK_MS, (_delta, now) => this.tick(now));
    this.hunts = new HuntEngine({
      getPlayer: (id) => this.players.get(id) ?? null,
      playerSnapshot: (id) => this.playerSnapshot(id),
      summarize: (player) => this.toSummary(player),
      getCreatureDefinition: (id) => this.creatureDefinitions.get(id) ?? null,
      getMap: (id) => mapRegistry?.getMap(id) ?? null,
      getMapRender: (id) => mapRegistry?.getMapRender(id) ?? null,
      getHunts: () => huntRegistry?.getAll() ?? HUNT_CATALOG,
      emitTo: (socketId, event, data) => this.emitTo(socketId, event, data),
      getGold: (characterId) => {
        const p = this.players.get(characterId);
        return p ? this.accountGold(p.accountId) : 0;
      },
      deductGold: (characterId, amount) => {
        const p = this.players.get(characterId);
        if (!p) return 0;
        const storage = this.storageFor(p);
        storage.gold = Math.max(0, storage.gold - amount);
        this.emitGold(p, storage.gold);
        return storage.gold;
      },
      onCreatureAttackPlayer: (creature, playerId, amount, critical, now) =>
        this.creatureAttackWithAbility(creature, playerId, amount, critical, now),
      getCreatureAttackRange: (creature) => this.creatureAttackRange(creature),
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
    await loadShootEffectCatalog(this.prisma);
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
    await this.preloadMonsterAbilities();
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

  /** Pré-carrega as magias atribuídas às criaturas (mapa creatureId → spells). */
  private async preloadMonsterAbilities() {
    if (!this.prisma) {
      this.monsterAbilities.clear();
      return;
    }
    try {
      await this.abilityRegistry.reload();
      const rows = await this.prisma.monsterAbilityAssignment.findMany({
        where: { enabled: true },
        orderBy: [{ monster_id: 'asc' }, { priority: 'asc' }],
      });
      const grouped = new Map<number, ResolvedMonsterSpell[]>();
      for (const row of rows) {
        const ability = await this.abilityRegistry.get(row.ability_id);
        if (!ability) continue;
        const list = grouped.get(row.monster_id) ?? [];
        list.push({
          ability,
          priority: row.priority,
          chance: row.chance,
          cooldownOverrideMs: row.cooldown_override_ms ?? undefined,
          parameters: (row.parameters as Record<string, number> | null) ?? undefined,
        });
        grouped.set(row.monster_id, list);
      }
      this.monsterAbilities = grouped;
    } catch (err) {
      this.logger.warn(`Falha ao carregar magias de criatura: ${(err as Error).message}`);
      this.monsterAbilities.clear();
    }
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
    await this.ensureAccountStorage(account.id);
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
    if (existing.length >= MAX_CHARACTERS_PER_ACCOUNT) {
      this.emitTo(socketId, 'auth.characterCreated', { ok: false, error: `Máximo de ${MAX_CHARACTERS_PER_ACCOUNT} personagens por conta.` });
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
    await this.ensureAccountStorage(session.accountId);
    const character = await this.store.createCharacter(session.accountId, {
      name: trimmed,
      archetype: archetypeId,
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

    const reconnecting = this.players.get(characterId);
    if (reconnecting && reconnecting.accountId === session.accountId) {
      reconnecting.socketId = socketId;
      this.playerBySocket.set(socketId, reconnecting.id);
      await this.emitWorldSnapshot(reconnecting);
      this.logger.log(`Jogador ${reconnecting.name} reconectou (retomando estado).`);
      return;
    }

    if (!stored.appearance) {
      stored.appearance = this.defaultPlayerAppearance();
      await this.store.saveCharacter(stored);
    }

    await this.ensureAccountStorage(stored.accountId);
    const player = new GamePlayer(stored);
    player.socketId = socketId;
    player.recomputeSpeed(getItemDef);
    player.recomputeVitals(getItemDef);
    this.players.set(player.id, player);
    this.playerBySocket.set(socketId, player.id);
    this.movement.occupy(player.position, player.id);
    if (this.prisma) {
      const slots = await this.prisma.characterAttackRotationSlot.findMany({ where: { character_id: player.id, preset: 'HUNT' }, orderBy: { slot_position: 'asc' } });
      this.attackRotations.set(player.id, slots.map((slot) => ({ abilityId: slot.ability_id ?? undefined, enabled: slot.enabled, minTargets: slot.min_targets ?? undefined })));
      const heals = await this.prisma.characterHealingRotationSlot.findMany({ where: { character_id: player.id, preset: 'HUNT' }, orderBy: { slot_position: 'asc' } });
      this.healingRotations.set(player.id, heals.filter((slot) => slot.slot_position >= 1 && slot.slot_position <= 3).map((slot) => this.healingSlot(slot.slot_position, slot.ability_id ?? undefined, slot.enabled, slot.trigger, 100)));
      this.emitTo(socketId, 'rotation.state', { preset: 'HUNT', characterId: player.id, attack: slots, healing: heals, cooldowns: { attackGroupReadyAt: 0, healingGroupReadyAt: 0, abilityReadyAt: {} } });
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
    await this.emitPartyState(player);

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

  /** Reenvia o estado completo do mundo para um personagem que reconectou. */
  private async emitWorldSnapshot(player: GamePlayer) {
    const socketId = player.socketId ?? '';
    const run = this.hunts.getRun(player.id);
    this.emitTo(socketId, 'auth.selectResult', { ok: true });
    this.emitTo(socketId, 'abilities.update', { abilities: await this.abilityRegistry.list() });
    if (run) {
      const members = run.memberIds
        .map((id) => this.players.get(id))
        .filter((p): p is GamePlayer => !!p)
        .map((p) => this.toSummary(p));
      this.emitTo(socketId, 'game.enterArena', {
        character: this.toSummary(player),
        members,
        map: run.map.tiles,
        width: run.arena.width,
        height: run.arena.height,
        hunt: this.hunts.view(run),
      });
      for (const creature of run.creatures.getAll()) {
        if (creature.state === 'DEAD') continue;
        this.emitTo(socketId, 'creature.spawn', this.creatureSpawnPayload(creature));
      }
    } else {
      this.emitTo(socketId, 'game.enterWorld', {
        character: this.toSummary(player),
        map: this.world.tiles,
        width: this.world.width,
        height: this.world.height,
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
    }
    this.emitStats(player);
    this.emitInventory(player);
    await this.emitPartyState(player);
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
    const storage = this.storageFor(player);
    const companionIds = (storage.party ?? []).filter((id) => id !== player.id);
    for (const id of companionIds) {
      if (this.players.has(id)) continue;
      const stored = await this.store.findCharacterById(id);
      if (stored && stored.accountId === player.accountId) this.materializeCompanion(stored);
    }
    const memberIds = [player.id, ...companionIds.filter((id) => this.players.has(id))];
    for (const id of memberIds) this.movement.releaseEntity(id);
    const result = this.hunts.startHunt(player.id, memberIds, huntId, loopEnabled, Date.now());
    if (!result.ok) {
      this.emitTo(socketId, 'error', { message: this.huntErrorLabel(result.error) });
      return;
    }
    for (const id of result.run.memberIds) this.emitOthers(socketId, 'entity.removed', { id });
    for (const id of result.run.memberIds) {
      const member = this.players.get(id);
      if (!member) continue;
      member.moveDir = null;
      this.moveEventReadyAt.delete(id);
      this.schedulePlayerAttackCheck(member, Date.now());
      this.schedulePlayerHealCheck(member, Date.now());
    }
    this.scheduleHuntUpdate(player.id, Date.now());
    this.logger.log(`Jogador ${player.name} entrou na hunt ${huntId} com ${memberIds.length} membro(s).`);
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

  handleHuntSetFavorite(socketId: string, token: string, huntId: string, favorite: boolean) {
    void this.verifySession(socketId, token).then(async (session) => {
      if (!session) return;
      const hunt = this.hunts.findHunt(huntId);
      if (!hunt) return;
      await this.store.setHuntFavorite(session.player.id, huntId, favorite);
      this.emitTo(socketId, 'hunt.favoriteChanged', { huntId, favorite });
    });
  }

  async handleAppearanceList(socketId: string, token: string, characterId?: string) {
    const session = await this.verifySession(socketId, token);
    if (!session) return;
    const targetId = characterId && characterId !== session.player.id && this.partyMemberIds(session.player).includes(characterId) ? characterId : session.player.id;
    const outfits = await this.availableOutfits(targetId);
    this.emitTo(socketId, 'appearance.list', { outfits });
  }

  async handleAppearanceSave(socketId: string, token: string, outfitId: number, addonMask: number, colors: { head: number; primary: number; secondary: number; detail: number }, characterId?: string) {
    const session = await this.verifySession(socketId, token);
    if (!session) return;
    const leader = session.player;
    const targetId = characterId ?? leader.id;
    const outfits = await this.availableOutfits(targetId);
    const target = outfits.find((o) => o.outfitId === outfitId);
    if (!target) {
      this.emitTo(socketId, 'error', { message: 'Outfit não disponível para este personagem.' });
      return;
    }
    const appearance = { outfitId, addonMask: target.supportsAddons ? (addonMask & 3) : 0, colors };
    const live = this.players.get(targetId);
    if (live && live.accountId !== leader.accountId) return;
    if (live) {
      live.appearance = appearance;
      await this.persistPlayer(live);
    } else {
      const stored = await this.store.findCharacterById(targetId);
      if (!stored || stored.accountId !== leader.accountId) return;
      stored.appearance = appearance;
      await this.store.saveCharacter(stored);
    }
    const payload = { entityId: targetId, outfitId: appearance.outfitId, addonMask: appearance.addonMask, colors: appearance.colors };
    this.emitTo(socketId, 'appearance.changed', payload);
    this.emitOthers(socketId, 'appearance.changed', payload);
    await this.emitPartyState(leader);
    this.logger.log(`Aparência do personagem ${targetId} alterada para o outfit ${outfitId}.`);
  }

  handleCombatConfig(socketId: string, token: string, targeting: unknown, movement: unknown, attackRange?: number, characterId?: string) {
    void this.verifySession(socketId, token).then(async (session) => {
      if (!session) return;
      const leader = session.player;
      const t = targeting as PlayerCombatConfig['targeting'];
      const m = movement as PlayerCombatConfig['movement'];
      if (!['nearest', 'furthest', 'lowestHp', 'highestHp'].includes(t)) return;
      if (!['kite', 'hold', 'engage'].includes(m)) return;
      const range = attackRange == null ? undefined : Math.max(1, Math.min(15, Math.round(attackRange)));
      const combat: PlayerCombatConfig = { targeting: t, movement: m, attackRange: range };
      const targetId = characterId && characterId !== leader.id && this.partyMemberIds(leader).includes(characterId) ? characterId : leader.id;
      const live = this.players.get(targetId);
      if (live) {
        live.combat = { ...combat };
        this.playerAI.clear(live.id);
        await this.persistPlayer(live);
      } else {
        const stored = await this.store.findCharacterById(targetId);
        if (!stored || stored.accountId !== leader.accountId) return;
        stored.combat = { ...combat };
        await this.store.saveCharacter(stored);
      }
      this.emitTo(socketId, 'combat.config', { characterId: targetId, combat });
      await this.emitPartyState(leader);
    });
  }

  // ---------------------------------------------------------------- party

  private partyMemberIds(player: GamePlayer): string[] {
    const storage = this.storageFor(player);
    return [player.id, ...(storage.party ?? []).filter((id) => id !== player.id)];
  }

  private async emitPartyState(player: GamePlayer) {
    const storage = this.storageFor(player);
    const ids = [player.id, ...(storage.party ?? []).filter((id) => id !== player.id)];
    const members: (CharacterSummary & { equipment: CharacterEquipment })[] = [];
    for (const id of ids) {
      const member = this.players.get(id) ?? (await this.store.findCharacterById(id));
      if (member) {
        members.push({ ...this.toSummary(member), equipment: member.equipment });
        this.emitTo(player.socketId ?? '', 'stats.combat', this.combatStatsPayload(member));
      }
    }
    this.emitTo(player.socketId ?? '', 'party.state', {
      unlockedSlots: storage.unlockedPartySlots,
      maxSlots: PARTY_CONFIG.maxSlots,
      unlockCost: storage.unlockedPartySlots >= PARTY_CONFIG.maxSlots ? null : PARTY_CONFIG.unlockCost(storage.unlockedPartySlots),
      members,
    });
  }

  private async emitCharacters(player: GamePlayer) {
    const characters = (await this.store.listCharacters(player.accountId)).map((c) => this.toSummary(c));
    this.emitTo(player.socketId ?? '', 'characters.update', { characters });
  }

  async handlePartyUnlockSlot(socketId: string, token: string) {
    const session = await this.verifySession(socketId, token);
    if (!session) return;
    const player = session.player;
    const storage = this.storageFor(player);
    if (storage.unlockedPartySlots >= PARTY_CONFIG.maxSlots) {
      this.emitTo(socketId, 'error', { message: 'Todos os slots de party já foram desbloqueados.' });
      return;
    }
    const cost = PARTY_CONFIG.unlockCost(storage.unlockedPartySlots);
    if (storage.gold < cost) {
      this.emitTo(socketId, 'error', { message: `Gold insuficiente para desbloquear o slot (${cost} gold).` });
      return;
    }
    storage.gold -= cost;
    storage.unlockedPartySlots += 1;
    await this.store.saveAccountStorage(storage.toStored());
    this.emitGold(player, storage.gold);
    await this.emitPartyState(player);
    this.emitTo(socketId, 'chat.message', { channel: 'local', from: 'Sistema', text: `Slot de party desbloqueado! Agora você pode convocar até ${storage.unlockedPartySlots} personagem(ns).` });
  }

  async handlePartySummon(socketId: string, token: string, characterId: string) {
    const session = await this.verifySession(socketId, token);
    if (!session) return;
    const player = session.player;
    if (characterId === player.id) {
      this.emitTo(socketId, 'error', { message: 'Este personagem já está ativo.' });
      return;
    }
    const storage = this.storageFor(player);
    const companions = storage.party ?? [];
    if (companions.includes(characterId)) {
      this.emitTo(socketId, 'error', { message: 'Personagem já convocado.' });
      return;
    }
    if (companions.length + 1 >= storage.unlockedPartySlots) {
      this.emitTo(socketId, 'error', { message: 'Nenhum slot de party disponível. Desbloqueie um novo slot.' });
      return;
    }
    const stored = await this.store.findCharacterById(characterId);
    if (!stored || stored.accountId !== player.accountId) {
      this.emitTo(socketId, 'error', { message: 'Personagem não encontrado.' });
      return;
    }
    storage.party = [...companions, characterId];
    await this.store.saveAccountStorage(storage.toStored());
    await this.emitPartyState(player);
    this.emitTo(socketId, 'chat.message', { channel: 'local', from: 'Sistema', text: `${stored.name} foi convocado para a party!` });
  }

  handlePartyDismiss(socketId: string, token: string, characterId: string) {
    void this.verifySession(socketId, token).then(async (session) => {
      if (!session) return;
      const player = session.player;
      const storage = this.storageFor(player);
      storage.party = (storage.party ?? []).filter((id) => id !== characterId);
      await this.store.saveAccountStorage(storage.toStored());
      const companion = this.players.get(characterId);
      if (companion && companion.accountId === player.accountId && !companion.socketId) {
        this.removeCompanionFromWorld(characterId);
      }
      await this.emitPartyState(player);
    });
  }

  /** Materializa um companheiro (GamePlayer sem socket) para a hunt, sem exibir no hub. */
  private materializeCompanion(stored: StoredCharacter): GamePlayer {
    const companion = new GamePlayer(stored);
    companion.socketId = null;
    companion.position = { ...SPAWN_POINT };
    companion.recomputeSpeed(getItemDef);
    companion.recomputeVitals(getItemDef);
    this.players.set(companion.id, companion);
    this.schedulePlayerRegen(companion.id, Date.now() + 1000);
    this.schedulePlayerSave(companion.id, Date.now() + 10_000);
    if (this.prisma) {
      void this.prisma.characterAttackRotationSlot.findMany({ where: { character_id: companion.id, preset: 'HUNT' }, orderBy: { slot_position: 'asc' } }).then((slots) => {
        this.attackRotations.set(companion.id, slots.map((slot) => ({ abilityId: slot.ability_id ?? undefined, enabled: slot.enabled, minTargets: slot.min_targets ?? undefined })));
        this.schedulePlayerAttackCheck(companion, Date.now());
      });
      void this.prisma.characterHealingRotationSlot.findMany({ where: { character_id: companion.id, preset: 'HUNT' }, orderBy: { slot_position: 'asc' } }).then((heals) => {
        this.healingRotations.set(companion.id, heals.filter((slot) => slot.slot_position >= 1 && slot.slot_position <= 3).map((slot) => this.healingSlot(slot.slot_position, slot.ability_id ?? undefined, slot.enabled, slot.trigger, 100)));
        this.schedulePlayerHealCheck(companion, Date.now());
      });
    }
    return companion;
  }

  private removeCompanionFromWorld(characterId: string) {
    this.players.delete(characterId);
    this.movement.releaseEntity(characterId);
    this.hunts.removeRun(characterId);
    this.regenEventReadyAt.delete(characterId);
    this.moveEventReadyAt.delete(characterId);
    this.saveEventReadyAt.delete(characterId);
    this.clearPlayerCombatState(characterId);
    this.emitAll('entity.removed', { id: characterId });
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
    const storage = this.storageFor(player);
    storage.gold += bonus;
    this.emitGold(player, storage.gold);
    this.emitTo(player.socketId ?? '', 'gold.gained', { amount: bonus });
    this.emitTo(player.socketId ?? '', 'chat.message', {
      channel: 'local',
      from: 'Sistema',
      text: `Bônus de conclusão: +${bonus} gold.`,
    });
    void huntId;
  }

  /** Finaliza a run no motor: líder volta ao hub; companheiros são desmaterializados. */
  private handleRunFinished(characterId: string, reason: 'completed' | 'wiped' | 'stopped') {
    const run = this.hunts.getRun(characterId);
    const memberIds = run ? [...run.memberIds] : [characterId];
    this.hunts.removeRun(characterId);
    this.huntEventReadyAt.delete(characterId);
    const leader = this.players.get(characterId);
    const socketId = leader?.socketId ?? '';
    for (const id of memberIds) {
      const player = this.players.get(id);
      if (!player) continue;
      if (player.socketId) {
        player.position = { ...SPAWN_POINT };
        player.health = player.maxHealth;
        player.mana = player.maxMana;
        player.targetId = null;
        player.moveDir = null;
        this.moveEventReadyAt.delete(player.id);
        this.movement.occupy(player.position, player.id);
        this.emitTo(player.socketId, 'game.enterWorld', {
          character: this.toSummary(player),
          map: this.world.tiles,
          width: this.world.width,
          height: this.world.height,
        });
        this.emitStats(player);
        this.emitInventory(player);
        this.emitTo(player.socketId, 'hunt.returnedToCity', {});
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
      } else {
        void this.persistPlayer(player);
        this.removeCompanionFromWorld(id);
      }
    }
    void run;
  }

  // ---------------------------------------------------------------- actions

  handleDisconnect(socketId: string) {
    const characterId = this.playerBySocket.get(socketId);
    if (!characterId) return;
    const player = this.players.get(characterId);
    this.playerBySocket.delete(socketId);
    if (!player) return;
    // Desconexão de um socket antigo após o personagem já ter reanexado em um
    // socket novo (ex.: F5) não deve zerar o socketId atual.
    if (player.socketId !== socketId) return;
    // Jogador em hunt ativa não é removido: continua caçando no servidor e o
    // cliente apenas reanexa ao reconectar.
    const run = this.hunts.getRun(player.id);
    if (run && run.status === 'active') {
      player.socketId = null;
      return;
    }
    void this.removePlayerByCharacterId(characterId);
  }

  private async removePlayerFromWorld(socketId: string) {
    const characterId = this.playerBySocket.get(socketId);
    if (!characterId) return;
    this.playerBySocket.delete(socketId);
    await this.removePlayerByCharacterId(characterId);
  }

  private async removePlayerByCharacterId(characterId: string) {
    const player = this.players.get(characterId);
    if (!player) return;
    this.players.delete(characterId);
    this.movement.releaseEntity(characterId);
    this.hunts.removeRun(characterId);
    this.huntEventReadyAt.delete(characterId);
    this.regenEventReadyAt.delete(characterId);
    this.moveEventReadyAt.delete(characterId);
    this.saveEventReadyAt.delete(characterId);
    this.clearPlayerCombatState(characterId);
    this.emitAll('entity.removed', { id: characterId });
    await this.persistPlayer(player);
    // Remove os companheiros materializados da conta do mundo (mantendo a formação persistida).
    for (const companion of [...this.players.values()]) {
      if (companion.accountId !== player.accountId || companion.socketId) continue;
      await this.persistPlayer(companion);
      this.removeCompanionFromWorld(companion.id);
    }
    this.logger.log(`Jogador ${player.name} saiu.`);
  }

  /** Remove o estado de combate agendado/mapas de um personagem (evita vazamento). */
  private clearPlayerCombatState(characterId: string) {
    this.combatEventReadyAt.delete(`${characterId}:attack`);
    this.combatEventReadyAt.delete(`${characterId}:heal`);
    this.attackGroupReadyAt.delete(characterId);
    this.healingGroupReadyAt.delete(characterId);
    this.abilityCooldowns.delete(characterId);
    this.attackRotations.delete(characterId);
    this.healingRotations.delete(characterId);
    for (const key of this.activeAbilityCasts) {
      if (key.startsWith(`${characterId}:`)) this.activeAbilityCasts.delete(key);
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

  async handleAbilityCast(socketId: string, abilityId: number, targetId?: string, direction?: Direction, position?: Position): Promise<boolean> {
    const playerId = this.playerBySocket.get(socketId);
    const player = playerId ? this.players.get(playerId) : undefined;
    if (!player) {
      this.emitTo(socketId, 'ability.castFailed', { abilityId, reason: 'ABILITY_UNAVAILABLE' });
      return false;
    }
    return this.castAbility(player, abilityId, targetId, socketId, direction, position);
  }

  private async castAbility(player: GamePlayer, abilityId: number, targetId?: string, socketId = player.socketId ?? '', direction?: Direction, position?: Position): Promise<boolean> {
    const ability = await this.abilityRegistry.get(abilityId);
    if (!ability || !ability.enabled || !['player', 'both'].includes(ability.ownerType)) {
      this.emitTo(socketId, 'ability.castFailed', { abilityId, reason: 'ABILITY_UNAVAILABLE' });
      return false;
    }
    if (ability.playerClass && ability.playerClass !== 'all' && ability.playerClass !== player.archetype) {
      this.emitTo(socketId, 'ability.castFailed', { abilityId, reason: 'CLASS_MISMATCH' });
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
    const needsTarget = ability.category !== 'heal' && ability.targetMode !== 'directional' && ability.targetMode !== 'ground';
    if (needsTarget && (!target || tileDistance(player.position, target.position) > ability.rangeTiles)) {
      this.activeAbilityCasts.delete(castKey);
      this.emitTo(socketId, 'ability.castFailed', { abilityId, reason: 'INVALID_TARGET' });
      return false;
    }
    if (ability.targetMode === 'directional') {
      const tiles = this.directionalTiles(player.position, direction ?? player.facing, ability.rangeTiles, ability.areaConfig);
      if (this.enemiesInTiles(player, tiles).length === 0) {
        this.activeAbilityCasts.delete(castKey);
        this.emitTo(socketId, 'ability.castFailed', { abilityId, reason: 'NO_TARGETS_IN_AREA' });
        return false;
      }
    }
    if (ability.cooldownGroup === 'healing') this.healingGroupReadyAt.set(player.id, now + 1000);
    else this.attackGroupReadyAt.set(player.id, now + 2000);
    player.mana -= ability.manaCost ?? 0;
    cooldowns.set(abilityId, now + ability.cooldownMs);
    this.abilityCooldowns.set(player.id, cooldowns);
    this.emitTo(socketId, 'ability.cast', { abilityId, attackerId: player.id, targetId });
    this.emitCooldowns(player);
    if (ability.category === 'heal') {
      const healTarget = (target instanceof GamePlayer ? target : player);
      const amount = Math.max(1, ability.defaultParameters?.power ?? 30);
      healTarget.health = Math.min(healTarget.maxHealth, healTarget.health + amount);
      this.emitHeal(player.id, healTarget, amount);
      this.emitStats(player);
    } else if (ability.targetMode === 'directional') {
      this.dealDirectionalAbility(player, ability, direction ?? player.facing, now);
      this.emitStats(player);
    } else if (ability.targetMode === 'ground') {
      this.dealGroundAbility(player, ability, position ?? target?.position, direction ?? player.facing, now);
      this.emitStats(player);
    } else if (ability.targetMode === 'area_enemy' && target) {
      this.dealAreaAbilityDamage(player, target, ability, now);
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

  private rotationTarget(player: GamePlayer, characterId?: string): string {
    if (characterId && characterId !== player.id && this.partyMemberIds(player).includes(characterId)) return characterId;
    return player.id;
  }

  async handleRotationLoad(socketId: string, preset: string, characterId?: string) {
    const player = this.playerForSocket(socketId);
    if (!player || !['HUNT', 'BOSS', 'HELPER'].includes(preset) || !this.prisma) return;
    const targetId = this.rotationTarget(player, characterId);
    const [attack, healing] = await Promise.all([
      this.prisma.characterAttackRotationSlot.findMany({ where: { character_id: targetId, preset }, orderBy: { slot_position: 'asc' } }),
      this.prisma.characterHealingRotationSlot.findMany({ where: { character_id: targetId, preset }, orderBy: { slot_position: 'asc' } }),
    ]);
    this.attackRotations.set(targetId, attack.map((slot) => ({ abilityId: slot.ability_id ?? undefined, enabled: slot.enabled, minTargets: slot.min_targets ?? undefined })));
    this.healingRotations.set(targetId, healing.filter((slot) => slot.slot_position >= 1 && slot.slot_position <= 3).map((slot) => this.healingSlot(slot.slot_position, slot.ability_id ?? undefined, slot.enabled, slot.trigger, 80)));
    this.emitTo(socketId, 'rotation.state', { preset, characterId: targetId, attack, healing, saved: true, cooldowns: { attackGroupReadyAt: this.attackGroupReadyAt.get(targetId) ?? 0, healingGroupReadyAt: this.healingGroupReadyAt.get(targetId) ?? 0, abilityReadyAt: Object.fromEntries(this.abilityCooldowns.get(targetId) ?? []) } });
    const target = this.players.get(targetId);
    if (target) {
      this.schedulePlayerAttackCheck(target, Date.now());
      this.schedulePlayerHealCheck(target, Date.now());
    }
  }

  handleAttackRotation(socketId: string, preset: string, slots: { position: number; abilityId?: number; enabled: boolean; minTargets?: number }[], characterId?: string) {
    const player = this.playerForSocket(socketId); if (!player || !['HUNT', 'BOSS', 'HELPER'].includes(preset)) return;
    const targetId = this.rotationTarget(player, characterId);
    const ordered = slots.sort((a, b) => a.position - b.position);
    this.attackRotations.set(targetId, ordered);
    const target = this.players.get(targetId);
    if (target) this.schedulePlayerAttackCheck(target, Date.now());
    if (this.prisma) void this.prisma.$transaction(async (tx) => { await tx.characterAttackRotationSlot.deleteMany({ where: { character_id: targetId, preset } }); await tx.characterAttackRotationSlot.createMany({ data: ordered.map((slot) => ({ character_id: targetId, preset, slot_position: slot.position, ability_id: slot.abilityId ?? null, enabled: slot.enabled, min_targets: slot.minTargets ?? null })) }); return tx.characterAttackRotationSlot.findMany({ where: { character_id: targetId, preset }, orderBy: { slot_position: 'asc' } }); }).then((attack) => this.emitTo(socketId, 'rotation.state', { preset, characterId: targetId, attack, cooldowns: { attackGroupReadyAt: this.attackGroupReadyAt.get(targetId) ?? 0, healingGroupReadyAt: this.healingGroupReadyAt.get(targetId) ?? 0, abilityReadyAt: Object.fromEntries(this.abilityCooldowns.get(targetId) ?? []) } })).catch((error) => this.emitTo(socketId, 'error', { message: `Falha ao salvar rotação: ${error instanceof Error ? error.message : String(error)}` }));
  }

  handleHealingRotation(socketId: string, preset: string, slots: { position: number; abilityId?: number; enabled: boolean; trigger: { target?: 'self' | 'lowest_party_member' | 'specific_party_role'; hpBelowPercent: number; mpBelowPercent?: number; potionId?: string } }[], characterId?: string) {
    const player = this.playerForSocket(socketId); if (!player || !['HUNT', 'BOSS', 'HELPER'].includes(preset)) return;
    const targetId = this.rotationTarget(player, characterId);
    const ordered = slots.filter((slot) => slot.position >= 1 && slot.position <= 3).sort((a, b) => a.position - b.position).map((slot) => ({
      ...slot,
      abilityId: slot.position === 1 ? slot.abilityId : undefined,
      trigger: { ...slot.trigger, potionId: slot.position === 1 ? undefined : slot.trigger.potionId },
    }));
    this.healingRotations.set(targetId, ordered.map((slot) => this.healingSlot(slot.position, slot.abilityId, slot.enabled, slot.trigger, 80)));
    const target = this.players.get(targetId);
    if (target) this.schedulePlayerHealCheck(target, Date.now());
    if (this.prisma) void this.prisma.$transaction(async (tx) => { await tx.characterHealingRotationSlot.deleteMany({ where: { character_id: targetId, preset } }); await tx.characterHealingRotationSlot.createMany({ data: ordered.map((slot) => ({ character_id: targetId, preset, slot_position: slot.position, ability_id: slot.abilityId ?? null, enabled: slot.enabled, trigger: slot.trigger })) }); return tx.characterHealingRotationSlot.findMany({ where: { character_id: targetId, preset }, orderBy: { slot_position: 'asc' } }); }).then((healing) => this.emitTo(socketId, 'rotation.state', { preset, characterId: targetId, healing, cooldowns: { attackGroupReadyAt: this.attackGroupReadyAt.get(targetId) ?? 0, healingGroupReadyAt: this.healingGroupReadyAt.get(targetId) ?? 0, abilityReadyAt: Object.fromEntries(this.abilityCooldowns.get(targetId) ?? []) } })).catch((error) => this.emitTo(socketId, 'error', { message: `Falha ao salvar cura: ${error instanceof Error ? error.message : String(error)}` }));
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
    if (!this.addToInventory(this.storageFor(player), item.itemId, item.quantity)) {
      this.emitTo(socketId, 'error', { message: 'Inventário cheio.' });
      return;
    }
    this.groundItems.delete(entityId);
    this.groundItemEventReadyAt.delete(entityId);
    this.emitAll('loot.removed', { entityId });
    this.emitInventory(player);
  }

  async handleEquip(socketId: string, slotIndex: number, characterId?: string) {
    const leader = this.playerForSocket(socketId);
    if (!leader) return;
    return this.withInventoryMutationLock(leader.accountId, () => this.handleEquipLocked(socketId, slotIndex, characterId));
  }

  private async handleEquipLocked(socketId: string, slotIndex: number, characterId?: string) {
    const leader = this.playerForSocket(socketId);
    if (!leader) return;
    const targetId = characterId ?? leader.id;
    const storage = this.storageFor(leader);
    const stack = storage.inventory[slotIndex];
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= storage.inventory.length || !stack) return;
    const def = getItemDef(stack.itemId);
    if (!def || !def.slot) return;
    const slot = def.slot;
    const live = this.players.get(targetId);
    if (live && live.accountId !== leader.accountId) return;
    if (live) {
      if (live.equipment[slot]) {
          this.emitInventoryError(socketId, `Já existe item equipado em ${slot}.`);
        return;
      }
      storage.inventory[slotIndex] = stack.quantity > 1 ? { ...stack, quantity: stack.quantity - 1 } : null;
      live.equipment[slot] = { itemId: stack.itemId, quantity: 1 };
      if (slot === 'weapon' && live.id === leader.id) this.resumeWeaponElementOverride(live);
      live.recomputeSpeed(getItemDef);
      live.recomputeVitals(getItemDef);
      await this.persistPlayer(live, true);
      await this.store.saveAccountStorage(storage.toStored());
      if (live.id === leader.id) {
        this.emitInventory(leader);
        this.emitStats(leader);
      }
    } else {
      const stored = await this.store.findCharacterById(targetId);
      if (!stored || stored.accountId !== leader.accountId) return;
      if (stored.equipment[slot]) {
          this.emitInventoryError(socketId, `Já existe item equipado em ${slot}.`);
        return;
      }
      storage.inventory[slotIndex] = stack.quantity > 1 ? { ...stack, quantity: stack.quantity - 1 } : null;
      stored.equipment[slot] = { itemId: stack.itemId, quantity: 1 };
      await this.store.saveCharacter(stored);
      await this.store.saveAccountStorage(storage.toStored());
    }
    this.emitInventory(leader);
    await this.emitPartyState(leader);
    await this.emitCharacters(leader);
  }

  async handleUnequip(socketId: string, slot: string, characterId?: string) {
    const leader = this.playerForSocket(socketId);
    if (!leader) return;
    return this.withInventoryMutationLock(leader.accountId, () => this.handleUnequipLocked(socketId, slot, characterId));
  }

  private async handleUnequipLocked(socketId: string, slot: string, characterId?: string) {
    const leader = this.playerForSocket(socketId);
    if (!leader) return;
    // O modal de inventário permite gerenciar qualquer personagem da conta,
    // não apenas os membros atualmente convocados para a party.
    const targetId = characterId ?? leader.id;
    const storage = this.storageFor(leader);
    const validSlots: (keyof CharacterEquipment)[] = ['helmet', 'armor', 'legs', 'boots', 'ring', 'necklace', 'relic', 'weapon', 'offhand', 'ammo'];
    if (!validSlots.includes(slot as keyof CharacterEquipment)) return;
    const live = this.players.get(targetId);
    if (live) {
      const stack = live.equipment[slot as keyof CharacterEquipment];
      if (!stack) return;
      if (!this.addToInventory(storage, stack.itemId, stack.quantity)) {
        this.emitTo(socketId, 'error', { message: 'Inventário cheio.' });
        return;
      }
      if (slot === 'weapon' && live.id === leader.id) this.pauseWeaponElementOverride(live);
      live.equipment[slot as keyof CharacterEquipment] = undefined;
      live.recomputeSpeed(getItemDef);
      live.recomputeVitals(getItemDef);
      await this.persistPlayer(live, true);
      await this.store.saveAccountStorage(storage.toStored());
      if (live.id === leader.id) {
        this.emitInventory(leader);
        this.emitStats(leader);
      }
    } else {
      const stored = await this.store.findCharacterById(targetId);
      if (!stored || stored.accountId !== leader.accountId) return;
      const stack = stored.equipment[slot as keyof CharacterEquipment];
      if (!stack) return;
      if (!this.addToInventory(storage, stack.itemId, stack.quantity)) {
        this.emitTo(socketId, 'error', { message: 'Inventário cheio.' });
        return;
      }
      stored.equipment[slot as keyof CharacterEquipment] = undefined;
      await this.store.saveCharacter(stored);
      await this.store.saveAccountStorage(storage.toStored());
    }
    this.emitInventory(leader);
    await this.emitPartyState(leader);
    await this.emitCharacters(leader);
  }

  private async withInventoryMutationLock<T>(accountId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.inventoryMutationLocks.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => current);
    this.inventoryMutationLocks.set(accountId, queued);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.inventoryMutationLocks.get(accountId) === queued) this.inventoryMutationLocks.delete(accountId);
    }
  }

  private emitInventoryError(socketId: string, message: string) {
    const key = `${socketId}:${message}`;
    const now = Date.now();
    if (now - (this.recentInventoryErrors.get(key) ?? 0) < 750) return;
    this.recentInventoryErrors.set(key, now);
    this.emitTo(socketId, 'error', { message });
  }

  async handleInventoryMove(socketId: string, from: 'backpack' | 'loot', fromIndex: number, to: 'backpack' | 'loot', toIndex: number) {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    if (fromIndex < 0 || toIndex < 0 || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return;
    const storage = this.storageFor(player);
    this.ensureLootPouchCapacity(storage);
    const source = from === 'loot' ? storage.lootPouch : storage.inventory;
    const target = to === 'loot' ? storage.lootPouch : storage.inventory;
    if (fromIndex >= source.length || toIndex >= target.length) return;
    if (from === 'loot' && fromIndex >= storage.lootPouchSize) return;
    if (to === 'loot' && toIndex >= storage.lootPouchSize) return;
    const srcStack = source[fromIndex];
    if (!srcStack) return;
    const dstStack = target[toIndex];
    const def = getItemDef(srcStack.itemId);
    if (dstStack && dstStack.itemId === srcStack.itemId && (def?.stackable ?? true)) {
      dstStack.quantity += srcStack.quantity;
      source[fromIndex] = null;
    } else {
      source[fromIndex] = dstStack ?? null;
      target[toIndex] = srcStack;
    }
    this.compactContainer(source);
    if (target !== source) this.compactContainer(target);
    await this.store.saveAccountStorage(storage.toStored());
    this.emitInventory(player);
  }

  /** Remove lacunas de um container, alinhando os itens para o início. */
  private compactContainer(container: (ItemStack | null)[]) {
    let write = 0;
    for (let read = 0; read < container.length; read++) {
      const stack = container[read];
      if (!stack) continue;
      if (write !== read) {
        container[write] = stack;
        container[read] = null;
      }
      write++;
    }
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
    const storage = this.storageFor(player);
    if (storage.lootPouchSize >= LOOT_POUCH_EXPANSION.maxSize) {
      this.emitTo(socketId, 'error', { message: 'A Bolsa de Loot já está no tamanho máximo.' });
      return false;
    }
    const cost = LOOT_POUCH_EXPANSION.goldCost(storage.lootPouchSize);
    if (storage.gold < cost) {
      this.emitTo(socketId, 'error', { message: `Gold insuficiente para expandir a Bolsa de Loot (${cost} gold).` });
      return false;
    }
    const nextSize = Math.min(LOOT_POUCH_EXPANSION.maxSize, storage.lootPouchSize + LOOT_POUCH_EXPANSION.slotsPerUpgrade);
    storage.gold -= cost;
    storage.lootPouchSize = nextSize;
    while (storage.lootPouch.length < nextSize) storage.lootPouch.push(null);
    this.emitGold(player, storage.gold);
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
    const storage = this.storageFor(player);
    let total = 0;
    let sold = 0;
    storage.lootPouch = storage.lootPouch.map((stack) => {
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
    storage.gold += total;
    this.emitGold(player, storage.gold);
    this.emitTo(socketId, 'gold.gained', { amount: total });
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

  private async ensureAccountStorage(accountId: string): Promise<AccountStorageState> {
    let storage = this.accountStorage.get(accountId);
    if (storage) return storage;
    const stored = await this.store.getAccountStorage(accountId);
    storage = stored ? new AccountStorageState(stored) : AccountStorageState.blank(accountId);
    this.accountStorage.set(accountId, storage);
    if (!stored) await this.store.saveAccountStorage(storage.toStored());
    return storage;
  }

  private storageFor(player: GamePlayer): AccountStorageState {
    let storage = this.accountStorage.get(player.accountId);
    if (!storage) {
      storage = AccountStorageState.blank(player.accountId);
      this.accountStorage.set(player.accountId, storage);
    }
    return storage;
  }

  private accountGold(accountId: string): number {
    return this.accountStorage.get(accountId)?.gold ?? 0;
  }

  private healingSlot(position: number, abilityId: number | undefined, enabled: boolean, trigger: unknown, hpFallback: number): { position: number; abilityId?: number; potionId?: string; enabled: boolean; hpBelowPercent: number; mpBelowPercent: number; target: 'self' | 'lowest_party_member' | 'specific_party_role' } {
    const t = (trigger as { target?: string } | undefined)?.target;
    const target: 'self' | 'lowest_party_member' | 'specific_party_role' = t === 'lowest_party_member' || t === 'specific_party_role' ? t : 'self';
    const hpBelowPercent = Number((trigger as { hpBelowPercent?: number } | undefined)?.hpBelowPercent ?? hpFallback);
    const mpBelowPercent = Number((trigger as { mpBelowPercent?: number } | undefined)?.mpBelowPercent ?? 50);
    const potionId = typeof (trigger as { potionId?: unknown } | undefined)?.potionId === 'string' ? (trigger as { potionId: string }).potionId : undefined;
    return { position, abilityId, potionId, enabled, hpBelowPercent, mpBelowPercent, target };
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
    if (!player) return null;
    return {
      id: player.id,
      position: { ...player.position },
      socketId: player.socketId,
      health: player.health,
      defense: this.defenseValue(player),
      archetype: player.archetype,
    };
  }

  private toSummary(c: StoredCharacter | GamePlayer): CharacterSummary {
    const accountId = c.accountId;
    return {
      id: c.id,
      accountId,
      name: c.name,
      archetype: c.archetype,
      gold: this.accountGold(accountId),
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
      equipment: { ...c.equipment },
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

  private tryStep(entity: GamePlayer, direction: Direction): boolean {
    if (this.movement.canMove(entity.position, direction, [entity.id])) {
      const from = { ...entity.position };
      entity.position = this.movement.step(entity.position, direction);
      this.movement.commitMove(entity.id, from, entity.position);
      entity.facing = direction;
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
      footprintWidth: creature.definition.footprintWidth,
      footprintHeight: creature.definition.footprintHeight,
    };
  }

  private addToInventory(storage: AccountStorageState, itemId: string, quantity: number): boolean {
    const def = getItemDef(itemId);
    if (!def) return false;
    if (def.stackable) {
      const existing = storage.inventory.find((s) => s && s.itemId === itemId);
      if (existing) {
        existing.quantity += quantity;
        return true;
      }
    }
    const idx = storage.inventory.findIndex((s) => s === null);
    if (idx === -1) return false;
    storage.inventory[idx] = { itemId, quantity };
    return true;
  }

  private addToLootPouch(storage: AccountStorageState, itemId: string, quantity: number): boolean {
    this.ensureLootPouchCapacity(storage);
    return this.addToContainer(storage.lootPouch, itemId, quantity);
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

  private ensureLootPouchCapacity(storage: AccountStorageState) {
    storage.lootPouchSize = Math.max(LOOT_POUCH_SIZE, storage.lootPouchSize, storage.lootPouch.length);
    while (storage.lootPouch.length < storage.lootPouchSize) storage.lootPouch.push(null);
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

  private emitGold(player: GamePlayer, gold: number) {
    this.emitTo(player.socketId ?? '', 'gold.update', { gold });
  }

  /** Emite o estado de cooldown de um personagem para todos os sockets da party. */
  private emitCooldowns(player: GamePlayer) {
    const payload = {
      characterId: player.id,
      attackGroupReadyAt: this.attackGroupReadyAt.get(player.id) ?? 0,
      healingGroupReadyAt: this.healingGroupReadyAt.get(player.id) ?? 0,
      abilityReadyAt: Object.fromEntries(this.abilityCooldowns.get(player.id) ?? []),
    };
    const run = this.hunts.getRun(player.id);
    if (run) {
      for (const id of run.memberIds) {
        const member = this.players.get(id);
        if (member?.socketId) this.emitTo(member.socketId, 'cooldowns.update', payload);
      }
    } else if (player.socketId) {
      this.emitTo(player.socketId, 'cooldowns.update', payload);
    }
  }

  private emitInventory(player: GamePlayer) {
    const storage = this.storageFor(player);
    this.ensureLootPouchCapacity(storage);
    const inventory: CharacterInventory = {
      slots: storage.inventory.map((s) => (s ? { ...s } : null)),
      lootPouchSize: storage.lootPouchSize,
      lootPouch: storage.lootPouch.map((s) => (s ? { ...s } : null)),
      equipment: { ...player.equipment },
    };
    this.emitTo(player.socketId ?? '', 'inventory.update', { inventory });
  }

  private combatStats(player: GamePlayer) {
    return this.combatStatsFor(player);
  }

  private combatStatsFor(character: { level: number; maxHealth: number; maxMana: number; skills: CharacterSkills; equipment: CharacterEquipment }) {
    return aggregateCharacterCombatStats({
      level: character.level,
      maxHp: character.maxHealth,
      maxMana: character.maxMana,
      skills: character.skills,
      equipment: character.equipment,
      getItem: getItemDef,
    });
  }

  private combatStatsPayload(character: { id: string; level: number; maxHealth: number; maxMana: number; skills: CharacterSkills; equipment: CharacterEquipment }) {
    const stats = this.combatStatsFor(character);
    return {
      characterId: character.id,
      armor: stats.armor,
      defense: stats.defense,
      criticalChance: stats.criticalChance,
      criticalDamage: stats.criticalDamage,
      accuracy: stats.accuracy,
      dodge: stats.dodge,
      speed: stats.speed,
      resistances: stats.resistances,
      damageBonuses: stats.damageBonuses,
    };
  }

  /** Emite os stats de combate de um personagem (self ou companheiro materializado). */
  private emitCombatStats(player: GamePlayer) {
    const payload = this.combatStatsPayload(player);
    const run = this.hunts.getRun(player.id);
    if (run) {
      for (const id of run.memberIds) {
        const member = this.players.get(id);
        if (member?.socketId) this.emitTo(member.socketId, 'stats.combat', payload);
      }
    } else if (player.socketId) {
      this.emitTo(player.socketId, 'stats.combat', payload);
    }
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
      damageBonuses: emptyResistances(),
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
        for (const id of run.memberIds) {
          const member = this.players.get(id);
          if (member?.socketId) this.emitTo(member.socketId, event, data);
        }
        return;
      }
      this.emitAll(event, data);
      return;
    }
    const run = this.hunts.findRunByCreature(target.id);
    if (run) {
      for (const id of run.memberIds) {
        const member = this.players.get(id);
        if (member?.socketId) this.emitTo(member.socketId, event, data);
      }
      return;
    }
    this.emitAll(event, data);
  }

  private emitHeal(sourceId: string, target: GamePlayer, amount: number, critical = false, resource: 'hp' | 'mp' = 'hp') {
    this.emitCombatEvent(target, 'combat.heal', {
      sourceId,
      targetId: target.id,
      amount,
      critical,
      resource,
      targetHealth: target.health,
    });
  }

  private dealAbilityDamage(attacker: GamePlayer, target: GamePlayer | CreatureEntity, ability: CombatAbilityDefinition, now: number): boolean {
    const delayMs = this.emitAbilityProjectile(attacker, attacker.position, target.position, ability, target.id);
    this.applyAbilityDamage(attacker, target, ability, now, delayMs);
    return true;
  }

  /** Dano em área ao redor de um alvo (targetMode area_enemy): aplica a todos os inimigos nos tiles do shape. */
  private dealAreaAbilityDamage(attacker: GamePlayer, target: GamePlayer | CreatureEntity, ability: CombatAbilityDefinition, now: number) {
    const center = target.position;
    const tiles = this.groundTiles(center, ability.areaConfig);
    const delayMs = this.emitAbilityArea(attacker, attacker.position, center, tiles, ability, target.id);
    for (const enemy of this.enemiesInTiles(attacker, tiles)) {
      this.applyAbilityDamage(attacker, enemy, ability, now, delayMs);
    }
  }

  private dealDirectionalAbility(attacker: GamePlayer, ability: CombatAbilityDefinition, direction: Direction, now: number) {
    const delta = DIRECTION_DELTAS[direction] ?? DIRECTION_DELTAS.south;
    const to: Position = { x: attacker.position.x + delta.dx * ability.rangeTiles, y: attacker.position.y + delta.dy * ability.rangeTiles, z: attacker.position.z };
    const tiles = this.directionalTiles(attacker.position, direction, ability.rangeTiles, ability.areaConfig);
    const delayMs = this.emitAbilityArea(attacker, attacker.position, to, tiles, ability);
    for (const enemy of this.enemiesInTiles(attacker, tiles)) {
      this.applyAbilityDamage(attacker, enemy, ability, now, delayMs);
    }
  }

  private dealGroundAbility(attacker: GamePlayer, ability: CombatAbilityDefinition, position: Position | undefined, direction: Direction, now: number) {
    const origin = position ? { x: position.x, y: position.y, z: attacker.position.z } : (() => { const delta = DIRECTION_DELTAS[direction] ?? DIRECTION_DELTAS.south; return { x: attacker.position.x + delta.dx * ability.rangeTiles, y: attacker.position.y + delta.dy * ability.rangeTiles, z: attacker.position.z }; })();
    const tiles = this.groundTiles(origin, ability.areaConfig);
    if (tileDistance(attacker.position, origin) > ability.rangeTiles + 1) return;
    const delayMs = this.emitAbilityArea(attacker, attacker.position, origin, tiles, ability);
    for (const enemy of this.enemiesInTiles(attacker, tiles)) {
      this.applyAbilityDamage(attacker, enemy, ability, now, delayMs);
    }
  }

  /** Emite combat.projectile (se a habilidade tiver visual) e retorna o tempo de viagem em ms. */
  private emitAbilityProjectile(attacker: GamePlayer, from: Position, to: Position, ability: CombatAbilityDefinition, targetId = ''): number {
    const visual = this.resolveAbilityVisual(ability);
    if (!visual?.projectile) return 0;
    const travelTimeMs = this.projectileTravelTimeMs(from, to, visual);
    this.emitCombatEventForPlayer(attacker, 'combat.projectile', {
      attackerId: attacker.id,
      targetId,
      from: { ...from },
      to: { ...to },
      projectile: visual.projectile,
      impact: visual.impact,
      travelTimeMs,
    });
    return travelTimeMs;
  }

  /** Emite combat.area (projétil até o centro + impacto em todos os tiles da área) e retorna o tempo de viagem em ms. */
  private emitAbilityArea(attacker: GamePlayer, from: Position, center: Position, tiles: Position[], ability: CombatAbilityDefinition, targetId = ''): number {
    const visual = this.resolveAbilityVisual(ability);
    if (!visual?.projectile && !visual?.impact) return 0;
    const travelTimeMs = visual.projectile ? this.projectileTravelTimeMs(from, center, visual) : 0;
    this.emitCombatEventForPlayer(attacker, 'combat.area', {
      attackerId: attacker.id,
      targetId,
      from: { ...from },
      center: { ...center },
      tiles: tiles.map((t) => ({ x: t.x, y: t.y, z: t.z })),
      projectile: visual.projectile,
      impact: visual.impact,
      travelTimeMs,
    });
    return travelTimeMs;
  }

  /** Aplica dano de habilidade a um único alvo (sem reemitir o projétil). */
  private applyAbilityDamage(attacker: GamePlayer, target: GamePlayer | CreatureEntity, ability: CombatAbilityDefinition, now: number, delayMs = 0): number {
    const stats = this.combatStats(attacker);
    const weapon = attacker.equipment.weapon ? getWeaponDefinition(getItemDef(attacker.equipment.weapon.itemId)) : undefined;
    const ammo = attacker.equipment.ammo ? getAmmoDefinition(getItemDef(attacker.equipment.ammo.itemId)) : undefined;
    const sourcePower = ability.powerSource === 'weapon_ammo' ? (weapon?.attackPower ?? 0) + (ammo?.attackPower ?? 0) : ability.powerSource === 'weapon' ? (weapon?.attackPower ?? 0) : ability.powerSource === 'magic_weapon' ? (weapon?.magicPower ?? 0) : ability.defaultParameters?.power ?? 20;
    const skill = attacker.archetype === 'mage' ? stats.magicLevel : attacker.archetype === 'archer' ? stats.distanceSkill : stats.meleeSkill;
    const raw = calculateRawDamage({ basePower: sourcePower, flatPower: ability.defaultParameters?.flatPower, skill: attacker.archetype === 'mage' ? 'magic' : attacker.archetype === 'archer' ? 'distance' : 'melee', skillLevel: skill, level: stats.level, abilityMultiplier: ability.defaultParameters?.powerMultiplier ?? 1, variance: rollVariance(() => this.nextCombatRandom(attacker, now)) });
    const critical = rollCritical(stats.criticalChance, () => this.nextCombatRandom(attacker, now + 1));
    const damage = calculateMitigatedDamage({ damage: critical ? calculateCritical(raw, stats.criticalDamage) : raw, damageType: ability.damageType ?? 'physical', target: this.targetCombatStats(target), damageTakenModifier: resolveDamageAffinity(this.targetCombatStats(target).damageAffinities, ability.damageType ?? 'physical').modifier, immune: resolveDamageAffinity(this.targetCombatStats(target).damageAffinities, ability.damageType ?? 'physical').immune });
    target.health = Math.max(0, target.health - damage.finalDamage);
    this.emitCombatEvent(target, 'combat.damage', { attackerId: attacker.id, targetId: target.id, amount: damage.finalDamage, damageType: ability.damageType ?? 'physical', critical, targetHealth: target.health, delayMs: delayMs || undefined, criticalImpact: critical ? this.criticalImpactVisual() : undefined, position: { ...target.position } });
    this.emitCombatEvent(target, 'entity.health', { id: target.id, health: target.health, maxHealth: target.maxHealth });
    if (target.health <= 0 && target instanceof CreatureEntity) this.creatureKilled(attacker, target, now);
    return damage.finalDamage;
  }

  /** Broadcast de evento de combate a partir do escopo do caster (party da hunt ou mundo). */
  private emitCombatEventForPlayer(player: GamePlayer, event: string, data: unknown) {
    const run = this.hunts.getRun(player.id);
    if (run) {
      for (const id of run.memberIds) {
        const member = this.players.get(id);
        if (member?.socketId) this.emitTo(member.socketId, event, data);
      }
      return;
    }
    this.emitAll(event, data);
  }

  private enemiesInTiles(player: GamePlayer, tiles: Position[]): CreatureEntity[] {
    const set = new Set(tiles.map((t) => tileKey(t.x, t.y, t.z)));
    const run = this.hunts.getRun(player.id);
    const manager = run ? run.creatures : this.creatures;
    const out: CreatureEntity[] = [];
    for (const creature of manager.getAll()) {
      if (creature.state === 'DEAD') continue;
      if (set.has(tileKey(creature.position.x, creature.position.y, creature.position.z))) out.push(creature);
    }
    return out;
  }

  /** Tiles afetados por uma habilidade direcional (linha ou cone na direção). */
  private directionalTiles(origin: Position, direction: Direction, range: number, areaConfig: CombatAbilityDefinition['areaConfig']): Position[] {
    const delta = DIRECTION_DELTAS[direction] ?? DIRECTION_DELTAS.south;
    const shape = areaConfig?.shape ?? 'line';
    const baseWidth = Math.max(1, areaConfig?.width ?? 1);
    const tiles: Position[] = [];
    const seen = new Set<string>();
    for (let t = 1; t <= Math.max(1, range); t++) {
      const half = shape === 'cone' ? Math.max(0, Math.floor((baseWidth * t) / 2)) : Math.floor((baseWidth - 1) / 2);
      for (let s = -half; s <= half; s++) {
        const x = origin.x + delta.dx * t + -delta.dy * s;
        const y = origin.y + delta.dy * t + delta.dx * s;
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        tiles.push({ x, y, z: origin.z });
      }
    }
    return tiles;
  }

  /** Tiles afetados por uma habilidade de área em torno de um ponto (square/circle/cross). */
  private groundTiles(origin: Position, areaConfig: CombatAbilityDefinition['areaConfig']): Position[] {
    const shape = areaConfig?.shape ?? 'square';
    const width = Math.max(1, areaConfig?.width ?? 1);
    const height = Math.max(1, areaConfig?.height ?? width);
    const tiles: Position[] = [];
    if (shape === 'cross') {
      tiles.push({ x: origin.x, y: origin.y, z: origin.z });
      const r = Math.max(1, Math.floor(width / 2));
      for (let i = 1; i <= r; i++) {
        tiles.push({ x: origin.x + i, y: origin.y, z: origin.z });
        tiles.push({ x: origin.x - i, y: origin.y, z: origin.z });
        tiles.push({ x: origin.x, y: origin.y + i, z: origin.z });
        tiles.push({ x: origin.x, y: origin.y - i, z: origin.z });
      }
      return tiles;
    }
    if (shape === 'circle') {
      const radius = Math.max(1, Math.floor(width / 2));
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.hypot(dx, dy) > radius + 0.01) continue;
          tiles.push({ x: origin.x + dx, y: origin.y + dy, z: origin.z });
        }
      }
      return tiles;
    }
    const offsetX = Math.floor((width - 1) / 2);
    const offsetY = Math.floor((height - 1) / 2);
    for (let dy = 0; dy < height; dy++) {
      for (let dx = 0; dx < width; dx++) {
        tiles.push({ x: origin.x + dx - offsetX, y: origin.y + dy - offsetY, z: origin.z });
      }
    }
    return tiles;
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
    if (projectileVisual && (projectileVisual.projectile || projectileVisual.impact)) {
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
      criticalImpact: attack.critical ? this.criticalImpactVisual() : undefined,
      position: { ...target.position },
    });
    this.emitCombatEvent(target, 'entity.health', { id: target.id, health: target.health, maxHealth: target.maxHealth });
    return true;
  }

  private resolveProjectileVisual(weaponItem: ItemDefinition | undefined, ammoItem: ItemDefinition | undefined): ItemVisualEffects | null {
    const weaponType = weaponItem?.weapon?.weaponType;
    if (weaponType === 'bow' || weaponType === 'crossbow') return this.resolveVisualFromItem(ammoItem);
    return this.resolveVisualFromItem(weaponItem);
  }

  /** Resolve o visual de um item a partir do catálogo (fallback: visual inline). */
  private resolveVisualFromItem(item: ItemDefinition | undefined): ItemVisualEffects | null {
    if (!item) return null;
    const shootType = getShootType(item.shootTypeId);
    const effectType = getEffectType(item.effectTypeId);
    const projectile = shootType?.projectile ?? item.visual?.projectile;
    const impact = effectType?.impact ?? item.visual?.impact;
    if (!projectile && !impact) return null;
    return { projectile, impact };
  }

  /** Resolve o visual de uma habilidade a partir do catálogo (fallback: visual inline). */
  private resolveAbilityVisual(ability: CombatAbilityDefinition): ItemVisualEffects | undefined {
    const shootType = getShootType(ability.shootTypeId ?? undefined);
    const effectType = getEffectType(ability.effectTypeId ?? undefined);
    const projectile = shootType?.projectile ?? ability.visual?.projectile;
    const impact = effectType?.impact ?? ability.visual?.impact;
    if (!projectile && !impact) return undefined;
    return { projectile, impact };
  }

  /** Visual do impacto de dano crítico (catálogo de efeitos, slug `critical`). */
  private criticalImpactVisual(): ItemImpactVisual | undefined {
    return getEffectTypeBySlug('critical')?.impact;
  }

  private projectileTravelTimeMs(from: Position, to: Position, visual: ItemVisualEffects): number {
    const dx = (to.x - from.x) * 32;
    const dy = (to.y - from.y) * 32;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const speed = visual.projectile?.speedPxPerSecond || DEFAULT_PROJECTILE_SPEED_PX_PER_SECOND;
    return Math.round((distance / speed) * 1000);
  }

  private creatureAttackWithAbility(creature: CreatureEntity, playerId: string, amount: number, critical: boolean, now: number) {
    const creatureId = creature.definition.creatureId;
    const assignments = creatureId ? (this.monsterAbilities.get(creatureId) ?? []) : [];
    const primary = this.players.get(playerId);
    if (assignments.length === 0) {
      this.creatureAttackPlayer(creature, playerId, amount, critical, now);
      return;
    }
    const ready = this.monsterAbilityReadyAt.get(creature.id) ?? new Map<number, number>();
    for (const spell of assignments) {
      const ability = spell.ability;
      if (now < (ready.get(ability.abilityId) ?? 0)) continue;
      if (this.nextCombatRandomForId(creature.id, now) >= spell.chance) continue;
      ready.set(ability.abilityId, now + (spell.cooldownOverrideMs ?? ability.cooldownMs));
      this.monsterAbilityReadyAt.set(creature.id, ready);
      const damageType = ability.damageType ?? 'physical';
      const power = this.rollMonsterSpellDamage(creature, spell, amount, now);
      const targets = this.resolveMonsterSpellTargets(creature, ability, primary);
      if (targets.length === 0) {
        this.creatureAttackPlayer(creature, playerId, power, critical, now, damageType);
        return;
      }
      const center = primary?.position ?? creature.position;
      const delayMs = this.emitMonsterSpellProjectile(creature, ability, primary, center);
      for (const target of targets) {
        this.creatureAttackPlayer(creature, target.id, power, critical, now, damageType, delayMs);
      }
      return;
    }
    this.creatureAttackPlayer(creature, playerId, amount, critical, now);
  }

  /** Alcance de ataque efetivo da criatura (magia atribuída tem precedência). */
  private creatureAttackRange(creature: CreatureEntity): number {
    const creatureId = creature.definition.creatureId;
    const spells = creatureId ? (this.monsterAbilities.get(creatureId) ?? []) : [];
    if (spells.length === 0) return creature.definition.attackRange;
    return Math.max(creature.definition.attackRange, ...spells.map((s) => s.ability.rangeTiles));
  }

  /** Sorteia o dano bruto base da magia entre min/max (fallback: dano melee). */
  private rollMonsterSpellDamage(creature: CreatureEntity, spell: ResolvedMonsterSpell, meleeAmount: number, now: number): number {
    const params = spell.parameters ?? {};
    const min = params.minDamage;
    const max = params.maxDamage;
    if (min === undefined && max === undefined) return meleeAmount;
    const lo = min ?? max!;
    const hi = max ?? min!;
    const power = randomIntInRange(lo, hi, () => this.nextCombatRandomForId(creature.id, now + spell.ability.abilityId));
    const flat = params.flatPower ?? 0;
    const multiplier = params.powerMultiplier ?? 1;
    return Math.max(1, Math.round(power * multiplier) + Math.round(flat));
  }

  /** Resolve os alvos (players) afetados pela magia, conforme o targetMode. */
  private resolveMonsterSpellTargets(creature: CreatureEntity, ability: CombatAbilityDefinition, primary: GamePlayer | undefined): GamePlayer[] {
    if (ability.targetMode === 'area_enemy' || ability.targetMode === 'ground') {
      const center = primary?.position ?? creature.position;
      return this.playersInTiles(this.groundTiles(center, ability.areaConfig));
    }
    if (ability.targetMode === 'directional') {
      const direction = creature.facing as unknown as Direction;
      return this.playersInTiles(this.directionalTiles(creature.position, direction, ability.rangeTiles, ability.areaConfig));
    }
    return primary && primary.health > 0 ? [primary] : [];
  }

  /** Players vivos posicionados nos tiles informados (para magias de área). */
  private playersInTiles(tiles: Position[]): GamePlayer[] {
    const set = new Set(tiles.map((t) => tileKey(t.x, t.y, t.z)));
    const out: GamePlayer[] = [];
    for (const player of this.players.values()) {
      if (player.health <= 0) continue;
      if (set.has(tileKey(player.position.x, player.position.y, player.position.z))) out.push(player);
    }
    return out;
  }

  /** Emite o projétil/impacto da magia e retorna o tempo de viagem em ms. */
  private emitMonsterSpellProjectile(creature: CreatureEntity, ability: CombatAbilityDefinition, primary: GamePlayer | undefined, center: Position): number {
    const visual = this.resolveAbilityVisual(ability);
    if ((!visual?.projectile && !visual?.impact) || !primary) return 0;
    const travelTimeMs = visual.projectile ? this.projectileTravelTimeMs(creature.position, center, visual) : 0;
    this.emitCombatEvent(primary, 'combat.projectile', {
      attackerId: creature.id,
      targetId: primary.id,
      from: { ...creature.position },
      to: { ...center },
      projectile: visual.projectile,
      impact: visual.impact,
      travelTimeMs,
    });
    return travelTimeMs;
  }

  private nextCombatRandomForId(id: string, now: number): number {
    const x = Math.sin(now * 12.9898 + id.length * 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  private creatureAttackPlayer(creature: CreatureEntity, playerId: string, amount: number, critical: boolean, now: number, damageType: DamageType = 'physical', delayMs = 0) {
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
      delayMs: delayMs || undefined,
      criticalImpact: critical ? this.criticalImpactVisual() : undefined,
      position: { ...player.position },
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
    this.schedulePlayerCombat(player.id, 'attack', Math.max(now, Math.min(magicReadyAt, basicReadyAt)));
  }

  private schedulePlayerHealCheck(player: GamePlayer, now: number) {
    if ((this.healingRotations.get(player.id) ?? []).length === 0) return;
    this.schedulePlayerCombat(player.id, 'heal', Math.max(now, this.healingGroupReadyAt.get(player.id) ?? now));
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
      if (!player) continue;
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
        const run = this.hunts.getRun(event.characterId);
        if (!run) continue;
        for (const memberId of run.memberIds) {
          const member = this.players.get(memberId);
          if (member) this.processPlayerCombatAI(member, now);
        }
        this.hunts.updateRun(event.characterId, now);
        for (const memberId of run.memberIds) {
          const member = this.players.get(memberId);
          if (member) this.schedulePlayerAttackCheck(member, now);
        }
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
      if (!player) continue;
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
      if (!player) continue;
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
      if (player.socketId) {
        this.emitTo(player.socketId, 'player.moved', { position: { ...player.position }, facing: player.facing });
      } else {
        for (const id of run.memberIds) {
          const member = this.players.get(id);
          if (member?.socketId) this.emitTo(member.socketId, 'entity.moved', { id: player.id, position: { ...player.position }, facing: player.facing });
        }
      }
    }
  }

  private async processPlayerHealing(player: GamePlayer, now: number) {
    for (const slot of this.healingRotations.get(player.id) ?? []) {
      if (!slot.enabled) continue;
      const healTarget = this.resolveHealTarget(player, slot.target);
      if (!healTarget) continue;
      const hpPercent = healTarget.maxHealth > 0 ? (healTarget.health / healTarget.maxHealth) * 100 : 100;
       const potion = slot.potionId ? POTIONS[slot.potionId] : undefined;
       if (slot.position === 1 && potion || slot.position > 1 && slot.abilityId !== undefined) continue;
       if (slot.position === 2 && (!potion?.mp || potion.hp) || slot.position === 3 && (!potion?.hp || potion.mp)) continue;
      const mpPercent = healTarget.maxMana > 0 ? (healTarget.mana / healTarget.maxMana) * 100 : 100;
       const thresholdReached = potion?.mp && !potion.hp
         ? mpPercent <= slot.mpBelowPercent
         : potion?.hp && potion.mp
           ? hpPercent <= slot.hpBelowPercent || mpPercent <= slot.mpBelowPercent
           : hpPercent <= slot.hpBelowPercent;
      if (!thresholdReached) continue;
      if (slot.potionId && await this.usePotion(player, slot.potionId, healTarget)) return;
      if (slot.abilityId === undefined) continue;
      const ability = await this.abilityRegistry.get(slot.abilityId);
      const readyAt = this.abilityCooldowns.get(player.id)?.get(slot.abilityId) ?? 0;
      if (!ability || ability.category !== 'heal' || now < readyAt) continue;
      if (await this.castAbility(player, ability.abilityId, healTarget.id)) return;
    }
  }

  private resolveHealTarget(player: GamePlayer, target: 'self' | 'lowest_party_member' | 'specific_party_role'): GamePlayer | null {
    if (target === 'self') return player;
    const run = this.hunts.getRun(player.id);
    const members = run ? run.aliveMemberIds : [player.id];
    let best: GamePlayer | null = null;
    let bestPct = Infinity;
    for (const id of members) {
      const member = this.players.get(id);
      if (!member || member.health >= member.maxHealth) continue;
      const pct = member.maxHealth > 0 ? member.health / member.maxHealth : 1;
      if (pct < bestPct) {
        bestPct = pct;
        best = member;
      }
    }
    return best ?? (target === 'specific_party_role' ? player : null);
  }

  private async usePotion(player: GamePlayer, potionId: string, target: GamePlayer): Promise<boolean> {
    const potion = POTIONS[potionId];
    if (!potion || player.level < potion.level) return false;
    if (Date.now() < (this.potionReadyAt.get(player.id) ?? 0)) return false;
    const storage = this.storageFor(player);
    if (storage.gold < potion.price) return false;
    const hp = potion.hp ? Math.min(target.maxHealth - target.health, this.randomBetween(potion.hp[0], potion.hp[1])) : 0;
    const mp = potion.mp && target.id === player.id ? Math.min(player.maxMana - player.mana, this.randomBetween(potion.mp[0], potion.mp[1])) : 0;
    if (hp <= 0 && mp <= 0) return false;
    storage.gold -= potion.price;
     target.health += hp;
     if (mp) player.mana += mp;
     if (hp) this.emitHeal(player.id, target, hp, false, 'hp');
     if (mp) this.emitHeal(player.id, player, mp, false, 'mp');
     this.potionReadyAt.set(player.id, Date.now() + POTION_COOLDOWN_MS);
    await this.persistPlayer(player, true);
    await this.store.saveAccountStorage(storage.toStored());
    this.emitInventory(player);
    this.emitGold(player, storage.gold);
    if (target.id === player.id) this.emitStats(player);
    return true;
  }

  private randomBetween(min: number, max: number): number {
    return Math.floor(min + Math.random() * (max - min + 1));
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
        if ((slot.minTargets ?? 0) > 0 && ability.targetMode === 'area_enemy') {
          const tiles = this.groundTiles(target.position, ability.areaConfig);
          const targets = this.enemiesInTiles(player, tiles).length;
          if (targets < slot.minTargets!) continue;
        }
        if (await this.castAbility(player, ability.abilityId, target.id)) return;
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
    this.monsterAbilityReadyAt.delete(creature.id);
    const run = this.hunts.findRunByCreature(creature.id);
    const share = run
      ? splitPartyExperience(creature.definition.experience, run.aliveMemberIds.length)
      : creature.definition.experience;
    if (run) {
      run.creatures.removeCreature(creature.id);
      for (const id of run.memberIds) {
        const member = this.players.get(id);
        if (!member?.socketId) continue;
        this.emitTo(member.socketId, 'creature.remove', { creatureId: creature.id });
        if (run.aliveMemberIds.includes(id)) {
          this.emitTo(member.socketId, 'creature.death', { creatureId: creature.id, experience: share });
        }
      }
    } else {
      creature.state = 'DEAD';
      creature.health = 0;
      creature.respawnAt = now + creature.respawnTimeMs;
      creature.targetId = null;
      creature.path = [];
      this.movement.releaseEntity(creature.id);
      this.emitAll('creature.death', { creatureId: creature.id, experience: creature.definition.experience });
    }
    if (run) {
      for (const id of run.aliveMemberIds) {
        const member = this.players.get(id);
        if (member) this.grantExperience(member, share, run.memberIds);
      }
    } else {
      this.grantExperience(player, creature.definition.experience);
    }
    this.spawnLoot(creature, player, run);
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

  private grantExperience(player: GamePlayer, amount: number, viewerIds?: string[]) {
    const payload = { characterId: player.id, amount };
    if (viewerIds && viewerIds.length > 0) {
      for (const id of viewerIds) {
        const viewer = this.players.get(id);
        if (viewer?.socketId) this.emitTo(viewer.socketId, 'xp.gained', payload);
      }
    } else {
      this.emitTo(player.socketId ?? '', 'xp.gained', payload);
    }
    player.experience += amount;
    while (player.experience >= xpForLevel(player.level)) {
      player.experience -= xpForLevel(player.level);
      player.level++;
      player.attackBase = player.level + 8;
      player.defenseBase = 5 + Math.floor(player.level / 2);
      player.recomputeSpeed(getItemDef);
      player.recomputeVitals(getItemDef);
      player.health = player.maxHealth;
      player.mana = player.maxMana;
      this.emitTo(player.socketId ?? '', 'chat.message', { channel: 'local', from: 'Sistema', text: `Você subiu para o nível ${player.level}!` });
    }
    this.emitStats(player);
    this.emitCombatStats(player);
  }

  private spawnLoot(creature: CreatureEntity, player?: GamePlayer, run?: HuntRun | null) {
    const collected: string[] = [];
    let blocked = false;
    let goldCollected = 0;
    for (const entry of creature.definition.loot) {
      if (Math.random() * 100 >= entry.chance) continue;
      const def = getItemDef(entry.itemId);
      const quantity = entry.minQuantity + Math.floor(Math.random() * (entry.maxQuantity - entry.minQuantity + 1));
      if (entry.itemId === 'gold') {
        if (player) {
          const storage = this.storageFor(player);
          storage.gold += quantity;
          goldCollected += quantity;
          this.emitGold(player, storage.gold);
          this.emitTo(player.socketId ?? '', 'gold.gained', { amount: quantity, position: { ...creature.position } });
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
        if (run) {
          const leader = this.players.get(run.characterId);
          this.emitTo(leader?.socketId ?? '', 'loot.spawned', { entityId: item.id, itemId: item.itemId, name: item.name, quantity: item.quantity, position: item.position });
        } else {
          this.emitAll('loot.spawned', { entityId: item.id, itemId: item.itemId, name: item.name, quantity: item.quantity, position: item.position });
        }
        continue;
      }
      if (player) {
        if (this.addToLootPouch(this.storageFor(player), entry.itemId, quantity)) {
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
    if (player && (collected.length > 0 || blocked || goldCollected > 0)) {
      const viewers = run
        ? run.memberIds.map((id) => this.players.get(id)).filter((p): p is GamePlayer => !!p && !!p.socketId)
        : player.socketId ? [player] : [];
      for (const viewer of viewers) this.emitInventory(viewer);
      const msg = collected.length > 0 ? `Loot coletado: ${collected.join(', ')}.` : null;
      for (const viewer of viewers) {
        if (goldCollected > 0) this.emitTo(viewer.socketId ?? '', 'chat.message', { channel: 'local', from: 'Sistema', text: `Coletado ${goldCollected} gold.` });
        if (msg) this.emitTo(viewer.socketId ?? '', 'chat.message', { channel: 'local', from: 'Sistema', text: msg });
        if (blocked) this.emitTo(viewer.socketId ?? '', 'chat.message', { channel: 'local', from: 'Sistema', text: 'Bolsa de Loot cheia. Alguns itens não foram coletados.' });
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

  private async persistPlayer(player: GamePlayer, force = false) {
    const now = Date.now();
    if (!force && now - player.lastSavedAt < 5000) return;
    player.lastSavedAt = now;
    try {
      await this.store.saveCharacter(player.toStored());
      const storage = this.accountStorage.get(player.accountId);
      if (storage) await this.store.saveAccountStorage(storage.toStored());
    } catch (err) {
      this.logger.error(`Falha ao salvar ${player.name}: ${(err as Error).message}`);
    }
  }
}

import { Injectable } from '@nestjs/common';
import { uid } from '@aetheria/shared';
import { ABYSS_MAP_ID, ABYSS_META_NODES, ABYSS_SCALING_CONFIG } from '@aetheria/config';
import type { AbyssAbilityInstance, AbyssMetaView, AbyssRunView, AbyssUpgradeChoice, CombatAbilityDefinition, CombatArchetype, CreatureDefinition, Position } from '@aetheria/types';
import type { AbyssMetaProgression, AbyssRunHistory, Store } from '../store/store';
import { CreatureAIService, CreatureTarget } from '../creature/creature-ai.service';
import { CreatureEntity } from '../creature/creature.entity';
import { CreatureManager } from '../creature/creature-manager.service';
import { MovementService } from '../creature/movement.service';
import { OccupancyGrid } from '../creature/occupancy-grid';
import type { WorldMapData } from '../engine/world-map';
import type { GamePlayer } from '../engine/world';

export interface AbyssRun {
  id: string;
  accountId: string;
  characterId: string;
  startedAt: number;
  durationMs: number;
  status: AbyssRunView['status'];
  level: number;
  experience: number;
  fragments: number;
  wavesCompleted: number;
  wave: number;
  torment: number;
  characterLevel: number;
  archetype: CombatArchetype;
  seed: number;
  abilities: AbyssAbilityInstance[];
  passives: string[];
  choices: AbyssUpgradeChoice[];
  bossActive: boolean;
  nextWaveAt: number | null;
  map?: WorldMapData;
  movement?: MovementService;
  creatures?: CreatureManager;
  ai?: CreatureAIService;
}

export interface AbyssEngineHooks {
  getAbilities(): CombatAbilityDefinition[];
  emit(characterId: string, event: string, data: unknown): void;
  onFinished?(characterId: string): void;
  getMap?(mapId?: string): WorldMapData;
  getCreatureDefinitions?(): CreatureDefinition[];
  getPlayer?(characterId: string): GamePlayer | null;
  onCreatureAttackPlayer?(creature: CreatureEntity, target: CreatureTarget, amount: number, critical: boolean, now: number): void;
}

const DURATION_MS = 10 * 60 * 1000;
const XP_BASE = 100;
const STARTER_CREATURE_SLUGS = ['troll', 'goblin'] as const;
const STARTER_WAVE_LIMIT = 3;

const META_NODES = ABYSS_META_NODES;

@Injectable()
export class AbyssEngine {
  private readonly runs = new Map<string, AbyssRun>();

  constructor(private readonly store: Store, private readonly hooks: AbyssEngineHooks) {}

  getRun(characterId: string): AbyssRun | null {
    return this.runs.get(characterId) ?? null;
  }

  async getMeta(accountId: string): Promise<AbyssMetaView> {
    return this.toMeta(await this.store.getAbyssMeta(accountId));
  }

  async unlockMeta(accountId: string, nodeId: string): Promise<AbyssMetaView | null> {
    const node = META_NODES.find((candidate) => candidate.id === nodeId);
    if (!node) return null;
    const meta = await this.store.getAbyssMeta(accountId);
    if (meta.unlockedNodes.includes(nodeId) || meta.fragments < node.cost || (node.prerequisite && !meta.unlockedNodes.includes(node.prerequisite))) return null;
    meta.fragments -= node.cost;
    meta.unlockedNodes = [...meta.unlockedNodes, nodeId];
    await this.store.saveAbyssMeta(meta);
    return this.toMeta(meta);
  }

  start(accountId: string, characterId: string, torment = 1, archetype: CombatArchetype = 'mage', now = Date.now()): AbyssRun {
    if (this.runs.has(characterId)) throw new Error('ABYSS_RUN_ALREADY_ACTIVE');
    const player = this.hooks.getPlayer?.(characterId);
    const run: AbyssRun = {
      id: uid('abyss'),
      accountId,
      characterId,
      startedAt: now,
      durationMs: DURATION_MS,
      status: 'active',
      level: 1,
      experience: 0,
      fragments: 0,
      wavesCompleted: 0,
      wave: 1,
      torment: Math.max(1, Math.min(20, Math.floor(torment))),
      characterLevel: Math.max(1, player?.level ?? 1),
      archetype,
      seed: (now ^ characterId.length) >>> 0,
      abilities: [],
      passives: [],
      choices: [],
      bossActive: false,
      nextWaveAt: null,
      map: this.hooks.getMap?.(ABYSS_MAP_ID),
    };
    this.initializeCreatures(run);
    if (player && run.map && run.movement) {
      run.movement.releaseEntity(characterId);
      const center = { x: Math.floor(run.map.width / 2), y: Math.floor(run.map.height / 2), z: run.map.z };
      player.position = run.movement.nearestWalkable(center) ?? center;
      run.movement.occupy(player.position, characterId);
      player.moveDir = null;
      player.targetId = null;
      player.health = player.maxHealth;
      player.mana = player.maxMana;
    }
    const starter = this.hooks.getAbilities().find((ability) => ability.enabled && ['player', 'both'].includes(ability.ownerType) && ability.category === 'attack' && (ability.playerClass === archetype || ability.playerClass === 'all' || ability.playerClass === undefined));
    if (starter) run.abilities.push({ abilityId: starter.abilityId, level: 1, damageMultiplier: 1, cooldownMultiplier: 1, areaBonus: 0 });
    this.runs.set(characterId, run);
    this.hooks.emit(characterId, 'abyss.started', { abyss: this.view(run, now) });
    return run;
  }

  spawnInitialWave(characterId: string): void {
    const run = this.runs.get(characterId);
    if (!run || run.status !== 'active' || run.creatures?.size) return;
    this.spawnWave(run, 1);
  }

  stop(characterId: string, now = Date.now()): void {
    const run = this.runs.get(characterId);
    if (!run) return;
    this.finish(run, 'abandoned', now);
  }

  defeat(characterId: string, now = Date.now()): void {
    const run = this.runs.get(characterId);
    if (run) this.finish(run, 'defeated', now);
  }

  chooseUpgrade(characterId: string, choiceId: string, now = Date.now()): AbyssRun | null {
    const run = this.runs.get(characterId);
    const choice = run?.choices.find((candidate) => candidate.id === choiceId);
    if (!run || run.status !== 'level_up' || !choice) return null;
    this.applyChoice(run, choice);
    run.choices = [];
    run.status = 'active';
    this.hooks.emit(characterId, 'abyss.upgradeSelected', { abyss: this.view(run, now) });
    return run;
  }

  tick(now = Date.now()): void {
    for (const run of this.runs.values()) {
      if (run.status !== 'active') continue;
      const elapsed = now - run.startedAt;
      if (run.creatures && run.ai) run.creatures.updateCreatures(run.ai, now);
      run.bossActive = elapsed >= run.durationMs - 30_000;
      if (run.nextWaveAt !== null && now >= run.nextWaveAt) {
        run.nextWaveAt = null;
        this.spawnWave(run, run.wave);
      }
      if (elapsed >= run.durationMs) {
        this.finish(run, 'completed', now);
        continue;
      }
      this.hooks.emit(run.characterId, 'abyss.state', { abyss: this.view(run, now) });
    }
  }

  grantExperience(characterId: string, amount: number, now = Date.now()): void {
    const run = this.runs.get(characterId);
    if (!run || run.status !== 'active') return;
    run.experience += Math.max(0, Math.floor(amount));
    const need = this.experienceFor(run.level);
    if (run.experience < need) return;
    run.experience -= need;
    run.level += 1;
    run.status = 'level_up';
    run.choices = this.rollChoices(run);
    this.hooks.emit(characterId, 'abyss.levelUp', { level: run.level, choices: run.choices });
    void now;
  }

  findRunByCreature(creatureId: string): AbyssRun | null {
    for (const run of this.runs.values()) if (run.creatures?.getCreature(creatureId)) return run;
    return null;
  }

  autoTarget(characterId: string): CreatureEntity | null {
    const run = this.runs.get(characterId);
    const player = run && this.hooks.getPlayer?.(characterId);
    if (!run || !player || !run.creatures) return null;
    let target: CreatureEntity | null = null;
    let distance = Infinity;
    for (const creature of run.creatures.getAll()) {
      if (creature.state === 'DEAD') continue;
      const next = Math.max(Math.abs(creature.position.x - player.position.x), Math.abs(creature.position.y - player.position.y));
      if (next < distance) { distance = next; target = creature; }
    }
    return target;
  }

  abilityBonus(characterId: string, abilityId: number): number {
    const run = this.runs.get(characterId);
    return run?.abilities.find((ability) => ability.abilityId === abilityId)?.damageMultiplier ?? 1;
  }

  activeAbilityIds(characterId: string): number[] {
    return this.runs.get(characterId)?.abilities.map((ability) => ability.abilityId) ?? [];
  }

  onCreatureKilled(characterId: string, creature: CreatureEntity, now = Date.now()) {
    const run = this.findRunByCreature(creature.id);
    if (!run || !run.creatures) return;
    run.creatures.removeCreature(creature.id);
    const fragments = Math.max(1, Math.ceil(creature.definition.experience / 25));
    run.fragments += fragments;
    this.emitToRun(run, 'creature.remove', { creatureId: creature.id });
    this.emitToRun(run, 'creature.death', { creatureId: creature.id, experience: creature.definition.experience });
    this.emitToRun(run, 'abyss.fragmentDrop', { amount: fragments, total: run.fragments, creatureId: creature.id });
    this.grantExperience(characterId, creature.definition.experience, now);
    if ((run.status === 'active' || run.status === 'level_up') && run.creatures.size === 0) {
      const completedWave = run.wave;
      run.wavesCompleted += 1;
      run.wave += 1;
      run.nextWaveAt = now + 1500;
      this.emitToRun(run, 'abyss.waveCompleted', { wave: completedWave, nextWave: run.wave, abyss: this.view(run, now) });
    }
  }

  private initializeCreatures(run: AbyssRun) {
    if (!this.hooks.getMap || !run.map) return;
    const occupancy = new OccupancyGrid();
    run.movement = new MovementService(run.map, (position, exceptIds) => occupancy.isOccupied(position, exceptIds), occupancy);
    run.creatures = new CreatureManager(run.movement);
    run.ai = new CreatureAIService({
      movement: run.movement,
      getPlayers: () => this.playersInRun(run),
      getPlayerById: (id) => this.playerSnapshot(run, id),
      broadcast: (event, data) => this.emitToRun(run, event, data),
      onAttackPlayer: (creature, target, amount, critical, timestamp) => this.hooks.onCreatureAttackPlayer?.(creature, target, amount, critical, timestamp),
      getCreatureAttackRange: (creature) => creature.definition.attackRange,
    }, { aggressive: true });
  }

  private spawnWave(run: AbyssRun, wave: number) {
    if (!run.creatures || !run.movement || !this.hooks.getCreatureDefinitions) return;
    const definitions = this.hooks.getCreatureDefinitions();
    if (definitions.length === 0) return;
    const count = Math.min(8, Math.max(2, 2 + Math.max(0, wave - 1)));
    const player = this.hooks.getPlayer?.(run.characterId);
    const center = player?.position ?? { x: 32, y: 32, z: run.map?.z ?? 7 };
    const starterDefinitions = definitions.filter((definition) => STARTER_CREATURE_SLUGS.includes(definition.slug as (typeof STARTER_CREATURE_SLUGS)[number]));
    const pool = wave <= STARTER_WAVE_LIMIT && starterDefinitions.length > 0 ? starterDefinitions : definitions;
    for (let index = run.creatures.size; index < count; index++) {
      const baseDefinition = pool[(wave + index) % pool.length];
      const isBoss = run.bossActive && index === 0;
      const definition = this.scaleCreatureDefinition(baseDefinition, run, wave, isBoss);
      const radius = wave === 1 ? 4 : 7 + (index % 3);
      const position: Position = { x: Math.max(1, Math.min((run.map?.width ?? 64) - 2, center.x + (index % 2 ? radius : -radius))), y: Math.max(1, Math.min((run.map?.height ?? 64) - 2, center.y + (index % 3 - 1) * radius)), z: center.z };
      const entity = run.creatures.spawnCreature(definition, run.movement.nearestWalkable(position) ?? center);
      this.emitCreatureSpawn(run, entity, isBoss);
    }
  }

  private scaleCreatureDefinition(base: CreatureDefinition, run: AbyssRun, wave: number, isBoss: boolean): CreatureDefinition {
    const scaledLevel = Math.max(1,
      run.characterLevel
      + (wave - 1) * ABYSS_SCALING_CONFIG.waveLevelStep
      + (run.torment - 1) * ABYSS_SCALING_CONFIG.tormentLevelStep,
    );
    const healthMultiplier = isBoss ? ABYSS_SCALING_CONFIG.bossHealthMultiplier : 1;
    const attackMultiplier = isBoss ? ABYSS_SCALING_CONFIG.bossAttackMultiplier : 1;
    const defenseMultiplier = isBoss ? ABYSS_SCALING_CONFIG.bossDefenseMultiplier : 1;
    const experienceMultiplier = isBoss ? ABYSS_SCALING_CONFIG.bossExperienceMultiplier : 1;
    return {
      ...base,
      level: scaledLevel,
      health: Math.round((ABYSS_SCALING_CONFIG.baseHealth + scaledLevel * ABYSS_SCALING_CONFIG.healthPerLevel) * healthMultiplier),
      maxHealth: Math.round((ABYSS_SCALING_CONFIG.baseHealth + scaledLevel * ABYSS_SCALING_CONFIG.healthPerLevel) * healthMultiplier),
      attack: Math.max(1, Math.round((ABYSS_SCALING_CONFIG.baseAttack + scaledLevel * ABYSS_SCALING_CONFIG.attackPerLevel) * attackMultiplier)),
      defense: Math.max(0, Math.round((ABYSS_SCALING_CONFIG.baseDefense + scaledLevel * ABYSS_SCALING_CONFIG.defensePerLevel) * defenseMultiplier)),
      experience: Math.max(1, Math.round((ABYSS_SCALING_CONFIG.baseExperience + scaledLevel * ABYSS_SCALING_CONFIG.experiencePerLevel) * experienceMultiplier)),
      movementSpeed: Math.max(240, ABYSS_SCALING_CONFIG.baseMovementSpeed - scaledLevel * ABYSS_SCALING_CONFIG.movementSpeedReductionPerLevel),
      attackSpeed: Math.max(600, ABYSS_SCALING_CONFIG.baseAttackSpeed - scaledLevel * ABYSS_SCALING_CONFIG.attackSpeedReductionPerLevel),
      loot: [],
    };
  }

  private emitCreatureSpawn(run: AbyssRun, entity: CreatureEntity, isBoss: boolean) {
    this.emitToRun(run, 'creature.spawn', { creatureId: entity.id, definitionId: entity.definitionId, definitionCreatureId: entity.definition.creatureId, slug: entity.definition.slug, name: entity.name, position: { ...entity.position }, facing: entity.facing, state: entity.state, health: entity.health, maxHealth: entity.maxHealth, level: entity.definition.level, viewRange: entity.definition.viewRange, chaseRange: entity.definition.chaseRange, attackRange: entity.definition.attackRange, movementSpeed: entity.definition.movementSpeed, description: entity.definition.description, isBoss });
  }

  private playersInRun(run: AbyssRun): CreatureTarget[] {
    const player = this.hooks.getPlayer?.(run.characterId);
    return player && player.health > 0 ? [this.toCreatureTarget(player)] : [];
  }

  private playerSnapshot(run: AbyssRun, id: string): CreatureTarget | null {
    const player = id === run.characterId ? this.hooks.getPlayer?.(id) : null;
    return player ? this.toCreatureTarget(player) : null;
  }

  private toCreatureTarget(player: GamePlayer): CreatureTarget {
    return { id: player.id, position: { ...player.position }, socketId: player.socketId, health: player.health, defense: player.defenseBase, archetype: player.archetype };
  }

  private emitToRun(run: AbyssRun, event: string, data: unknown) {
    this.hooks.emit(run.characterId, event, data);
  }

  private rollChoices(run: AbyssRun): AbyssUpgradeChoice[] {
    const abilities = this.hooks.getAbilities().filter((ability) => ability.enabled && ['player', 'both'].includes(ability.ownerType) && (ability.playerClass === run.archetype || ability.playerClass === 'all' || ability.playerClass === undefined));
    abilities.sort((left, right) => this.choiceScore(run, left.abilityId) - this.choiceScore(run, right.abilityId));
    const existing = new Set(run.abilities.map((ability) => ability.abilityId));
    const choices: AbyssUpgradeChoice[] = [];
    for (const ability of abilities) {
      if (choices.length >= 3) break;
      choices.push({
        id: `${run.id}:ability:${ability.abilityId}`,
        name: existing.has(ability.abilityId) ? `${ability.name} +1` : ability.name,
        description: existing.has(ability.abilityId) ? '+20% dano temporário nesta run.' : 'Adiciona uma magia existente à run.',
        rarity: existing.has(ability.abilityId) ? 'common' : 'uncommon',
        kind: existing.has(ability.abilityId) ? 'ability' : 'new_ability',
        abilityId: ability.abilityId,
        value: existing.has(ability.abilityId) ? 0.2 : undefined,
      });
    }
    while (choices.length < 3) {
      const index = choices.length;
      choices.push({ id: `${run.id}:passive:${index}`, name: ['Arcane Knowledge', 'Swift Casting', 'Vitality'][index], description: '+8% bônus temporário na run.', rarity: 'common', kind: 'passive', stat: index === 0 ? 'magic_power' : index === 1 ? 'speed' : 'max_health', value: 0.08 });
    }
    return choices;
  }

  private choiceScore(run: AbyssRun, abilityId: number): number {
    let value = (run.seed ^ (run.level * 0x9e3779b9) ^ abilityId) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
    return (value ^ (value >>> 16)) >>> 0;
  }

  private applyChoice(run: AbyssRun, choice: AbyssUpgradeChoice): void {
    if (choice.kind === 'passive') {
      run.passives.push(choice.id);
      return;
    }
    if (choice.abilityId == null) return;
    const existing = run.abilities.find((ability) => ability.abilityId === choice.abilityId);
    if (existing) {
      existing.level += 1;
      existing.damageMultiplier = Math.round((existing.damageMultiplier + (choice.value ?? 0.2)) * 1000) / 1000;
      return;
    }
    if (run.abilities.length < 4) run.abilities.push({ abilityId: choice.abilityId, level: 1, damageMultiplier: 1, cooldownMultiplier: 1, areaBonus: 0 });
  }

  private finish(run: AbyssRun, result: 'completed' | 'defeated' | 'abandoned', now: number): void {
    if (run.status === 'completed' || run.status === 'defeated' || run.status === 'abandoned') return;
    run.status = result;
    this.runs.delete(run.characterId);
    const fragments = result === 'completed' ? run.fragments : 0;
    const rewards = result === 'completed' ? ['abyss-crystal'] : [];
    void this.persistResult(run, result, fragments, rewards, now);
    this.hooks.emit(run.characterId, `abyss.${result}`, { fragments, rewards, abyss: this.view(run, now) });
    this.hooks.onFinished?.(run.characterId);
  }

  private async persistResult(run: AbyssRun, result: AbyssRunHistory['result'], fragments: number, rewards: string[], now: number) {
    const meta = await this.store.getAbyssMeta(run.accountId);
    meta.fragments += fragments;
    await this.store.saveAbyssMeta(meta);
    await this.store.recordAbyssRun({ accountId: run.accountId, characterId: run.characterId, result, durationMs: Math.max(0, now - run.startedAt), level: run.level, torment: run.torment, fragments, rewards, seed: run.seed });
  }

  view(run: AbyssRun, now = Date.now()): AbyssRunView {
    return { runId: run.id, status: run.status, startedAt: run.startedAt, durationMs: run.durationMs, elapsedMs: Math.min(run.durationMs, Math.max(0, now - run.startedAt)), level: run.level, experience: run.experience, nextLevelExperience: this.experienceFor(run.level), fragments: run.fragments, wave: run.wave, wavesCompleted: run.wavesCompleted, torment: run.torment, activeAbilities: run.abilities.map((ability) => ({ ...ability })), passiveUpgrades: [...run.passives], pendingChoices: run.choices.map((choice) => ({ ...choice })), bossActive: run.bossActive };
  }

  private experienceFor(level: number): number {
    return XP_BASE + (level - 1) * 50;
  }

  private toMeta(meta: AbyssMetaProgression): AbyssMetaView {
    return { fragments: meta.fragments, unlockedNodes: [...meta.unlockedNodes], rerolls: meta.rerolls, revives: meta.revives };
  }
}

export { META_NODES };

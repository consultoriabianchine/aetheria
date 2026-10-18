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
  metaNodes: string[];
  rerollsRemaining: number;
  revivesRemaining: number;
  passiveDamageMultiplier: number;
  passiveMagicPowerMultiplier: number;
  passiveSpeedMultiplier: number;
  passiveMaxHealthMultiplier: number;
  passiveAreaBonus: number;
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
  onEliteChest?(characterId: string): string[];
  onCreatureAttackPlayer?(creature: CreatureEntity, target: CreatureTarget, amount: number, critical: boolean, now: number): void;
}

const DURATION_MS = 10 * 60 * 1000;
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

  async getMeta(characterId: string): Promise<AbyssMetaView> {
    return this.toMeta(await this.store.getAbyssMeta(characterId));
  }

  async unlockMeta(characterId: string, nodeId: string): Promise<AbyssMetaView | null> {
    const node = META_NODES.find((candidate) => candidate.id === nodeId);
    if (!node) return null;
    const meta = await this.store.unlockAbyssMeta(characterId, nodeId, node.cost, node.prerequisite);
    return meta ? this.toMeta(meta) : null;
  }

  start(accountId: string, characterId: string, torment = 1, archetype: CombatArchetype = 'mage', now = Date.now()): AbyssRun {
    if (this.runs.has(characterId)) throw new Error('ABYSS_RUN_ALREADY_ACTIVE');
    const player = this.hooks.getPlayer?.(characterId);
    const metaNodes = [...(player?.abyssMeta?.unlockedNodes ?? [])];
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
      metaNodes,
      rerollsRemaining: metaNodes.includes('fortune.reroll') ? 1 : 0,
      revivesRemaining: metaNodes.includes('defense.revive') ? 1 : 0,
      passiveDamageMultiplier: 1,
      passiveMagicPowerMultiplier: 1,
      passiveSpeedMultiplier: 1,
      passiveMaxHealthMultiplier: 1,
      passiveAreaBonus: 0,
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
    if (metaNodes.includes('arcane.element')) {
      run.status = 'level_up';
      run.choices = this.spellChoices(run);
      if (run.choices.length === 0) run.status = 'active';
    }
    this.runs.set(characterId, run);
    this.hooks.emit(characterId, 'abyss.started', { abyss: this.view(run, now) });
    return run;
  }

  spawnInitialWave(characterId: string): void {
    const run = this.runs.get(characterId);
    if (!run || run.status !== 'active' || run.wave !== 1 || run.wavesCompleted !== 0 || run.creatures?.size) return;
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
    this.tryLevelUp(run);
    return run;
  }

  rerollChoices(characterId: string, now = Date.now()): AbyssRun | null {
    const run = this.runs.get(characterId);
    if (!run || run.status !== 'level_up' || run.rerollsRemaining <= 0) return null;
    run.rerollsRemaining -= 1;
    run.choices = this.rollChoices(run);
    this.hooks.emit(characterId, 'abyss.levelUp', { level: run.level, choices: run.choices, rerollsRemaining: run.rerollsRemaining });
    void now;
    return run;
  }

  consumeRevive(characterId: string): boolean {
    const run = this.runs.get(characterId);
    if (!run || run.status !== 'active' || run.revivesRemaining <= 0) return false;
    run.revivesRemaining -= 1;
    this.hooks.emit(characterId, 'abyss.revived', { revivesRemaining: run.revivesRemaining });
    this.hooks.emit(characterId, 'chat.message', { channel: 'system', from: 'Abismo', text: 'Second Breath ativado. Você voltou à luta.' });
    return true;
  }

  tick(now = Date.now()): void {
    for (const run of this.runs.values()) {
      if (run.status !== 'active') continue;
      const elapsed = now - run.startedAt;
      if (run.creatures && run.ai) run.creatures.updateCreatures(run.ai, now);
      if (run.status !== 'active' || this.runs.get(run.characterId) !== run) continue;
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
    this.tryLevelUp(run);
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

  runDamageMultiplier(characterId: string, magicDamage = false): number {
    const run = this.runs.get(characterId);
    if (!run) return 1;
    return run.passiveDamageMultiplier * (magicDamage ? run.passiveMagicPowerMultiplier : 1);
  }

  runSpeedMultiplier(characterId: string): number {
    return this.runs.get(characterId)?.passiveSpeedMultiplier ?? 1;
  }

  runMaxHealthMultiplier(characterId: string): number {
    return this.runs.get(characterId)?.passiveMaxHealthMultiplier ?? 1;
  }

  runAreaBonus(characterId: string): number {
    return this.runs.get(characterId)?.passiveAreaBonus ?? 0;
  }

  activeAbilityIds(characterId: string): number[] {
    return this.runs.get(characterId)?.abilities.map((ability) => ability.abilityId) ?? [];
  }

  onCreatureKilled(characterId: string, creature: CreatureEntity, now = Date.now()) {
    const run = this.findRunByCreature(creature.id);
    if (!run || !run.creatures) return;
    run.creatures.removeCreature(creature.id);
    const fragmentMultiplier = run.metaNodes.includes('fortune.drop') ? 1.05 : 1;
    const fragments = Math.max(1, Math.floor(creature.definition.experience * ABYSS_SCALING_CONFIG.fragmentDropPercent * fragmentMultiplier));
    this.emitToRun(run, 'creature.remove', { creatureId: creature.id });
    this.emitToRun(run, 'creature.death', { creatureId: creature.id, experience: creature.definition.experience });
    if (fragments > 0) {
      run.fragments += fragments;
      this.emitToRun(run, 'abyss.fragmentDrop', { amount: fragments, total: run.fragments, creatureId: creature.id });
    }
    this.grantExperience(characterId, creature.definition.experience, now);
    if ((run.status === 'active' || run.status === 'level_up') && run.creatures.size === 0) {
      const completedWave = run.wave;
      run.wavesCompleted += 1;
      run.wave += 1;
      run.nextWaveAt = now + 1500;
      if (run.metaNodes.includes('defense.shrine')) this.applyShrine(run);
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
    const creatureExperience = ABYSS_SCALING_CONFIG.creatureExperienceBase
      + (wave - 1) * ABYSS_SCALING_CONFIG.creatureExperiencePerWave
      + (run.torment - 1) * ABYSS_SCALING_CONFIG.creatureExperiencePerTorment;
    return {
      ...base,
      level: scaledLevel,
      health: Math.round((ABYSS_SCALING_CONFIG.baseHealth + scaledLevel * ABYSS_SCALING_CONFIG.healthPerLevel) * healthMultiplier),
      maxHealth: Math.round((ABYSS_SCALING_CONFIG.baseHealth + scaledLevel * ABYSS_SCALING_CONFIG.healthPerLevel) * healthMultiplier),
      attack: Math.max(1, Math.round((ABYSS_SCALING_CONFIG.baseAttack + scaledLevel * ABYSS_SCALING_CONFIG.attackPerLevel) * attackMultiplier)),
      defense: Math.max(0, Math.round((ABYSS_SCALING_CONFIG.baseDefense + scaledLevel * ABYSS_SCALING_CONFIG.defensePerLevel) * defenseMultiplier)),
      experience: Math.max(1, Math.round(creatureExperience * experienceMultiplier)),
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
    const choiceLimit = run.metaNodes.includes('offense.choice4') ? 4 : 3;
    for (const ability of abilities) {
      if (choices.length >= choiceLimit) break;
      const existingAbility = existing.has(ability.abilityId);
      const evolved = existingAbility && run.metaNodes.includes('arcane.evolutions');
      const rare = run.metaNodes.includes('offense.rare') && choices.length === 0;
      const upgradeValue = existingAbility ? (evolved ? 0.3 : rare ? 0.3 : 0.2) : undefined;
      choices.push({
        id: `${run.id}:ability:${ability.abilityId}`,
        name: existingAbility ? `${ability.name} +1` : ability.name,
        description: evolved ? '+30% dano temporário nesta run.' : existingAbility ? `${rare ? '+30%' : '+20%'} dano temporário nesta run.` : `${rare ? '+15% dano inicial.' : 'Adiciona uma magia existente à run.'}`,
        rarity: rare ? 'rare' : existingAbility ? 'common' : 'uncommon',
        kind: evolved ? 'evolution' : existingAbility ? 'ability' : 'new_ability',
        abilityId: ability.abilityId,
        value: upgradeValue,
      });
    }
    while (choices.length < choiceLimit) {
      const index = choices.length;
      const names = ['Arcane Knowledge', 'Swift Casting', 'Vitality', 'Expanded Reach'];
      const stats: AbyssUpgradeChoice['stat'][] = ['magic_power', 'speed', 'max_health', 'area'];
      const values = [0.08, 0.08, 0.08, 1];
      const descriptions = ['+8% dano mágico nesta run.', '+8% velocidade nesta run.', '+8% vida máxima nesta run.', '+1 tile de área nesta run.'];
      choices.push({ id: `${run.id}:passive:${index}`, name: names[index], description: descriptions[index], rarity: run.metaNodes.includes('offense.rare') && index === 0 ? 'rare' : 'common', kind: 'passive', stat: stats[index], value: values[index] });
    }
    return choices;
  }

  private applyShrine(run: AbyssRun) {
    const player = this.hooks.getPlayer?.(run.characterId);
    if (!player || player.health <= 0) return;
    const amount = Math.max(1, Math.ceil(player.maxHealth * 0.2));
    player.health = Math.min(player.maxHealth, player.health + amount);
    this.emitToRun(run, 'stats.update', { health: player.health, maxHealth: player.maxHealth, mana: player.mana, maxMana: player.maxMana, level: player.level, experience: player.experience, skills: player.skills });
    this.emitToRun(run, 'chat.message', { channel: 'system', from: 'Abismo', text: `Santuário de cura: +${amount} HP.` });
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
      const value = choice.value ?? 0;
      if (choice.stat === 'damage') run.passiveDamageMultiplier += value;
      if (choice.stat === 'magic_power') run.passiveMagicPowerMultiplier += value;
      if (choice.stat === 'speed') run.passiveSpeedMultiplier += value;
      if (choice.stat === 'max_health') run.passiveMaxHealthMultiplier += value;
      if (choice.stat === 'area') run.passiveAreaBonus += Math.max(0, Math.round(value));
      return;
    }
    if (choice.abilityId == null) return;
    const existing = run.abilities.find((ability) => ability.abilityId === choice.abilityId);
    if (existing) {
      existing.level += 1;
      existing.damageMultiplier = Math.round((existing.damageMultiplier + (choice.value ?? 0.2)) * 1000) / 1000;
      return;
    }
    if (run.abilities.length < 4) run.abilities.push({ abilityId: choice.abilityId, level: 1, damageMultiplier: choice.rarity === 'rare' ? 1.15 : 1, cooldownMultiplier: 1, areaBonus: 0 });
  }

  private spellChoices(run: AbyssRun): AbyssUpgradeChoice[] {
    const active = new Set(run.abilities.map((ability) => ability.abilityId));
    const abilities = this.hooks.getAbilities()
      .filter((ability) => ability.enabled && ['player', 'both'].includes(ability.ownerType) && (ability.playerClass === run.archetype || ability.playerClass === 'all' || ability.playerClass === undefined))
      .sort((left, right) => Number(active.has(left.abilityId)) - Number(active.has(right.abilityId)) || this.choiceScore(run, left.abilityId) - this.choiceScore(run, right.abilityId));
    const limit = run.metaNodes.includes('offense.choice4') ? 4 : 3;
    return abilities.slice(0, limit).map((ability, index) => {
      const existing = active.has(ability.abilityId);
      const rare = run.metaNodes.includes('offense.rare') && index === 0;
      return {
        id: `${run.id}:spell:${ability.abilityId}`,
        name: existing ? `${ability.name} +1` : ability.name,
        description: existing ? `${rare ? '+30%' : '+20%'} dano temporário nesta run.` : `${rare ? '+15% dano inicial.' : 'Adiciona esta magia à run.'}`,
        rarity: rare ? 'rare' : existing ? 'common' : 'uncommon',
        kind: existing ? 'ability' : 'new_ability',
        abilityId: ability.abilityId,
        value: existing ? (rare ? 0.3 : 0.2) : undefined,
      };
    });
  }

  private finish(run: AbyssRun, result: 'completed' | 'defeated' | 'abandoned', now: number): void {
    if (run.status === 'completed' || run.status === 'defeated' || run.status === 'abandoned') return;
    run.status = result;
    this.runs.delete(run.characterId);
    const fragments = result === 'abandoned' ? 0 : run.fragments;
    const eliteChest = result === 'completed' && run.metaNodes.includes('fortune.eliteChest') && ((run.seed ^ run.wavesCompleted) >>> 0) % 100 < 20;
    const rewards = result === 'completed'
      ? ['abyss-crystal', ...(eliteChest ? this.hooks.onEliteChest?.(run.characterId) ?? ['Elite Chest'] : [])]
      : [];
    void this.persistResult(run, result, fragments, rewards, now);
    this.hooks.emit(run.characterId, `abyss.${result}`, { fragments, rewards, abyss: this.view(run, now) });
    this.hooks.onFinished?.(run.characterId);
  }

  private async persistResult(run: AbyssRun, result: AbyssRunHistory['result'], fragments: number, rewards: string[], now: number) {
    if (fragments > 0) await this.store.addAbyssFragments(run.characterId, fragments);
    await this.store.recordAbyssRun({ accountId: run.accountId, characterId: run.characterId, result, durationMs: Math.max(0, now - run.startedAt), level: run.level, torment: run.torment, fragments, rewards, seed: run.seed });
  }

  private tryLevelUp(run: AbyssRun): boolean {
    if (run.status !== 'active') return false;
    const need = this.experienceFor(run.level, run.wave);
    if (run.experience < need) return false;
    run.experience -= need;
    run.level += 1;
    run.status = 'level_up';
    run.choices = this.rollChoices(run);
    this.hooks.emit(run.characterId, 'abyss.levelUp', { level: run.level, choices: run.choices, rerollsRemaining: run.rerollsRemaining });
    return true;
  }

  view(run: AbyssRun, now = Date.now()): AbyssRunView {
    return { runId: run.id, status: run.status, startedAt: run.startedAt, durationMs: run.durationMs, elapsedMs: Math.min(run.durationMs, Math.max(0, now - run.startedAt)), level: run.level, experience: run.experience, nextLevelExperience: this.experienceFor(run.level, run.wave), fragments: run.fragments, wave: run.wave, wavesCompleted: run.wavesCompleted, torment: run.torment, activeAbilities: run.abilities.map((ability) => ({ ...ability })), passiveUpgrades: [...run.passives], pendingChoices: run.choices.map((choice) => ({ ...choice })), bossActive: run.bossActive, rerollsRemaining: run.rerollsRemaining, revivesRemaining: run.revivesRemaining };
  }

  private experienceFor(level: number, wave = 1): number {
    const progression = this.progressionForWave(wave);
    return progression.experienceBase + Math.max(0, level - 1) * progression.experiencePerLevel;
  }

  private progressionForWave(wave: number) {
    return ABYSS_SCALING_CONFIG.progression.find((entry) => wave <= entry.maxWave) ?? ABYSS_SCALING_CONFIG.progression[ABYSS_SCALING_CONFIG.progression.length - 1];
  }

  private toMeta(meta: AbyssMetaProgression): AbyssMetaView {
    const unlocked = new Set(meta.unlockedNodes);
    return {
      fragments: meta.fragments,
      unlockedNodes: [...meta.unlockedNodes],
      rerolls: meta.rerolls,
      revives: meta.revives,
      bonuses: META_NODES
        .filter((node) => unlocked.has(node.id))
        .map((node) => ({ id: node.id, branch: node.branch, name: node.name, description: node.description, effect: node.effect })),
    };
  }
}

export { META_NODES };

import { DECISION_JITTER_MS, REPATH_JITTER_MS } from '@aetheria/config';
import { tileDistance, uid } from '@aetheria/shared';
import type { CreatureDefinition, CreatureSpawnDefinition, Position } from '@aetheria/types';
import { CreatureAIService } from './creature-ai.service';
import { CreatureEntity } from './creature.entity';
import { MovementService } from './movement.service';

/**
 * Gerencia o ciclo de vida das criaturas no mundo: spawn, remoção, consulta
 * por área, update e respawn.
 */
export class CreatureManager {
  private creatures = new Map<string, CreatureEntity>();

  constructor(private readonly movement: MovementService) {}

  get size(): number {
    return this.creatures.size;
  }

  getAll(): Iterable<CreatureEntity> {
    return this.creatures.values();
  }

  getCreature(id: string): CreatureEntity | null {
    return this.creatures.get(id) ?? null;
  }

  getCreaturesAround(position: Position, radius: number): CreatureEntity[] {
    const out: CreatureEntity[] = [];
    for (const c of this.creatures.values()) {
      if (c.state === 'DEAD') continue;
      if (c.position.z !== position.z) continue;
      if (tileDistance(c.position, position) <= radius) out.push(c);
    }
    return out;
  }

  spawnCreature(definition: CreatureDefinition, position: Position, id = uid('c'), rng?: () => number): CreatureEntity {
    const entity = new CreatureEntity(id, definition, position);
    const next = rng ?? Math.random;
    entity.decisionOffsetMs = Math.floor(next() * DECISION_JITTER_MS);
    entity.repathJitterMs = Math.floor(next() * REPATH_JITTER_MS * 2) - REPATH_JITTER_MS;
    entity.preferredSide = next() < 0.5 ? -1 : 1;
    entity.lastMoveAt = Date.now() + entity.decisionOffsetMs;
    this.creatures.set(entity.id, entity);
    this.movement.occupy(position, entity.id, {
      w: Math.max(1, definition.footprintWidth ?? 1),
      h: Math.max(1, definition.footprintHeight ?? 1),
    });
    return entity;
  }

  removeCreature(id: string): boolean {
    const removed = this.creatures.delete(id);
    if (removed) this.movement.releaseEntity(id);
    return removed;
  }

  /** Remove todas as criaturas (usado entre waves de uma hunt). */
  clear(): void {
    for (const id of this.creatures.keys()) this.movement.releaseEntity(id);
    this.creatures.clear();
  }

  /**
   * Popula o mundo a partir das definições e spawns carregados do banco.
   * Cada spawn pode instanciar até maxInstances criaturas.
   */
  seed(definitions: Map<string, CreatureDefinition>, spawns: CreatureSpawnDefinition[]): CreatureEntity[] {
    const spawned: CreatureEntity[] = [];
    for (const spawn of spawns) {
      const def = definitions.get(spawn.creatureDefinitionId);
      if (!def) continue;
      for (let i = 0; i < spawn.maxInstances; i++) {
        const pos = this.findSpawnPosition(spawn, this.creatures.keys());
        if (!pos) continue;
        const entity = this.spawnCreature(def, pos);
        entity.respawnTimeMs = spawn.respawnTime;
        spawned.push(entity);
      }
    }
    return spawned;
  }

  /** Atualiza a IA de todas as criaturas vivas. */
  nextUpdateAt(now: number): number {
    let next = now + 1000;
    for (const creature of this.creatures.values()) {
      if (creature.state === 'DEAD') { if (creature.respawnAt !== null) next = Math.min(next, creature.respawnAt); continue; }
      next = Math.min(next, Math.max(now + 50, creature.lastMoveAt));
    }
    return next;
  }

  updateCreatures(ai: CreatureAIService, now: number) {
    for (const c of this.creatures.values()) {
      if (c.state === 'DEAD') continue;
      ai.update(c, now);
    }
  }

  /**
   * Faz respawn das criaturas mortas cujo respawnAt já venceu.
   * Remove a instância antiga (onRemove) e cria uma nova no spawn (onSpawn).
   */
  processRespawns(now: number, onRemove: (id: string) => void, onSpawn: (entity: CreatureEntity) => void) {
    for (const [id, c] of this.creatures) {
      if (c.state !== 'DEAD' || !c.respawnAt || c.respawnAt > now) continue;
      this.removeCreature(id);
      onRemove(id);
      const entity = this.spawnCreature(c.definition, c.spawnPosition);
      onSpawn(entity);
    }
  }

  /** Encontra um tile livre próximo ao spawn (evita sobreposição de instâncias). */
  private findSpawnPosition(spawn: CreatureSpawnDefinition, exceptIds: Iterable<string>): Position | null {
    const base: Position = { x: spawn.x, y: spawn.y, z: spawn.z };
    const fixed = this.movement.nearestWalkable(base);
    if (!fixed) return null;
    if (this.movement.canOccupy(fixed, exceptIds)) return fixed;
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const candidate: Position = { x: fixed.x + dx, y: fixed.y + dy, z: fixed.z };
          if (this.movement.canOccupy(candidate, exceptIds)) return candidate;
        }
      }
    }
    return fixed;
  }
}
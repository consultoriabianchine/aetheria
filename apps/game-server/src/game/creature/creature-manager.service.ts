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

  spawnCreature(definition: CreatureDefinition, position: Position, id = uid('c')): CreatureEntity {
    const entity = new CreatureEntity(id, definition, position);
    this.creatures.set(entity.id, entity);
    return entity;
  }

  removeCreature(id: string): boolean {
    return this.creatures.delete(id);
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
      this.creatures.delete(id);
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
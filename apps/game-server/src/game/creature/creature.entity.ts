import type { CreatureDefinition, CreatureState, Position } from '@aetheria/types';
import { MONSTER_RESPAWN_MS } from '@aetheria/config';
import { Direction } from './direction';

/**
 * Entidade viva de uma criatura no mundo.
 * O estado lógico é autoritativo no servidor; o cliente apenas interpola
 * visualmente os eventos recebidos.
 */
export class CreatureEntity {
  id: string;
  definitionId: string;
  name: string;
  definition: CreatureDefinition;

  position: Position;
  spawnPosition: Position;

  health: number;
  maxHealth: number;

  state: CreatureState = 'IDLE';
  facing: Direction = Direction.SOUTH;

  targetId: string | null = null;
  path: Position[] = [];
  pathIndex = 0;

  lastMoveAt = 0;
  lastAttackAt = 0;
  lastPathCalcAt = 0;

  wanderSteps = 0;
  wanderStartedAt = 0;
  stuckCount = 0;
  lastChaseTargetPos: Position | null = null;

  respawnAt: number | null = null;
  respawnTimeMs = MONSTER_RESPAWN_MS;

  constructor(id: string, definition: CreatureDefinition, position: Position) {
    this.id = id;
    this.definitionId = definition.id;
    this.name = definition.name;
    this.definition = definition;
    this.position = { ...position };
    this.spawnPosition = { ...position };
    this.maxHealth = definition.maxHealth;
    this.health = definition.maxHealth;
  }

  get healthPercent(): number {
    return (this.health / Math.max(1, this.maxHealth)) * 100;
  }

  /** Posição atual (referência usada pelo pathfinding). */
  get pos(): Position {
    return this.position;
  }
}
/**
 * Tipos de dados de criaturas carregados do banco (creature_definitions,
 * creature_loot e creature_spawns). O runtime não hardcoda atributos: tudo
 * vem do PostgreSQL, com fallback para CREATURE_SEED quando o banco não está
 * disponível (dev em memória).
 */
import type { CreatureDefinition, CreatureSpawnDefinition } from '@aetheria/types';

export type { CreatureDefinition, CreatureSpawnDefinition };

/** Coleção carregada de criaturas + spawns. */
export interface CreatureData {
  definitions: Map<string, CreatureDefinition>;
  spawns: CreatureSpawnDefinition[];
}

/** Converte um CreatureDefinition (camelCase) para payload de spawn do cliente. */
export function definitionToSpawnPayload(def: CreatureDefinition) {
  return {
    definitionId: def.id,
    name: def.name,
    level: def.level,
    viewRange: def.viewRange,
    chaseRange: def.chaseRange,
    attackRange: def.attackRange,
    description: def.description,
  };
}
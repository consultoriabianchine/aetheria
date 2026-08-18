import { Injectable, Logger } from '@nestjs/common';
import type { CreatureType } from '@aetheria/types';
import { TICK_MS } from '@aetheria/config';
import { CREATURE_SEED, CREATURE_SPAWN_SEED } from '../../../data/creature-seed';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreatureData, CreatureDefinition, CreatureSpawnDefinition } from './creature-definition';

/** Arredonda a velocidade para múltiplo do TICK_MS (passos uniformes, sem "anda-e-para"). */
function snapToTick(ms: number): number {
  return Math.max(TICK_MS, Math.round(ms / TICK_MS) * TICK_MS);
}

/**
 * Carrega definições, loot e spawns de criaturas do PostgreSQL
 * (creature_definitions / creature_loot / creature_spawns).
 * Se o banco estiver indisponível, usa o seed como fallback de desenvolvimento.
 */
@Injectable()
export class CreatureDataService {
  private readonly logger = new Logger(CreatureDataService.name);

  constructor(private readonly prisma: PrismaService | null = null) {}

  async load(): Promise<CreatureData> {
    if (!this.prisma) return this.fallback();
    try {
      const rows = await this.prisma.creatureDefinition.findMany({ include: { loots: true } });
      if (rows.length === 0) return this.fallback();

      const definitions = new Map<string, CreatureDefinition>();
      for (const d of rows) {
        const gameLevel = d.game_level ?? 1;
        const maxHealth = d.game_max_health ?? d.source_hp ?? 100;
        definitions.set(d.id, {
          id: d.id,
          creatureId: d.creature_id,
          name: d.name,
          slug: d.slug,
          description: d.description,
          type: (d.type as CreatureType) ?? 'humanoid',
          level: gameLevel,
          health: maxHealth,
          maxHealth,
          attack: d.game_attack ?? Math.max(1, Math.round(gameLevel * 1.5)),
          defense: d.game_defense ?? 0,
          experience: d.game_experience ?? d.source_experience ?? 0,
          movementSpeed: snapToTick(d.game_speed ?? 400),
          attackSpeed: d.game_attack_speed ?? 1200,
          attackRange: d.game_attack_range ?? 1,
          viewRange: d.game_view_range ?? 8,
          chaseRange: d.game_chase_range ?? 12,
          fleeHealthPercent: d.game_flee_health_percent ?? 0,
          canWander: d.game_can_wander ?? true,
          canChase: d.game_can_chase ?? true,
          canFlee: d.game_can_flee ?? false,
          returnToSpawn: d.game_return_to_spawn ?? true,
          loot: d.loots
            .filter((l) => l.item_id)
            .map((l) => ({
              itemId: l.item_id as string,
              chance: l.chance ?? 50,
              minQuantity: l.min_quantity ?? 1,
              maxQuantity: l.max_quantity ?? 1,
            })),
        });
      }

      const spawnRows = await this.prisma.creatureSpawn.findMany();
      const spawns: CreatureSpawnDefinition[] = spawnRows.map((s) => ({
        creatureDefinitionId: s.creature_definition_id,
        mapId: s.map_id,
        x: s.x,
        y: s.y,
        z: s.z,
        respawnTime: s.respawn_time,
        maxInstances: s.max_instances,
      }));

      this.logger.log(`Criaturas carregadas do banco: ${definitions.size} definições, ${spawns.length} spawns.`);
      return { definitions, spawns };
    } catch (err) {
      this.logger.warn(`Banco indisponível para criaturas (${(err as Error).message}) — usando seed de fallback.`);
      return this.fallback();
    }
  }

  private fallback(): CreatureData {
    const definitions = new Map<string, CreatureDefinition>(
      CREATURE_SEED.map((c) => [c.id, c.movementSpeed === snapToTick(c.movementSpeed) ? c : { ...c, movementSpeed: snapToTick(c.movementSpeed) }]),
    );
    return { definitions, spawns: CREATURE_SPAWN_SEED };
  }
}
import { Injectable, Logger } from '@nestjs/common';
import { normalizeDamageAffinities, type CreatureAnimationConfig, type DamageAffinities } from '@aetheria/types';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatureAnimationService } from './creature-animation.service';
import { CreatureAssetService, type StoredSpriteAsset } from './creature-asset.service';

export type CreatureAnimationStatus = 'complete' | 'partial' | 'none';

export interface AdminCreatureSummary {
  creatureId: number;
  slug: string;
  name: string;
  type: string;
  status: CreatureAnimationStatus;
  hasSprite: boolean;
  hasAnimation: boolean;
  animationVersion: number | null;
  damageAffinities: DamageAffinities;
  level: number;
  health: number;
  attack: number;
  defense: number;
  experience: number;
  attackSpeed: number;
  attackRange: number;
  viewRange: number;
  chaseRange: number;
  loot: { id: string; itemId: string | null; itemName: string; chance: number; minQuantity: number; maxQuantity: number }[];
}

/**
 * Cache em memória de spritesheets/animações por criatura. Serve os endpoints
 * públicos (GET /assets/creatures/:id) e a listagem admin, e é invalidado
 * quando a Central de Comando salva algo (upload/update).
 */
@Injectable()
export class CreatureRegistry {
  private readonly logger = new Logger(CreatureRegistry.name);
  private readonly assets = new Map<number, StoredSpriteAsset | null>();
  private readonly animations = new Map<number, CreatureAnimationConfig | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly assetService: CreatureAssetService,
    private readonly animationService: CreatureAnimationService,
  ) {}

  async getAsset(creatureId: number): Promise<StoredSpriteAsset | null> {
    if (!this.assets.has(creatureId)) {
      this.assets.set(creatureId, await this.assetService.findById(creatureId));
    }
    return this.assets.get(creatureId) ?? null;
  }

  async getAnimation(creatureId: number): Promise<CreatureAnimationConfig | null> {
    if (!this.animations.has(creatureId)) {
      this.animations.set(creatureId, await this.animationService.findById(creatureId));
    }
    return this.animations.get(creatureId) ?? null;
  }

  invalidate(creatureId: number): void {
    this.assets.delete(creatureId);
    this.animations.delete(creatureId);
    this.logger.log(`Cache de sprite/animação invalidada para a criatura ${creatureId}.`);
  }

  async listCreatures(): Promise<AdminCreatureSummary[]> {
    const rows = await this.prisma.creatureDefinition.findMany({
      orderBy: { creature_id: 'asc' },
      include: { sprite_asset: true, animation_config: true, loots: true },
    });
    return rows.map((r) => this.summary(r));
  }

  async findCreature(creatureId: number): Promise<AdminCreatureSummary | null> {
    const row = await this.prisma.creatureDefinition.findUnique({
      where: { creature_id: creatureId },
      include: { sprite_asset: true, animation_config: true, loots: true },
    });
    return row ? this.summary(row) : null;
  }

  private summary(r: {
    creature_id: number;
    slug: string;
    name: string;
    type: string;
    sprite_asset: unknown | null;
    animation_config: { version: number } | null;
    damage_affinities: unknown;
    game_level: number | null;
    game_max_health: number | null;
    source_hp: number | null;
    game_attack: number | null;
    game_defense: number | null;
    game_experience: number | null;
    source_experience: number | null;
    game_attack_speed: number | null;
    game_attack_range: number | null;
    game_view_range: number | null;
    game_chase_range: number | null;
    loots: { id: string; item_id: string | null; item_name: string; chance: number | null; min_quantity: number | null; max_quantity: number | null }[];
  }): AdminCreatureSummary {
    const hasSprite = r.sprite_asset !== null;
    const hasAnimation = r.animation_config !== null;
    const status: CreatureAnimationStatus = hasSprite && hasAnimation ? 'complete' : hasSprite || hasAnimation ? 'partial' : 'none';
    return {
      creatureId: r.creature_id,
      slug: r.slug,
      name: r.name,
      type: r.type,
      status,
      hasSprite,
      hasAnimation,
      animationVersion: r.animation_config?.version ?? null,
      damageAffinities: normalizeDamageAffinities(r.damage_affinities),
      level: r.game_level ?? 1,
      health: r.game_max_health ?? r.source_hp ?? 100,
      attack: r.game_attack ?? 1,
      defense: r.game_defense ?? 0,
      experience: r.game_experience ?? r.source_experience ?? 0,
      attackSpeed: r.game_attack_speed ?? 1200,
      attackRange: r.game_attack_range ?? 1,
      viewRange: r.game_view_range ?? 8,
      chaseRange: r.game_chase_range ?? 12,
      loot: r.loots.map((loot) => ({ id: loot.id, itemId: loot.item_id, itemName: loot.item_name, chance: loot.chance ?? 0, minQuantity: loot.min_quantity ?? 1, maxQuantity: loot.max_quantity ?? 1 })),
    };
  }
}

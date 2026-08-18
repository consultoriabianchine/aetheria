import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { AppearanceColors, OutfitDefinition, OutfitCategory, OutfitBodyType } from '@aetheria/types';
import type { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';

export interface StoredSpriteAsset {
  mimeType: string;
  data: Buffer;
  checksum: string;
  width: number;
  height: number;
}

export interface StoredAnimationSet {
  name: string;
  spriteAssetId: number | null;
  config: Record<string, unknown>;
}

export interface OutfitAsset {
  sprite: StoredSpriteAsset;
  animation: StoredAnimationSet;
  mask: StoredSpriteAsset | null;
}

/** Cache de outfits + assets + animation sets (Central de Comando). */
@Injectable()
export class OutfitRegistry implements OnModuleInit {
  private readonly logger = new Logger(OutfitRegistry.name);
  private outfits = new Map<number, OutfitDefinition>();
  private animationSets = new Map<number, StoredAnimationSet>();
  private spriteAssets = new Map<number, StoredSpriteAsset>();
  private outfitAssets = new Map<number, OutfitAsset>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.warm();
  }

  async warm() {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const [sets, assets] = await Promise.all([
          this.prisma.animationSet.findMany(),
          this.prisma.spriteAsset.findMany(),
        ]);
        this.animationSets.clear();
        for (const s of sets) this.animationSets.set(s.animation_set_id, { name: s.name, spriteAssetId: s.sprite_asset_id, config: s.config as Record<string, unknown> });
        this.spriteAssets.clear();
        for (const a of assets) {
          this.spriteAssets.set(a.sprite_asset_id, { mimeType: a.mime_type, data: Buffer.from(a.data), checksum: a.checksum, width: a.image_width, height: a.image_height });
        }

        const rows = await this.prisma.outfit.findMany({ orderBy: { outfit_id: 'asc' } });
        this.outfits.clear();
        this.outfitAssets.clear();
        for (const o of rows) {
          this.outfits.set(o.outfit_id, this.toDefinition(o));
          const sprite = this.spriteAssets.get(o.sprite_asset_id);
          const animation = this.animationSets.get(o.animation_set_id);
          const mask = o.color_mask_asset_id ? this.spriteAssets.get(o.color_mask_asset_id) ?? null : null;
          if (sprite && animation) this.outfitAssets.set(o.outfit_id, { sprite, animation, mask });
        }
        this.logger.log(`OutfitRegistry carregado: ${this.outfits.size} outfit(s), ${this.animationSets.size} set(s), ${this.spriteAssets.size} asset(s).`);
        return;
      } catch (err) {
        if (attempt < 5) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        this.logger.warn(`Outfits indisponíveis (${(err as Error).message}).`);
      }
    }
  }

  getOutfit(outfitId: number): OutfitDefinition | null {
    return this.outfits.get(outfitId) ?? null;
  }

  getAnimationSet(id: number): StoredAnimationSet | null {
    return this.animationSets.get(id) ?? null;
  }

  getSpriteAsset(id: number): StoredSpriteAsset | null {
    return this.spriteAssets.get(id) ?? null;
  }

  getOutfitAsset(outfitId: number): OutfitAsset | null {
    return this.outfitAssets.get(outfitId) ?? null;
  }

  listOutfits(): OutfitDefinition[] {
    return [...this.outfits.values()];
  }

  listAnimationSets(): { id: number; name: string }[] {
    return [...this.animationSets.entries()].map(([id, s]) => ({ id, name: s.name }));
  }

  async invalidate() {
    await this.warm();
  }

  private toDefinition(o: {
    outfit_id: number;
    slug: string;
    name: string;
    description: string;
    sprite_asset_id: number;
    animation_set_id: number;
    color_mask_asset_id: number | null;
    category: string;
    body_type: string;
    supports_colors: boolean;
    supports_addons: boolean;
    default_head_color: number;
    default_primary_color: number;
    default_secondary_color: number;
    default_detail_color: number;
    available_by_default: boolean;
    premium_only: boolean;
    enabled: boolean;
    published: boolean;
    version: number;
  }): OutfitDefinition {
    const defaultColors: AppearanceColors = {
      head: o.default_head_color,
      primary: o.default_primary_color,
      secondary: o.default_secondary_color,
      detail: o.default_detail_color,
    };
    return {
      outfitId: o.outfit_id,
      slug: o.slug,
      name: o.name,
      description: o.description,
      spriteAssetId: o.sprite_asset_id,
      animationSetId: o.animation_set_id,
      colorMaskAssetId: o.color_mask_asset_id ?? undefined,
      category: o.category as OutfitCategory,
      bodyType: o.body_type as OutfitBodyType,
      supportsColors: o.supports_colors,
      supportsAddons: o.supports_addons,
      defaultColors,
      availableByDefault: o.available_by_default,
      premiumOnly: o.premium_only,
      enabled: o.enabled,
      published: o.published,
      version: o.version,
    };
  }
}

export type { Prisma };

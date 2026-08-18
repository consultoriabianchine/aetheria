import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@aetheria/database';
import { PrismaService } from '../../prisma/prisma.service';
import { OutfitRegistry } from './outfit-registry.service';

function pngDimensions(buf: Uint8Array): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export interface OutfitSaveInput {
  outfitId?: number;
  slug: string;
  name: string;
  description?: string;
  spriteAssetId: number;
  animationSetId: number;
  colorMaskAssetId?: number;
  category?: string;
  bodyType?: string;
  supportsColors?: boolean;
  supportsAddons?: boolean;
  defaultColors?: { head: number; primary: number; secondary: number; detail: number };
  availableByDefault?: boolean;
  premiumOnly?: boolean;
  enabled?: boolean;
  published?: boolean;
}

/** Persistência de outfits, sprite assets e animation sets. */
@Injectable()
export class OutfitAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OutfitRegistry,
  ) {}

  async saveOutfit(input: OutfitSaveInput) {
    if (!input.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (!input.spriteAssetId) throw new BadRequestException('spriteAssetId é obrigatório');
    if (!input.animationSetId) throw new BadRequestException('animationSetId é obrigatório');
    const slug = input.slug?.trim() || input.name.toLowerCase().replace(/\s+/g, '-');

    const data = {
      slug,
      name: input.name,
      description: input.description ?? '',
      sprite_asset_id: input.spriteAssetId,
      animation_set_id: input.animationSetId,
      color_mask_asset_id: input.colorMaskAssetId ?? null,
      category: input.category ?? 'default',
      body_type: input.bodyType ?? 'unisex',
      supports_colors: input.supportsColors ?? true,
      supports_addons: input.supportsAddons ?? false,
      default_head_color: input.defaultColors?.head ?? 0,
      default_primary_color: input.defaultColors?.primary ?? 0,
      default_secondary_color: input.defaultColors?.secondary ?? 0,
      default_detail_color: input.defaultColors?.detail ?? 0,
      available_by_default: input.availableByDefault ?? false,
      premium_only: input.premiumOnly ?? false,
      enabled: input.enabled ?? true,
      published: input.published ?? true,
    };

    if (input.outfitId) {
      const existing = await this.prisma.outfit.findUnique({ where: { outfit_id: input.outfitId } });
      if (!existing) throw new NotFoundException('Outfit não encontrado');
      await this.prisma.outfit.update({ where: { outfit_id: input.outfitId }, data });
      await this.registry.invalidate();
      return { ok: true, outfitId: existing.outfit_id };
    }
    const created = await this.prisma.outfit.create({ data });
    await this.registry.invalidate();
    return { ok: true, outfitId: created.outfit_id };
  }

  async deleteOutfit(outfitId: number) {
    const existing = await this.prisma.outfit.findUnique({ where: { outfit_id: outfitId } });
    if (!existing) throw new NotFoundException('Outfit não encontrado');
    await this.prisma.outfit.delete({ where: { id: existing.id } });
    await this.registry.invalidate();
    return { ok: true };
  }

  async saveSpriteAsset(input: { id?: number; fileName: string; mimeType: string; width: number; height: number; dataBase64: string }) {
    if (!input.dataBase64) throw new BadRequestException('dataBase64 é obrigatório');
    const data = new Uint8Array(Buffer.from(input.dataBase64, 'base64'));
    const checksum = createHash('sha256').update(data).digest('hex');
    const dims = pngDimensions(data);
    const imageWidth = dims?.width ?? input.width;
    const imageHeight = dims?.height ?? input.height;

    if (input.id) {
      await this.prisma.spriteAsset.update({
        where: { sprite_asset_id: input.id },
        data: { file_name: input.fileName, mime_type: input.mimeType, file_size: data.length, image_width: imageWidth, image_height: imageHeight, data, checksum },
      });
      await this.registry.invalidate();
      return { ok: true, spriteAssetId: input.id };
    }
    const created = await this.prisma.spriteAsset.create({
      data: { file_name: input.fileName, mime_type: input.mimeType, file_size: data.length, image_width: imageWidth, image_height: imageHeight, data, checksum },
    });
    await this.registry.invalidate();
    return { ok: true, spriteAssetId: created.sprite_asset_id };
  }

  async saveAnimationSet(input: { id?: number; name: string; spriteAssetId?: number; config: Record<string, unknown> }) {
    if (!input.name?.trim()) throw new BadRequestException('Nome é obrigatório');
    if (!input.config || !Array.isArray((input.config as { animations?: unknown[] }).animations)) {
      throw new BadRequestException('config.animations é obrigatório');
    }
    if (input.id) {
      const existing = await this.prisma.animationSet.findUnique({ where: { animation_set_id: input.id } });
      if (!existing) throw new NotFoundException('AnimationSet não encontrado');
      await this.prisma.animationSet.update({
        where: { animation_set_id: input.id },
        data: { name: input.name, sprite_asset_id: input.spriteAssetId ?? null, config: input.config as unknown as Prisma.InputJsonValue, version: existing.version + 1 },
      });
      await this.registry.invalidate();
      return { ok: true, animationSetId: input.id };
    }
    const created = await this.prisma.animationSet.create({
      data: { name: input.name, sprite_asset_id: input.spriteAssetId ?? null, config: input.config as unknown as Prisma.InputJsonValue },
    });
    await this.registry.invalidate();
    return { ok: true, animationSetId: created.animation_set_id };
  }

  async grantOutfit(characterId: string, outfitId: number, source = 'admin') {
    await this.prisma.characterOutfit.upsert({
      where: { character_id_outfit_id: { character_id: characterId, outfit_id: outfitId } },
      create: { character_id: characterId, outfit_id: outfitId, source },
      update: { source },
    });
    return { ok: true };
  }

  async revokeOutfit(characterId: string, outfitId: number) {
    await this.prisma.characterOutfit.deleteMany({ where: { character_id: characterId, outfit_id: outfitId } });
    return { ok: true };
  }
}

import { Controller, Get, NotFoundException, Param, ParseIntPipe, Res, StreamableFile } from '@nestjs/common';
import { OutfitRegistry } from './outfit-registry.service';

/** Endpoints públicos de assets de outfits (imagem + config de animação). */
@Controller('assets/outfits')
export class OutfitAssetController {
  constructor(private readonly registry: OutfitRegistry) {}

  @Get(':outfitId')
  async getImage(
    @Param('outfitId', ParseIntPipe) outfitId: number,
    @Res({ passthrough: true }) res: { set(headers: Record<string, string>): void },
  ): Promise<StreamableFile> {
    const asset = this.registry.getOutfitAsset(outfitId);
    if (!asset) throw new NotFoundException('Outfit não encontrado');
    res.set({
      'Content-Type': asset.sprite.mimeType,
      'Cache-Control': 'public, max-age=3600',
      ETag: `"${asset.sprite.checksum}"`,
    });
    return new StreamableFile(asset.sprite.data, { type: asset.sprite.mimeType });
  }

  @Get(':outfitId/animation')
  getAnimation(@Param('outfitId', ParseIntPipe) outfitId: number) {
    const outfit = this.registry.getOutfit(outfitId);
    const asset = this.registry.getOutfitAsset(outfitId);
    if (!outfit || !asset) throw new NotFoundException('Outfit não encontrado');
    return {
      outfitId,
      spriteAssetId: outfit.spriteAssetId,
      supportsColors: outfit.supportsColors,
      supportsAddons: outfit.supportsAddons,
      colorMaskAssetId: outfit.colorMaskAssetId,
      defaultColors: outfit.defaultColors,
      config: asset.animation.config,
    };
  }

  @Get(':outfitId/mask')
  async getMask(
    @Param('outfitId', ParseIntPipe) outfitId: number,
    @Res({ passthrough: true }) res: { set(headers: Record<string, string>): void },
  ): Promise<StreamableFile> {
    const asset = this.registry.getOutfitAsset(outfitId);
    if (!asset?.mask) throw new NotFoundException('Máscara de cor não encontrada');
    res.set({
      'Content-Type': asset.mask.mimeType,
      'Cache-Control': 'public, max-age=3600',
      ETag: `"${asset.mask.checksum}"`,
    });
    return new StreamableFile(asset.mask.data, { type: asset.mask.mimeType });
  }
}

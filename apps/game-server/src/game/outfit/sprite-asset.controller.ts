import { Controller, Get, NotFoundException, Param, ParseIntPipe, Res, StreamableFile } from '@nestjs/common';
import { OutfitRegistry } from './outfit-registry.service';

/** Endpoint público para servir qualquer sprite asset (preview no editor). */
@Controller('assets/sprite-assets')
export class SpriteAssetController {
  constructor(private readonly registry: OutfitRegistry) {}

  @Get(':id')
  async getImage(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: { set(headers: Record<string, string>): void },
  ): Promise<StreamableFile> {
    const asset = this.registry.getSpriteAsset(id);
    if (!asset) throw new NotFoundException('Sprite asset não encontrado');
    res.set({
      'Content-Type': asset.mimeType,
      'Cache-Control': 'public, max-age=3600',
      ETag: `"${asset.checksum}"`,
    });
    return new StreamableFile(asset.data, { type: asset.mimeType });
  }
}

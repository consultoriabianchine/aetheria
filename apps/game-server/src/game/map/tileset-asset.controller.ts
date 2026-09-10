import { Controller, Get, NotFoundException, Param, ParseIntPipe, Res, StreamableFile } from '@nestjs/common';
import { TilesetRegistry } from './tileset-registry.service';

/** Endpoint público que serve a imagem (atlas) de um tileset. */
@Controller('assets/tilesets')
export class TilesetAssetController {
  constructor(private readonly registry: TilesetRegistry) {}

  @Get(':tilesetId')
  async getImage(
    @Param('tilesetId', ParseIntPipe) tilesetId: number,
    @Res({ passthrough: true }) res: { set(headers: Record<string, string>): void },
  ): Promise<StreamableFile> {
    const asset = this.registry.getTilesetAsset(tilesetId);
    if (!asset) throw new NotFoundException('Tileset não encontrado');
    res.set({
      'Content-Type': asset.mimeType,
      'Cache-Control': 'public, max-age=3600',
      ETag: `"${asset.checksum}"`,
    });
    return new StreamableFile(asset.data, { type: asset.mimeType });
  }
}

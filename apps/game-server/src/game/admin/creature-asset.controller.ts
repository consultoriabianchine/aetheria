import { Controller, Get, NotFoundException, Param, ParseIntPipe, Res, StreamableFile } from '@nestjs/common';
import { CreatureRegistry } from './creature-registry.service';

/** Endpoints públicos de assets de criaturas (imagem + config de animação). */
@Controller('assets/creatures')
export class CreatureAssetController {
  constructor(private readonly registry: CreatureRegistry) {}

  @Get(':id')
  async getImage(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: { set(headers: Record<string, string>): void },
  ): Promise<StreamableFile> {
    const asset = await this.registry.getAsset(id);
    if (!asset) throw new NotFoundException('Spritesheet não encontrada');
    res.set({
      'Content-Type': asset.mimeType,
      'Cache-Control': 'public, max-age=3600',
      ETag: `"${asset.checksum}"`,
    });
    return new StreamableFile(asset.data, { type: asset.mimeType });
  }

  @Get(':id/animation')
  async getAnimation(@Param('id', ParseIntPipe) id: number) {
    const animation = await this.registry.getAnimation(id);
    if (!animation) throw new NotFoundException('Nenhuma configuração de animação');
    return animation;
  }
}

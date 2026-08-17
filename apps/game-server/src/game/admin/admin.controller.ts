import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { CreatureAnimationService } from './creature-animation.service';
import { CreatureAssetService } from './creature-asset.service';
import { CreatureRegistry } from './creature-registry.service';

@Controller('admin/creatures')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CreatureRegistry,
    private readonly assetService: CreatureAssetService,
    private readonly animationService: CreatureAnimationService,
  ) {}

  @Get()
  list() {
    return this.registry.listCreatures();
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const summary = await this.registry.findCreature(id);
    if (!summary) throw new NotFoundException('Criatura não encontrada');
    const animation = await this.animationService.findById(id);
    const asset = await this.assetService.findById(id);
    return {
      ...summary,
      animation,
      asset: asset
        ? {
            fileName: asset.fileName,
            mimeType: asset.mimeType,
            fileSize: asset.fileSize,
            imageWidth: asset.imageWidth,
            imageHeight: asset.imageHeight,
            checksum: asset.checksum,
          }
        : null,
    };
  }

  @Post(':id/spritesheet')
  async uploadSpritesheet(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { fileName?: string; mimeType?: string; width?: number; height?: number; dataBase64?: string },
  ) {
    if (!body.dataBase64) throw new BadRequestException('dataBase64 é obrigatório');
    const asset = await this.assetService.upsert(id, {
      fileName: body.fileName ?? `${id}.png`,
      mimeType: body.mimeType ?? 'image/png',
      width: body.width ?? 0,
      height: body.height ?? 0,
      data: new Uint8Array(Buffer.from(body.dataBase64, 'base64')),
      uploadedBy: 'admin',
    });
    this.registry.invalidate(id);
    await this.audit('CREATURE_SPRITESHEET_UPLOADED', id, null, { checksum: asset.checksum, fileSize: asset.fileSize });
    return { ok: true, asset: this.meta(asset) };
  }

  @Get(':id/animation')
  async getAnimation(@Param('id', ParseIntPipe) id: number) {
    const animation = await this.animationService.findById(id);
    if (!animation) throw new NotFoundException('Nenhuma configuração de animação');
    return animation;
  }

  @Put(':id/animation')
  async putAnimation(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { config?: unknown; version?: number },
  ) {
    const before = await this.animationService.findById(id);
    const saved = await this.animationService.save(id, body.config, body.version);
    this.registry.invalidate(id);
    await this.audit('CREATURE_ANIMATION_UPDATED', id, before, saved);
    return { ok: true, animation: saved };
  }

  private meta(asset: { fileName: string; mimeType: string; fileSize: number; imageWidth: number; imageHeight: number; checksum: string }) {
    return {
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      imageWidth: asset.imageWidth,
      imageHeight: asset.imageHeight,
      checksum: asset.checksum,
    };
  }

  private async audit(action: string, entityId: number, before: unknown, after: unknown) {
    await this.prisma.adminAuditLog.create({
      data: {
        actor: 'admin',
        action,
        entity_type: 'creature',
        entity_id: String(entityId),
        before: before === null ? undefined : (before as object),
        after: after === null ? undefined : (after as object),
      },
    });
  }
}

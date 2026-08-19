import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { OutfitAdminService, type OutfitSaveInput } from './outfit-admin.service';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class OutfitAdminController {
  constructor(private readonly admin: OutfitAdminService) {}

  @Get('outfits')
  listOutfits() {
    return this.admin.listOutfits();
  }

  @Get('outfits/:outfitId')
  getOutfit(@Param('outfitId', ParseIntPipe) outfitId: number) {
    return this.admin.getOutfit(outfitId);
  }

  @Post('outfits')
  saveOutfit(@Body() body: OutfitSaveInput) {
    return this.admin.saveOutfit(body);
  }

  @Delete('outfits/:outfitId')
  deleteOutfit(@Param('outfitId', ParseIntPipe) outfitId: number) {
    return this.admin.deleteOutfit(outfitId);
  }

  @Get('animation-sets')
  listAnimationSets() {
    return this.admin.listAnimationSets();
  }

  @Get('animation-sets/:id')
  getAnimationSet(@Param('id', ParseIntPipe) id: number) {
    return this.admin.getAnimationSet(id);
  }

  @Post('animation-sets')
  saveAnimationSet(@Body() body: { id?: number; name: string; spriteAssetId?: number; config: Record<string, unknown> }) {
    return this.admin.saveAnimationSet(body);
  }

  @Post('sprite-assets')
  saveSpriteAsset(@Body() body: { id?: number; fileName: string; mimeType: string; width: number; height: number; dataBase64: string }) {
    return this.admin.saveSpriteAsset(body);
  }

  @Post('characters/:characterId/outfits/:outfitId/grant')
  grant(@Param('characterId') characterId: string, @Param('outfitId', ParseIntPipe) outfitId: number) {
    return this.admin.grantOutfit(characterId, outfitId);
  }

  @Delete('characters/:characterId/outfits/:outfitId')
  revoke(@Param('characterId') characterId: string, @Param('outfitId', ParseIntPipe) outfitId: number) {
    return this.admin.revokeOutfit(characterId, outfitId);
  }
}

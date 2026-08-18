import { Global, Module } from '@nestjs/common';
import { OutfitAdminController } from './outfit-admin.controller';
import { OutfitAdminService } from './outfit-admin.service';
import { OutfitAssetController } from './outfit-asset.controller';
import { OutfitRegistry } from './outfit-registry.service';
import { SpriteAssetController } from './sprite-asset.controller';

@Global()
@Module({
  controllers: [OutfitAdminController, OutfitAssetController, SpriteAssetController],
  providers: [OutfitAdminService, OutfitRegistry],
  exports: [OutfitRegistry],
})
export class OutfitModule {}

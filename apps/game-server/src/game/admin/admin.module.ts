import { Module } from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminController } from './admin.controller';
import { CreatureAnimationService } from './creature-animation.service';
import { CreatureAssetController } from './creature-asset.controller';
import { CreatureAssetService } from './creature-asset.service';
import { CreatureRegistry } from './creature-registry.service';
import { CombatAdminController } from './combat-admin.controller';
import { ItemAdminController } from './item-admin.controller';
import { ItemCatalogController } from '../engine/item-catalog.controller';

@Module({
  controllers: [AdminController, CreatureAssetController, CombatAdminController, ItemAdminController, ItemCatalogController],
  providers: [AdminAuthGuard, CreatureAssetService, CreatureAnimationService, CreatureRegistry],
  exports: [CreatureRegistry],
})
export class AdminModule {}

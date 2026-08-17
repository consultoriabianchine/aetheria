import { Module } from '@nestjs/common';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminController } from './admin.controller';
import { CreatureAnimationService } from './creature-animation.service';
import { CreatureAssetController } from './creature-asset.controller';
import { CreatureAssetService } from './creature-asset.service';
import { CreatureRegistry } from './creature-registry.service';

@Module({
  controllers: [AdminController, CreatureAssetController],
  providers: [AdminAuthGuard, CreatureAssetService, CreatureAnimationService, CreatureRegistry],
  exports: [CreatureRegistry],
})
export class AdminModule {}

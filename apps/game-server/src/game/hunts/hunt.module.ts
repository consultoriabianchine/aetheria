import { Global, Module } from '@nestjs/common';
import { HuntAdminController } from './hunt-admin.controller';
import { HuntAdminService } from './hunt-admin.service';
import { HuntRegistry } from './hunt-registry.service';

@Global()
@Module({
  controllers: [HuntAdminController],
  providers: [HuntAdminService, HuntRegistry],
  exports: [HuntRegistry],
})
export class HuntModule {}

import { Global, Module } from '@nestjs/common';
import { MapAdminController } from './map-admin.controller';
import { MapAdminService } from './map-admin.service';
import { MapRegistry } from './map-registry.service';

@Global()
@Module({
  controllers: [MapAdminController],
  providers: [MapAdminService, MapRegistry],
  exports: [MapRegistry],
})
export class MapModule {}

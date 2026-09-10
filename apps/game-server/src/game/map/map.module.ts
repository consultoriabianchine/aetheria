import { Global, Module } from '@nestjs/common';
import { MapAdminController } from './map-admin.controller';
import { MapAdminService } from './map-admin.service';
import { MapRegistry } from './map-registry.service';
import { TilesetAdminController } from './tileset-admin.controller';
import { TilesetAdminService } from './tileset-admin.service';
import { TilesetAssetController } from './tileset-asset.controller';
import { TilesetRegistry } from './tileset-registry.service';

@Global()
@Module({
  controllers: [MapAdminController, TilesetAdminController, TilesetAssetController],
  providers: [MapAdminService, MapRegistry, TilesetAdminService, TilesetRegistry],
  exports: [MapRegistry, TilesetRegistry],
})
export class MapModule {}

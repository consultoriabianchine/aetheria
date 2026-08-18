import { Module } from '@nestjs/common';
import { GameModule } from './game/game.module';
import { AdminModule } from './game/admin/admin.module';
import { MapModule } from './game/map/map.module';
import { HuntModule } from './game/hunts/hunt.module';
import { OutfitModule } from './game/outfit/outfit.module';

@Module({
  imports: [GameModule, AdminModule, MapModule, HuntModule, OutfitModule],
})
export class AppModule {}
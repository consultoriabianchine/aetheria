import { Module } from '@nestjs/common';
import { GameModule } from './game/game.module';
import { AdminModule } from './game/admin/admin.module';
import { MapModule } from './game/map/map.module';
import { HuntModule } from './game/hunts/hunt.module';

@Module({
  imports: [GameModule, AdminModule, MapModule, HuntModule],
})
export class AppModule {}
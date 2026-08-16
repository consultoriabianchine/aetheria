import { Module } from '@nestjs/common';
import { StoreModule } from './store/store.module';
import { GameEngine } from './engine/game-engine';
import { GameGateway } from './game.gateway';

@Module({
  imports: [StoreModule.register()],
  providers: [GameEngine, GameGateway],
})
export class GameModule {}
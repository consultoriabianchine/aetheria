import { Module } from '@nestjs/common';
import { StoreModule } from './store/store.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GameEngine } from './engine/game-engine';
import { GameGateway } from './game.gateway';

@Module({
  imports: [StoreModule.register(), PrismaModule],
  providers: [GameEngine, GameGateway],
})
export class GameModule {}
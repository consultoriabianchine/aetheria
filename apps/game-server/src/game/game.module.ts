import { Module } from '@nestjs/common';
import { StoreModule } from './store/store.module';
import { PrismaModule } from '../prisma/prisma.module';
import { GameEngine } from './engine/game-engine';
import { GameGateway } from './game.gateway';
import { AbilityRegistry } from './combat/ability-registry';
import { CharacterRotationController } from './character-rotation.controller';
import { PublicSiteController } from './public-site.controller';

@Module({
  imports: [StoreModule.register(), PrismaModule],
  controllers: [CharacterRotationController, PublicSiteController],
  providers: [GameEngine, GameGateway, AbilityRegistry],
})
export class GameModule {}

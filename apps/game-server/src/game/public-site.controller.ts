import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { GameEngine } from './engine/game-engine';
import { STORE, Store } from './store/store';
import { Inject } from '@nestjs/common';

@Controller('public')
export class PublicSiteController {
  constructor(private readonly engine: GameEngine, @Inject(STORE) private readonly store: Store) {}

  @Get('stats')
  async stats() {
    return {
      online: true,
      playersOnline: this.engine.getOnlinePlayerCount(),
      accountsCreated: await this.store.countAccounts(),
    };
  }

  @Get('leaderboard')
  async leaderboard(@Query('limit') limit?: string) {
    return this.store.listTopCharacters(this.parseLimit(limit, 10));
  }

  @Get('characters/search')
  async search(@Query('q') query?: string, @Query('limit') limit?: string) {
    const normalized = query?.trim() ?? '';
    if (normalized.length < 2) throw new BadRequestException('Informe pelo menos 2 caracteres.');
    return this.store.searchPublicCharacters(normalized, this.parseLimit(limit, 8));
  }

  private parseLimit(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? '', 10);
    return Math.min(20, Math.max(1, Number.isFinite(parsed) ? parsed : fallback));
  }
}

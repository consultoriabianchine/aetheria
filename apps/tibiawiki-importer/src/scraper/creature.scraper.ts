import type { TibiaWikiHttpClient } from '../http/tibiawiki-http.client';
import { CreatureParser } from '../parser/creature.parser';
import type { RawCreatureData } from '../types/scraper.types';
import { Logger } from '../utils/logger';

export interface ScrapedCreature {
  html: string;
  data: RawCreatureData;
}

/** Baixa e parseia uma página individual de criatura. */
export class CreatureScraper {
  constructor(
    private readonly http: TibiaWikiHttpClient,
    private readonly parser: CreatureParser = new CreatureParser(),
    private readonly logger: Logger,
  ) {}

  async scrape(url: string, category: string | null): Promise<ScrapedCreature> {
    this.logger.debug('creature', `Baixando ${url}`);
    const html = await this.http.getText(url);
    const data = this.parser.parse(html, url, category);
    return { html, data };
  }
}
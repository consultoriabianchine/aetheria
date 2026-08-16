import type { TibiaWikiHttpClient } from '../http/tibiawiki-http.client';
import { CategoryParser } from '../parser/category.parser';
import type { CreatureLink } from '../types/scraper.types';
import { Logger } from '../utils/logger';

const MAX_PAGES = 50;

/**
 * Descobre as criaturas de uma categoria, seguindo a paginação da MediaWiki.
 */
export class CategoryScraper {
  constructor(
    private readonly http: TibiaWikiHttpClient,
    private readonly parser: CategoryParser = new CategoryParser(),
    private readonly logger: Logger,
  ) {}

  async scrape(categoryUrl: string): Promise<CreatureLink[]> {
    const links: CreatureLink[] = [];
    const seen = new Set<string>();
    let current: string | null = categoryUrl;
    let page = 0;

    while (current && page < MAX_PAGES) {
      this.logger.debug('category', `Baixando página ${page + 1}: ${current}`);
      const html = await this.http.getText(current);
      for (const link of this.parser.parse(html, categoryUrl)) {
        if (!seen.has(link.url)) {
          seen.add(link.url);
          links.push(link);
        }
      }
      current = this.parser.findNextPageUrl(html, current);
      page++;
    }

    return links;
  }
}
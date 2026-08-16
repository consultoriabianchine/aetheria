import * as cheerio from 'cheerio';
import type { TibiaWikiHttpClient } from '../http/tibiawiki-http.client';
import { normalizeWhitespace } from '../normalization/text.normalizer';
import { Logger } from '../utils/logger';
import { imageExtension, originalImageUrl, resolveAssetUrl } from '../parser/wiki-url';

export interface ScrapedItem {
  name: string;
  imageUrl: string | null;
  description: string | null;
}

/** Baixa e extrai dados mínimos de uma página de item (opcional). */
export class ItemScraper {
  constructor(
    private readonly http: TibiaWikiHttpClient,
    private readonly logger: Logger,
  ) {}

  async scrape(url: string): Promise<ScrapedItem> {
    this.logger.debug('item', `Baixando ${url}`);
    const html = await this.http.getText(url);
    const $ = cheerio.load(html);
    const name = normalizeWhitespace($('#firstHeading').first().text()) || url;
    const img = $('table.infobox img').first().attr('src');
    const imageUrl = img ? this.original(img) : null;
    const description = normalizeWhitespace($('p').first().text()) || null;
    return { name, imageUrl, description };
  }

  private original(src: string): string | null {
    const resolved = resolveAssetUrl(src);
    if (!resolved) return null;
    const original = originalImageUrl(resolved);
    return imageExtension(original) ? original : null;
  }
}
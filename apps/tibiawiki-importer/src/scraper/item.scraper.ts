import * as cheerio from 'cheerio';
import type { TibiaWikiHttpClient } from '../http/tibiawiki-http.client';
import { normalizeWhitespace } from '../normalization/text.normalizer';
import { Logger } from '../utils/logger';
import { imageExtension, originalImageUrl, resolveAssetUrl } from '../parser/wiki-url';

export interface ScrapedItem {
  name: string;
  imageUrl: string | null;
  description: string | null;
  weight: number;
  armor: number;
  attack: number;
  defense: number;
  sellValue: number;
  stackable: boolean;
  category: string;
  type: string;
  slot: string | null;
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
    const fields = new Map<string, string>();
    $('table.infobox tr').each((_, row) => {
      const cells = $(row).find('th, td');
      if (cells.length < 2) return;
      const key = normalizeWhitespace($(cells[0]).text()).toLowerCase().replace(/[:：]/g, '');
      const value = normalizeWhitespace($(cells[1]).text());
      if (key && value) fields.set(key, value);
    });
    const number = (...keys: string[]) => {
      const value = keys.map((key) => fields.get(key)).find(Boolean);
      if (!value) return 0;
      const cleaned = value.replace(/\s/g, '');
      const numeric = keys.includes('weight') || keys.includes('peso')
        ? cleaned.replace(',', '.')
        : cleaned.replace(/[.,]/g, '');
      const match = numeric.match(/-?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : 0;
    };
    const category = fields.get('primarytype') ?? fields.get('itemclass') ?? 'Outros';
    const typeInfo = this.typeInfo(category);
    return {
      name,
      imageUrl,
      description,
      weight: number('weight', 'peso'),
      armor: number('armor', 'armadura'),
      attack: number('attack', 'ataque'),
      defense: number('defense', 'defesa'),
      sellValue: number('npcvalue', 'valor'),
      stackable: /^(sim|yes|true)$/i.test(fields.get('stackable') ?? ''),
      category,
      type: typeInfo.type,
      slot: typeInfo.slot,
    };
  }

  private typeInfo(category: string): { type: string; slot: string | null } {
    const value = category.toLowerCase();
    if (value.includes('capacete')) return { type: 'helmet', slot: 'head' };
    if (value.includes('armadura')) return { type: 'armor', slot: 'armor' };
    if (value.includes('escudo')) return { type: 'shield', slot: 'shield' };
    if (value.includes('calça')) return { type: 'legs', slot: 'legs' };
    if (value.includes('bota')) return { type: 'boots', slot: 'boots' };
    if (value.includes('anel')) return { type: 'ring', slot: 'ring' };
    if (value.includes('amuleto') || value.includes('colar')) return { type: 'amulet', slot: 'amulet' };
    if (value.includes('espada') || value.includes('machado') || value.includes('clava') || value.includes('distância')) return { type: 'weapon', slot: 'weapon' };
    if (value.includes('comida') || value.includes('poção') || value.includes('runa') || value.includes('munição')) return { type: 'consumable', slot: null };
    return { type: 'loot', slot: null };
  }

  private original(src: string): string | null {
    const resolved = resolveAssetUrl(src);
    if (!resolved) return null;
    const original = originalImageUrl(resolved);
    return imageExtension(original) ? original : null;
  }
}

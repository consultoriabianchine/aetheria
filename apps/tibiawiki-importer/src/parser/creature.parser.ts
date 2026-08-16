import * as cheerio from 'cheerio';
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { normalizeWhitespace } from '../normalization/text.normalizer';
import type { RawCreatureData } from '../types/scraper.types';
import { AssetParser } from './asset.parser';
import { titleFromUrl } from './category.parser';
import { LootParser } from './loot.parser';
import { StatsParser } from './stats.parser';
import { normalizeWikiUrl } from './wiki-url';

const WIKI_BASE = 'https://www.tibiawiki.com.br';

/**
 * Parser de uma página individual de criatura: nome, infobox (HP/XP/charms/
 * dificuldade), imagem principal, loot e descrição.
 */
export class CreatureParser {
  private readonly assetParser = new AssetParser();
  private readonly statsParser = new StatsParser();
  private readonly lootParser = new LootParser();

  constructor(private readonly baseUrl = WIKI_BASE) {}

  parse(html: string, sourceUrl: string, category: string | null): RawCreatureData {
    const $ = cheerio.load(html);
    const name = normalizeWhitespace($('#firstHeading').first().text()) || titleFromUrl(sourceUrl);

    const infobox = this.assetParser.findInfobox($);
    const stats = this.statsParser.parse($, infobox);
    const assets = this.assetParser.parseAssets($, $('#mw-content-text').first());

    const lootSection = this.findSection($, ['loot']) ?? this.findLootInline($);
    const loot = lootSection ? this.lootParser.parse($, lootSection) : [];
    const description = this.extractDescription($);

    return {
      name,
      sourceUrl: normalizeWikiUrl(sourceUrl, this.baseUrl) ?? sourceUrl,
      imageUrl: assets.imageUrl,
      gifUrl: assets.gifUrl,
      hp: stats.hp,
      experience: stats.experience,
      charms: stats.charms,
      difficulty: stats.difficulty,
      difficultyRaw: stats.difficultyRaw,
      category,
      description,
      loot,
    };
  }

  /**
   * Localiza uma seção da página (ex.: "Loot") e retorna os elementos entre
   * o título e o próximo heading do mesmo nível.
   */
  private findSection($: CheerioAPI, titles: string[]): Cheerio<Element> | null {
    const content = $('#mw-content-text').first();
    const root = content.length ? content : $('body');

    let heading: Element | null = null;
    root.find('h2, h3').each((_, h) => {
      if (heading) return;
      const text = normalizeWhitespace($(h).text()).toLowerCase().replace(/\[editar\]|\[edit\]/g, '').trim();
      if (titles.includes(text)) heading = h;
    });
    if (!heading) return null;

    const container = $('<div></div>');
    let el = $(heading).next();
    let guard = 0;
    while (el.length && guard < 400) {
      const tag = String(el.prop('tagName') ?? '');
      if (tag === 'H2' || tag === 'H3') break;
      container.append(el.clone());
      el = el.next();
      guard++;
    }
    return container.children().length ? (container as Cheerio<Element>) : null;
  }

  /**
   * Formato da TibiaWiki pt: o loot é inline (`<b>Loot:</b>`) sem heading.
   * Localiza o rótulo e retorna a tabela agrupada por raridade ao lado.
   */
  private findLootInline($: CheerioAPI): Cheerio<Element> | null {
    const content = $('#mw-content-text').first();
    if (!content.length) return null;
    const label = content
      .find('b')
      .filter((_, el) => normalizeWhitespace($(el).text()).toLowerCase().replace(/:$/, '') === 'loot')
      .first();
    if (!label.length) return null;
    const row = label.closest('tr');
    if (!row.length) return null;
    const table = row.find('table').first();
    return table.length ? (table as Cheerio<Element>) : null;
  }

  /** Primeiro parágrafo introdutório (antes do primeiro h2), se houver. */
  private extractDescription($: CheerioAPI): string | null {
    const content = $('#mw-content-text').first();
    let desc: string | null = null;
    let seenHeading = false;
    const root = content.length ? content : $('body');
    root.find('p, h2').each((_, el) => {
      const tag = String($(el).prop('tagName') ?? '');
      if (tag === 'H2') {
        if (!seenHeading) seenHeading = true;
        return;
      }
      if (seenHeading || desc !== null) return;
      if (tag === 'P') {
        const text = normalizeWhitespace($(el).text());
        if (!text || /^spoiler, clique para (mostrar|ver)/i.test(text)) return;
        desc = text;
      }
    });
    return desc;
  }
}
import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import {
  buildLootEntry,
  interpretLootCell,
  looksLikeQuantity,
} from '../normalization/loot.normalizer';
import { normalizeWhitespace } from '../normalization/text.normalizer';
import { parseQuantity } from './stats.parser';
import type { LootEntry, Rarity } from '../types/scraper.types';
import { normalizeWikiUrl } from './wiki-url';

const WIKI_BASE = 'https://www.tibiawiki.com.br';

const RARITY_HEADERS: Array<{ rarity: Rarity; re: RegExp }> = [
  { rarity: 'COMMON', re: /^(comum|common|always|sempre)[:：]?\s*$/i },
  { rarity: 'UNCOMMON', re: /^(incomum|uncommon)[:：]?\s*$/i },
  { rarity: 'SEMI_RARE', re: /^semi[- ]raro|semi[- ]rare[:：]?\s*$/i },
  { rarity: 'RARE', re: /^(raro|rare)[:：]?\s*$|muito raro|rar[íi]ssimo|very rare/i },
];

/**
 * Parser da seção de loot de uma página de criatura. Tolera diferenças de
 * estrutura: tabelas, listas, células combinadas (raridade + quantidade) e o
 * formato da TibiaWiki pt (agrupado por raridade, ex.: "Comum:", "Incomum:").
 */
export class LootParser {
  constructor(private readonly baseUrl = WIKI_BASE) {}

  parse($: CheerioAPI, section: Cheerio<Element>): LootEntry[] {
    const entries: LootEntry[] = [];
    const seen = new Set<string>();

    const add = (entry: LootEntry) => {
      const key = entry.itemName.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(entry);
      }
    };

    // Formato da TibiaWiki pt: linhas "Comum:/Incomum:" seguidas de itens.
    let currentRarity: Rarity = 'UNKNOWN';
    let currentRarityRaw: string | null = null;
    section.find('tr').each((_, rowEl) => {
      const $row = $(rowEl);
      const text = normalizeWhitespace($row.text());
      if (!text) return;
      const header = RARITY_HEADERS.find((h) => h.re.test(text));
      if (header) {
        currentRarity = header.rarity;
        currentRarityRaw = header.re.exec(text)?.[0].replace(/[:：]\s*$/, '') ?? null;
        return;
      }
      $row.find('a[title]').each((_, aEl) => {
        if (currentRarity === 'UNKNOWN') return;
        const $a = $(aEl);
        if ($a.hasClass('image')) return;
        const itemName = normalizeWhitespace($a.text());
        if (!itemName || /^(arquivo|file|ficheiro):/i.test(itemName)) return;
        const itemUrl = $a.attr('href') ? normalizeWikiUrl($a.attr('href')!, this.baseUrl) : null;
        const wrapper = $a.closest('span.tooltip').length ? $a.closest('span.tooltip') : $a;
        const node = wrapper.get(0);
        const prev = node ? node.prev : null;
        const qtyText = prev && prev.type === 'text' ? (prev.data ?? '') : '';
        const q = parseQuantity(qtyText);
        add(
          buildLootEntry({
            itemName,
            itemUrl,
            rarity: currentRarity,
            rarityRaw: currentRarityRaw,
            min: q.min,
            max: q.max,
            quantityRaw: normalizeWhitespace(qtyText) || null,
            chance: null,
            rawText: text,
          }),
        );
      });
    });

    // Formato clássico: tabela com cabeçalho (Item/Raridade/Quantidade).
    section.find('table tr').each((_, rowEl) => {
      const $row = $(rowEl);
      if (this.isHeaderRow($row)) return;
      const cells = $row.find('th, td').toArray().map((c) => $(c));
      if (cells.length === 0) return;

      const first = cells[0];
      const link = first.find('a').first();
      const itemName = normalizeWhitespace(link.length ? link.text() : first.text());
      if (!itemName) return;

      const itemUrl = link.attr('href') ? normalizeWikiUrl(link.attr('href')!, this.baseUrl) : null;
      const restTexts = cells.slice(1).map((c) => normalizeWhitespace(c.text()));
      const combined = restTexts.join(' | ');

      let rarity: Rarity = 'UNKNOWN';
      let rarityRaw: string | null = null;
      let min: number | null = null;
      let max: number | null = null;
      let chance: number | null = null;
      let quantityRaw: string | null = null;

      for (const t of restTexts) {
        const interp = interpretLootCell(t);
        if (interp.rarity !== 'UNKNOWN' && !rarityRaw) {
          rarity = interp.rarity;
          rarityRaw = interp.rarityRaw;
        }
        if (min === null && interp.min !== null) {
          min = interp.min;
          max = interp.max;
        }
        if (chance === null && interp.chance !== null) chance = interp.chance;
        if (looksLikeQuantity(t)) quantityRaw = t;
      }
      // A célula única pode combinar raridade + quantidade ("Common (0-21)").
      if (!rarityRaw || min === null) {
        const interp = interpretLootCell(combined);
        if (!rarityRaw) {
          rarity = interp.rarity;
          rarityRaw = interp.rarityRaw;
        }
        if (min === null && interp.min !== null) {
          min = interp.min;
          max = interp.max;
        }
        if (chance === null && interp.chance !== null) chance = interp.chance;
      }

      add(
        buildLootEntry({
          itemName,
          itemUrl,
          rarity,
          rarityRaw,
          min,
          max,
          quantityRaw,
          chance,
          rawText: [itemName, ...restTexts].filter(Boolean).join(' | '),
        }),
      );
    });

    // Formato de lista (ul/li).
    section.find('ul li').each((_, el) => {
      const $li = $(el);
      const text = normalizeWhitespace($li.text());
      if (!text) return;
      const link = $li.find('a').first();
      const itemName = normalizeWhitespace(link.length ? link.text() : text);
      if (!itemName) return;
      const itemUrl = link.attr('href') ? normalizeWikiUrl(link.attr('href')!, this.baseUrl) : null;
      const interp = interpretLootCell(text);
      add(
        buildLootEntry({
          itemName,
          itemUrl,
          rarity: interp.rarity,
          rarityRaw: interp.rarityRaw,
          min: interp.min,
          max: interp.max,
          quantityRaw: null,
          chance: interp.chance,
          rawText: text,
        }),
      );
    });

    return entries;
  }

  private isHeaderRow($row: Cheerio<Element>): boolean {
    const cells = $row.find('th, td');
    if (cells.length === 0) return true;
    const text = normalizeWhitespace($row.text()).toLowerCase();
    if (RARITY_HEADERS.some((h) => h.re.test(text))) return true;
    // Sub-seções/legendas ("Durante Eventos:") sem link de item.
    if ($row.find('a').length === 0 && /[:：]$/.test(text)) return true;
    const thCount = $row.find('th').length;
    if (/^(item|loot|raridade|rarity|quantidade|quantity|chance)\b/.test(text) && thCount > 0) return true;
    return thCount === cells.length;
  }
}
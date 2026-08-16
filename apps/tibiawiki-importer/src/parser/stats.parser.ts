import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { Difficulty } from '../types/scraper.types';
import { normalizeKey, normalizeWhitespace } from '../normalization/text.normalizer';

/**
 * Parsers de números e quantidades comuns nas páginas da Wiki.
 * "9.200" -> 9200 · "0-21" -> { min: 0, max: 21 } · "50%" -> 50
 */

/** Converte "9.200" / "9,5" / "9200" em número inteiro. Null se não houver. */
export function parseNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = String(value).match(/(\d[\d.,]*)/);
  if (!m) return null;
  const n = parseInt(m[1].replace(/[.,]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

export interface QuantityRange {
  min: number | null;
  max: number | null;
}

/**
 * "0-21" -> { min: 0, max: 21 } · "1" -> { min: 1, max: 1 } · sem número -> null.
 */
export function parseQuantity(value: string | null | undefined): QuantityRange {
  if (!value) return { min: null, max: null };
  const cleaned = value.replace(/\./g, '').replace(/,/g, '').trim();
  const range = cleaned.match(/(-?\d+)\s*(?:-|–|—|a|to)\s*(-?\d+)/i);
  if (range) {
    const min = parseInt(range[1], 10);
    const max = parseInt(range[2], 10);
    return { min, max };
  }
  const single = cleaned.match(/-?\d+/);
  if (single) {
    const v = parseInt(single[0], 10);
    return { min: v, max: v };
  }
  return { min: null, max: null };
}

/** "50%" -> 50 · "12.5%" -> 12.5 · sem "%" -> null. */
export function parseChance(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = value.replace(/\./g, '.').match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

/** Parse de raridade a partir de um texto classificado. */
export function parseRarity(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.trim() || null;
}

// ---------------------------------------------------------------------------
// Infobox (estatísticas da criatura)
// ---------------------------------------------------------------------------

export interface InfoboxStats {
  hp: number | null;
  experience: number | null;
  charms: number | null;
  difficulty: Difficulty | null;
  difficultyRaw: string | null;
}

const FIELD_KEYS: Record<'hp' | 'experience' | 'charms' | 'difficulty', string[]> = {
  hp: ['hp', 'hitpoints', 'hit points', 'vida'],
  experience: ['experience', 'exp', 'xp', 'experiencia', 'experiência'],
  charms: ['charm points', 'charm', 'charms', 'pontos de charm', 'pontos de charme'],
  difficulty: ['difficulty', 'dificuldade'],
};

/** Normaliza o texto de dificuldade da Wiki para EASY/MEDIUM/HARD/VERY_HARD/UNKNOWN. */
export function normalizeDifficulty(text: string | null | undefined): Difficulty {
  const key = normalizeKey(text);
  if (!key) return 'UNKNOWN';
  if (/muito difícil|muito dificil|very hard|extremely hard/.test(key)) return 'VERY_HARD';
  if (/(^|\s)fácil($|\s)|(^|\s)facil($|\s)|^easy$|^trivial$/.test(key)) return 'EASY';
  if (/(^|\s)médio($|\s)|(^|\s)medio($|\s)|^medium$/.test(key)) return 'MEDIUM';
  if (/(^|\s)difícil($|\s)|(^|\s)dificil($|\s)|^hard$/.test(key)) return 'HARD';
  return 'UNKNOWN';
}

/**
 * Extrai as estatísticas do infobox (HP, XP, charms e dificuldade),
 * tolerando variações de estrutura da página.
 */
export class StatsParser {
  parse($: CheerioAPI, infobox: Cheerio<Element>): InfoboxStats {
    const stats: InfoboxStats = {
      hp: null,
      experience: null,
      charms: null,
      difficulty: 'UNKNOWN',
      difficultyRaw: null,
    };
    // Formato da TibiaWiki pt: chaves em <td> com tooltip (ex.: "50 HP").
    this.parseTooltipCells($, infobox, stats);
    // Fallback para o formato clássico com <th>.
    this.parseThCells($, infobox, stats);
    return stats;
  }

  private parseTooltipCells($: CheerioAPI, infobox: Cheerio<Element>, stats: InfoboxStats): void {
    infobox.find('td').each((_, td) => {
      const $td = $(td);
      const text = normalizeWhitespace($td.text());
      const key = normalizeKey(text);
      if (stats.hp === null && /(^|\s)(hp|hit points?|vida)($|\s)/.test(key)) {
        stats.hp = parseNumber(text);
      }
      if (stats.experience === null && /(^|\s)(xp|exp|experi[eê]ncia|experience)($|\s)/.test(key)) {
        stats.experience = parseNumber(text);
      }
      if (stats.charms === null && /(^|\s)charm(s)?($|\s)/.test(key)) {
        stats.charms = parseNumber(text);
      }
      if (stats.difficultyRaw === null) {
        const cyclopedia = $td.find('a[title="Cyclopedia"]');
        if (cyclopedia.length > 0) {
          const label = normalizeWhitespace($td.find('span.tooltip').first().text()) || text;
          stats.difficultyRaw = label;
          stats.difficulty = normalizeDifficulty(label);
        }
      }
    });
  }

  private parseThCells($: CheerioAPI, infobox: Cheerio<Element>, stats: InfoboxStats): void {
    infobox.find('tr').each((_, tr) => {
      const $tr = $(tr);
      const th = $tr.find('th').first();
      if (th.length === 0) return;
      const key = normalizeKey(th.text());
      const td = $tr.find('td').first();
      const value = normalizeWhitespace(td.length ? td.text() : th.next().text());
      if (stats.hp === null && FIELD_KEYS.hp.includes(key)) stats.hp = parseNumber(value);
      if (stats.experience === null && FIELD_KEYS.experience.includes(key)) stats.experience = parseNumber(value);
      if (stats.charms === null && FIELD_KEYS.charms.includes(key)) stats.charms = parseNumber(value);
      if (stats.difficultyRaw === null && FIELD_KEYS.difficulty.includes(key)) {
        stats.difficultyRaw = value;
        stats.difficulty = normalizeDifficulty(value);
      }
    });
  }
}
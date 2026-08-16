import * as cheerio from 'cheerio';
import type { CreatureLink } from '../types/scraper.types';
import { normalizeWikiUrl } from './wiki-url';

const EXCLUDED_PREFIXES = [
  'categoria:',
  'category:',
  'especial:',
  'special:',
  'anexo:',
  'talk:',
  'discussão:',
  'user:',
  'utilizador:',
  'ajuda:',
  'help:',
  'predefinição:',
  'template:',
  'arquivo:',
  'file:',
];

// Páginas frequentemente misturadas em categorias de criaturas (updates,
// quests, eventos) — não são criaturas.
const EXCLUDED_TITLE_PATTERNS = [
  /(^|[\s/:])update[s]?($|[\s/:])/i,
  /(^|[\s/:])quest(s)?($|[\s/:])/i,
  /(^|[\s/:])evento(s)?($|[\s/:])|(^|[\s/:])event(s)?($|[\s/:])/i,
  /(^|[\s/:])anivers[áa]rio(s)?($|[\s/:])/i,
  /(^|[\s/:])hist[óo]ria($|[\s/:])|(^|[\s/:])history($|[\s/:])/i,
  /^shards of a broken moon/i,
  /^preview$/i,
  /ir para (navegação|conteúdo|navegacao|conteudo|pesquisar|pesquisa)/i,
];

/** Extrai o título de uma URL de artigo ("/wiki/Boar_Man" -> "Boar Man"). */
export function titleFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop() ?? '';
    return decodeURIComponent(last).replace(/_/g, ' ');
  } catch {
    return '';
  }
}

/**
 * Parser da página de categoria: descobre os links das criaturas, normaliza
 * URLs, remove duplicados e retorna CreatureLink[].
 */
export class CategoryParser {
  parse(html: string, baseUrl: string): CreatureLink[] {
    const $ = cheerio.load(html);
    const links = new Map<string, CreatureLink>();

    const collect = (href: string | undefined, title: string | undefined, text: string) => {
      if (!href) return;
      const url = normalizeWikiUrl(href, baseUrl);
      if (!url) return;
      const decoded = titleFromUrl(url).toLowerCase();
      if (!decoded) return;
      for (const prefix of EXCLUDED_PREFIXES) {
        if (decoded.startsWith(prefix)) return;
      }
      const name = (title && title.trim() !== '' ? title : text).trim();
      if (!name) return;
      const nameLower = name.toLowerCase();
      for (const pattern of EXCLUDED_TITLE_PATTERNS) {
        if (pattern.test(decoded) || pattern.test(nameLower)) return;
      }
      if (!links.has(url)) links.set(url, { name, url });
    };

    // Conteúdo da categoria (lista paginada) — seletores alternativos.
    const containers = $('#mw-pages, #mw-categoryresults, .mw-category, .categorytree');
    if (containers.length > 0) {
      containers.find('a[href]').each((_, el) => {
        collect($(el).attr('href'), $(el).attr('title'), $(el).text());
      });
    } else {
      $('a[href]').each((_, el) => {
        collect($(el).attr('href'), $(el).attr('title'), $(el).text());
      });
    }

    return [...links.values()];
  }

  /** Link da próxima página da categoria (paginação da MediaWiki), se houver. */
  findNextPageUrl(html: string, baseUrl: string): string | null {
    const $ = cheerio.load(html);
    let next: string | null = null;
    const matches = /next page|pr[óo]xima|pr[óo]ximo/i;
    $('a[href]').each((_, el) => {
      const text = $(el).text();
      const href = $(el).attr('href');
      if (!href) return;
      const url = normalizeWikiUrl(href, baseUrl);
      if (!url) return;
      if (!matches.test(text) || !/pagefrom=/.test(href)) return;
      const pagefrom = new URL(href, baseUrl).searchParams.get('pagefrom');
      if (!pagefrom) return;
      const u = new URL(url);
      u.searchParams.set('pagefrom', pagefrom);
      next = u.toString();
    });
    return next;
  }
}
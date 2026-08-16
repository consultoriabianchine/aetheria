import type { Cheerio, CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { normalizeKey } from '../normalization/text.normalizer';
import { imageExtension, originalImageUrl, resolveAssetUrl } from './wiki-url';

export interface AssetResult {
  imageUrl: string | null;
  gifUrl: string | null;
}

const HP_KEYS = ['hp', 'hitpoints', 'hit points', 'vida'];
const HP_LINK_TITLES = ['hit point', 'hitpoints', 'hit points', 'hp'];

/**
 * Parser da imagem principal de uma página de criatura: detecta <img>,
 * background-image e links de arquivos; prefere a resolução original.
 */
export class AssetParser {
  /**
   * Localiza o infobox: prioriza a tabela que contém o campo HP (a TibiaWiki
   * pt usa tooltip "HP" em <td>), depois a classe .infobox e, por fim, uma
   * tabela com <th> contendo a chave HP.
   */
  findInfobox($: CheerioAPI): Cheerio<Element> {
    const hpLink = $('a[title]').filter((_, el) => {
      const title = normalizeKey($(el).attr('title'));
      return HP_LINK_TITLES.some((k) => title.includes(k) || title === k);
    }).first();
    if (hpLink.length) {
      const table = hpLink.closest('table');
      if (table.length > 0) return table as Cheerio<Element>;
    }
    const explicit = $('table.infobox').first();
    if (explicit.length > 0) return explicit;
    let found: Cheerio<Element> | null = null;
    $('table').each((_, table) => {
      const $t = $(table);
      const hasHp = $t.find('th').toArray().some((th) => {
        const key = normalizeKey($(th).text());
        return HP_KEYS.includes(key);
      });
      if (hasHp && !found) found = $t;
    });
    return found ?? $();
  }

  /** Extrai a imagem principal (maior resolução possível) da região dada. */
  parseAssets($: CheerioAPI, region: Cheerio<Element>): AssetResult {
    const candidates: string[] = [];

    region.find('img').each((_, el) => {
      const $img = $(el);
      const w = parseInt($img.attr('width') ?? '0', 10);
      const h = parseInt($img.attr('height') ?? '0', 10);
      // Ignora ícones pequenos (ex.: 13x13) usados como rótulos do infobox.
      if ((w > 0 && w < 32) || (h > 0 && h < 32)) return;
      const src = $img.attr('src');
      if (src) candidates.push(src);
    });
    region.find('[style*="background-image"]').each((_, el) => {
      const style = $(el).attr('style') ?? '';
      const m = style.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/i);
      if (m) candidates.push(m[1]);
    });
    region.find('a[href]').each((_, el) => {
      const href = $(el).attr('href') ?? '';
      if (/Special:FilePath|\/File:|Arquivo:|Ficheiro:/i.test(href)) {
        const abs = resolveAssetUrl(href);
        if (abs) candidates.push(abs);
      }
    });

    if (candidates.length === 0) return { imageUrl: null, gifUrl: null };

    const chosen = pickPrimary(candidates);
    const resolved = resolveAssetUrl(chosen);
    if (!resolved) return { imageUrl: null, gifUrl: null };
    const original = originalImageUrl(resolved);
    const isGif = imageExtension(original) === 'gif';
    return { imageUrl: original, gifUrl: isGif ? original : null };
  }
}

/**
 * Escolhe a melhor imagem entre candidatos: prefere arquivos originais
 * (não-thumbnail) e resoluções maiores.
 */
export function pickPrimary(candidates: string[]): string {
  let best = candidates[0];
  let bestScore = -Infinity;
  for (const c of candidates) {
    let score = 0;
    if (!c.includes('/thumb/')) score += 1000;
    const px = c.match(/(\d+)px-/);
    if (px) score += parseInt(px[1], 10);
    if (/\.gif/i.test(c)) score += 50;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
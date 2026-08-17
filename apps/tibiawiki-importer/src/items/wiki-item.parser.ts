/**
 * Parser do wikitext de páginas de item da TibiaWiki.
 * Extrai os campos do template {{Infobox_Item|...}} e as categorias da página.
 */

export interface WikiItemPage {
  title: string;
  pageid: number;
  /** Template do infobox: 'item' ou 'runas' ({{Infobox_Runas}}). */
  template: 'item' | 'runas';
  /** Campos do infobox já limpos (sem links/templates). */
  fields: Record<string, string>;
  /** Categorias da página ([[Categoria:...]]). */
  categories: string[];
}

function cleanValue(raw: string): string {
  let value = raw;
  // Remove templates mais internos primeiro ({{...}} sem aninhamento).
  let prev = '';
  while (prev !== value) {
    prev = value;
    value = value.replace(/\{\{[^{}]*\}\}/g, '');
  }
  // [[Page|Label]] -> Label ; [[Page]] -> Page
  value = value
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/\[\[([^\]]*)\]\]/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return value;
}

/**
 * Extrai os dados de uma página de item a partir do wikitext bruto.
 * Aceita {{Infobox_Item}} e {{Infobox_Runas}}. Retorna null se a página não
 * possuir nenhum dos dois (ex.: {{Infobox_Object}} são objetos de mundo).
 */
export function parseWikiItemPage(title: string, pageid: number, wikitext: string): WikiItemPage | null {
  const m = wikitext.search(/\{\{\s*(Infobox_Item|Infobox_Runas)\b/i);
  if (m === -1) return null;
  const template = wikitext.slice(m).match(/\{\{\s*(Infobox_Item|Infobox_Runas)\b/i)![1].toLowerCase() === 'infobox_runas' ? 'runas' : 'item';

  const fields: Record<string, string> = {};
  const lines = wikitext.slice(m).split('\n');
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '}}') break;
    const mm = line.match(/^\|\s*([^|=]+?)\s*=\s*(.*)$/);
    if (mm) fields[mm[1].trim().toLowerCase()] = cleanValue(mm[2]);
  }

  const categories = [...wikitext.matchAll(/\[\[\s*Categoria\s*:\s*([^\]]+?)\s*\]\]/gi)].map((mm) => mm[1].trim());

  return { title, pageid, template, fields, categories };
}

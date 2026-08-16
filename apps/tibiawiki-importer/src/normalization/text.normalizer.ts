/**
 * Normalização de textos extraídos da Wiki.
 */

/** Normaliza espaços em branco (quebra de linha, múltiplos espaços). */
export function normalizeWhitespace(input: string | null | undefined): string {
  if (!input) return '';
  return input.replace(/\s+/g, ' ').trim();
}

/** Normaliza um texto de célula (remove ":" ao final, espaços). */
export function normalizeCellText(input: string | null | undefined): string {
  return normalizeWhitespace(input).replace(/\s*:\s*$/g, '');
}

/** Normaliza uma chave de campo do infobox para comparação. */
export function normalizeKey(input: string | null | undefined): string {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/[:–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
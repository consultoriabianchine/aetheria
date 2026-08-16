/**
 * Utilitários de URL da MediaWiki/TibiaWiki: normalização de links, resolução
 * de caminhos relativos e conversão de thumbnails para o arquivo original.
 */

/** Normaliza um href relativo/absoluto da wiki. Retorna null se inválido. */
export function normalizeWikiUrl(href: string, base: string): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.search = '';
    // Normaliza underscores do path do artigo.
    url.pathname = decodeURIComponent(url.pathname).replace(/_/g, ' ').trim().replace(/ /g, '_');
    return url.toString();
  } catch {
    return null;
  }
}

/** Converte src relativo (ex.: protocol-relative ou "/wiki/...") em URL absoluta. */
export function resolveAssetUrl(src: string, base = 'https://www.tibiawiki.com.br'): string | null {
  if (!src) return null;
  try {
    if (src.startsWith('//')) src = `https:${src}`;
    const url = new URL(src, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Converte uma URL de thumbnail da MediaWiki para o arquivo original.
 * Ex.: ".../thumb/8/82/Foo.gif/250px-Foo.gif" -> ".../8/82/Foo.gif".
 */
export function originalImageUrl(url: string): string {
  const m = url.match(/^(.+?)\/thumb\/(.+)$/);
  if (!m) return url;
  const parts = m[2].split('/');
  const file = parts[parts.length - 1].replace(/^\d+px-/, '');
  const dir = parts.slice(0, parts.length - 1).filter((p) => p !== file).join('/');
  return `${m[1]}/${dir}/${file}`;
}

/** Extensão de um arquivo de imagem (png/gif/jpg/webp), sem o ponto. */
export function imageExtension(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\.(png|gif|jpe?g|webp)(?:$|\?)/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}
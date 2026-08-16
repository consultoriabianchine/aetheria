import path from 'node:path';

export interface ScraperConfig {
  categoryUrl: string;
  concurrency: number;
  delayMs: number;
  timeoutMs: number;
  maxRetries: number;
  importItems: boolean;
  assetsRoot: string;
  creaturesDir: string;
  itemsDir: string;
  rawDir: string;
  cacheDir: string;
  exportsRoot: string;
  userAgent: string;
  maxRedirects: number;
}

/**
 * Configuração central do importador. Toda a URL de categoria fica aqui,
 * lida de `TIBIAWIKI_CATEGORY_URL` — nunca espalhada pelo código.
 */
export function loadScraperConfig(env: NodeJS.ProcessEnv = process.env): ScraperConfig {
  // Raiz do app (dist/config -> tibiawiki-importer) — independe do cwd de execução.
  const appRoot = path.resolve(__dirname, '..', '..');
  const assetsRoot = env.SCRAPER_ASSETS_ROOT
    ? path.resolve(env.SCRAPER_ASSETS_ROOT)
    : path.join(appRoot, 'assets');

  return {
    categoryUrl:
      env.TIBIAWIKI_CATEGORY_URL ?? 'https://www.tibiawiki.com.br/wiki/Human%C3%B3ides',
    concurrency: parseInt(env.SCRAPER_CONCURRENCY ?? '1', 10),
    delayMs: parseInt(env.SCRAPER_DELAY_MS ?? '2500', 10),
    timeoutMs: parseInt(env.SCRAPER_TIMEOUT_MS ?? '15000', 10),
    maxRetries: parseInt(env.SCRAPER_MAX_RETRIES ?? '5', 10),
    importItems: (env.IMPORT_ITEMS ?? 'true') === 'true',
    assetsRoot,
    creaturesDir: path.join(assetsRoot, 'creatures'),
    itemsDir: path.join(assetsRoot, 'items'),
    rawDir: path.join(assetsRoot, 'raw'),
    cacheDir: path.join(assetsRoot, 'cache'),
    exportsRoot: env.SCRAPER_EXPORTS_ROOT
      ? path.resolve(env.SCRAPER_EXPORTS_ROOT)
      : path.join(appRoot, 'exports', 'creatures'),
    userAgent:
      env.SCRAPER_USER_AGENT ??
      'Aetheria-Importer/0.1 (projeto educacional; respeita robots.txt)',
    maxRedirects: parseInt(env.SCRAPER_MAX_REDIRECTS ?? '5', 10),
  };
}
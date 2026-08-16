import { PrismaClient } from '@aetheria/database';
import { loadScraperConfig } from '../config/scraper.config';
import { CreatureRepository } from '../database/creature.repository';
import { ImportRepository } from '../database/import.repository';
import { LootRepository } from '../database/loot.repository';
import { TibiaWikiHttpClient } from '../http/tibiawiki-http.client';
import { CategoryParser } from '../parser/category.parser';
import { CategoryScraper } from '../scraper/category.scraper';
import type { CliOptions, ImportSummary } from '../types/scraper.types';
import { Logger } from '../utils/logger';
import { AssetDownloadService } from './asset-download.service';
import { CreatureImportService } from './creature-import.service';

/** Deriva o nome da categoria a partir da URL (ex.: "Humanóides"). */
export function categoryFromUrl(url: string): string | null {
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() ?? '');
    return last.replace(/_/g, ' ') || null;
  } catch {
    return null;
  }
}

/**
 * Orquestra a importação completa: descobre criaturas da categoria, processa
 * com fila de concorrência limitada e registra o histórico da execução.
 */
export class ImportOrchestrator {
  private readonly logger: Logger;

  constructor(verbose = false) {
    this.logger = new Logger(verbose);
  }

  async run(opts: CliOptions): Promise<ImportSummary> {
    const config = loadScraperConfig();
    this.logger.setVerbose(opts.verbose);
    this.logger.info('Starting', 'TibiaWiki importer');

    const categoryUrl = opts.categoryUrl ?? config.categoryUrl;
    const category = categoryFromUrl(categoryUrl);
    this.logger.info('Category', category ?? categoryUrl);

    const http = new TibiaWikiHttpClient(config, this.logger);
    const categoryScraper = new CategoryScraper(http, undefined, this.logger);
    const links = await categoryScraper.scrape(categoryUrl);
    const limited = opts.limit ? links.slice(0, opts.limit) : links;
    this.logger.info(
      'Found',
      `${links.length} criaturas${opts.limit ? ` (processando ${limited.length})` : ''}`,
    );

    const prisma = new PrismaClient();
    const creatureRepo = new CreatureRepository(prisma);
    const lootRepo = new LootRepository(prisma);
    const importRepo = new ImportRepository(prisma);
    const assets = new AssetDownloadService(http, config, this.logger);
    const importSvc = new CreatureImportService(
      config,
      http,
      this.logger,
      creatureRepo,
      lootRepo,
      importRepo,
      assets,
    );

    let runId: string | null = null;
    if (!opts.dryRun) runId = await importRepo.createRun(categoryUrl);

    const summary: ImportSummary = {
      found: limited.length,
      processed: 0,
      inserted: 0,
      updated: 0,
      failed: 0,
      skipped: 0,
    };

    await mapWithConcurrency(limited, config.concurrency, async (link) => {
      const res = await importSvc.import(link, category, opts);
      summary.processed++;
      switch (res.outcome) {
        case 'inserted':
          summary.inserted++;
          break;
        case 'updated':
          summary.updated++;
          break;
        case 'skipped':
          summary.skipped++;
          break;
        case 'failed':
          summary.failed++;
          break;
      }
    });

    if (runId) {
      await importRepo.finishRun(runId, summary, summary.failed > 0 ? 'COMPLETED' : 'COMPLETED');
    }
    await prisma.$disconnect();

    this.logger.info(
      'Summary',
      `Imported: ${summary.inserted} · Updated: ${summary.updated} · Skipped: ${summary.skipped} · Failed: ${summary.failed}`,
    );

    return summary;
  }
}

/** Fila com limite de concorrência (não usar Promise.all com centenas de requests). */
export async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const runners = Math.max(1, Math.min(concurrency, queue.length));
  let index = 0;
  const run = async () => {
    while (queue.length > 0) {
      const item = queue.shift() as T;
      await worker(item, index++);
    }
  };
  await Promise.all(Array.from({ length: runners }, () => run()));
}
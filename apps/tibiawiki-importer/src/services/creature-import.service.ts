import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ScraperConfig } from '../config/scraper.config';
import type { CreatureRepository } from '../database/creature.repository';
import type { ImportRepository } from '../database/import.repository';
import type { LootRepository } from '../database/loot.repository';
import type { TibiaWikiHttpClient } from '../http/tibiawiki-http.client';
import { CreatureNormalizer } from '../normalization/creature.normalizer';
import { CreatureParser } from '../parser/creature.parser';
import { CreatureScraper } from '../scraper/creature.scraper';
import { ItemScraper } from '../scraper/item.scraper';
import type { AssetPaths, CliOptions, CreatureLink, ImportOutcome, NormalizedCreature } from '../types/scraper.types';
import { Logger } from '../utils/logger';
import { slugify } from '../utils/slugify';
import type { AssetDownloadService } from './asset-download.service';

export interface CreatureImportResult {
  outcome: ImportOutcome;
  error?: Error;
}

/**
 * Pipeline de importação de UMA criatura:
 * SCRAPE -> NORMALIZE/VALIDATE -> (SNAPSHOT) -> (ASSETS) -> (EXPORT) -> UPSERT.
 * Cada criatura é independente; falha não interrompe as demais.
 */
export class CreatureImportService {
  private readonly normalizer = new CreatureNormalizer();

  constructor(
    private readonly config: ScraperConfig,
    private readonly http: TibiaWikiHttpClient,
    private readonly logger: Logger,
    private readonly creatureRepo: CreatureRepository,
    private readonly lootRepo: LootRepository,
    private readonly importRepo: ImportRepository,
    private readonly assets: AssetDownloadService,
  ) {}

  async import(link: CreatureLink, category: string | null, opts: CliOptions): Promise<CreatureImportResult> {
    const tag = link.name;
    try {
      this.logger.info('Processing', tag);

      const scraper = new CreatureScraper(this.http, new CreatureParser(), this.logger);
      const { html, data } = await scraper.scrape(link.url, category);
      const normalized = this.normalizer.normalize(data);

      // Guarda: páginas sem HP/XP/loot não são criaturas (ex.: transclusões).
      if (normalized.hp === null && normalized.experience === null && normalized.loot.length === 0) {
        this.logger.warn('Skipped', `${tag} (página sem dados de criatura)`);
        return { outcome: 'skipped' };
      }

      this.logger.info('HP', String(normalized.hp ?? '—'));
      this.logger.info('XP', String(normalized.experience ?? '—'));
      this.logger.info('Loot', `${normalized.loot.length} itens`);
      if (opts.verbose) {
        for (const l of normalized.loot) {
          const qty = l.minQuantity !== null ? `${l.minQuantity}-${l.maxQuantity ?? l.minQuantity}` : '—';
          this.logger.debug('loot', `${l.itemName} (${l.rarity}) ${qty}${l.chance !== null ? ` ${l.chance}%` : ''}`);
        }
      }

      if (!opts.dryRun) await this.saveSnapshot(html, normalized.sourceHash, link.url);

      const previousHash = opts.dryRun ? null : await this.importRepo.findSourceHash(link.url);
      const changed = previousHash === null || previousHash !== normalized.sourceHash;
      if (!opts.dryRun && !opts.force && !opts.update && !changed) {
        this.logger.info('Skipped', `${tag} (conteúdo sem alterações)`);
        return { outcome: 'skipped' };
      }

      let paths: AssetPaths = { imagePath: null, gifPath: null };
      if (opts.downloadAssets) {
        paths = await this.assets.downloadCreatureAssets(normalized, { force: opts.force, dryRun: opts.dryRun });
      }

      if (!opts.dryRun) await this.exportJson(normalized, paths);

      let outcome: ImportOutcome;
      if (opts.dryRun) {
        outcome = 'updated'; // simulado — nada é persistido
      } else {
        outcome = await this.creatureRepo.upsertCreature(normalized, paths);
      }

      if (this.config.importItems && !opts.dryRun) {
        await this.importWikiItems(normalized, opts);
      }

      this.logger.info('Completed', tag);
      return { outcome };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error('Failed', `${tag} (${message})`);
      if (!opts.dryRun) {
        await this.importRepo.logError(link.url, tag, message, err instanceof Error ? (err.stack ?? null) : null);
      }
      return { outcome: 'failed', error: err instanceof Error ? err : new Error(message) };
    }
  }

  private async saveSnapshot(html: string, hash: string, url: string) {
    await fs.mkdir(this.config.rawDir, { recursive: true });
    const abs = path.join(this.config.rawDir, `${hash}.html`);
    await fs.writeFile(abs, html);
    await this.importRepo.saveSnapshot(url, hash, path.relative(this.config.assetsRoot, abs).replace(/\\/g, '/'));
  }

  private async exportJson(normalized: NormalizedCreature, paths: AssetPaths) {
    await fs.mkdir(this.config.exportsRoot, { recursive: true });
    const file = path.join(this.config.exportsRoot, `${normalized.slug}.json`);
    await fs.writeFile(
      file,
      JSON.stringify(
        {
          name: normalized.name,
          slug: normalized.slug,
          sourceUrl: normalized.sourceUrl,
          hp: normalized.hp,
          experience: normalized.experience,
          imageUrl: normalized.imageUrl,
          gifUrl: normalized.gifUrl,
          imagePath: paths.imagePath,
          gifPath: paths.gifPath,
          loot: normalized.loot,
        },
        null,
        2,
      ),
    );
  }

  private async importWikiItems(normalized: NormalizedCreature, opts: CliOptions) {
    for (const l of normalized.loot) {
      if (!l.itemUrl) continue;
      try {
        const item = await new ItemScraper(this.http, this.logger).scrape(l.itemUrl);
        let imagePath: string | null = null;
        if (opts.downloadAssets && item.imageUrl) {
          imagePath = await this.assets.downloadItemAsset(item.imageUrl, slugify(item.name || l.itemName), {
            force: opts.force,
            dryRun: opts.dryRun,
          });
        }
        await this.lootRepo.upsertWikiItem({
          name: item.name || l.itemName,
          url: l.itemUrl,
          imageUrl: item.imageUrl,
          imagePath,
          description: item.description,
        });
      } catch (err) {
        this.logger.warn('item', `Falha ao importar item ${l.itemName}: ${(err as Error).message}`);
      }
    }
  }
}
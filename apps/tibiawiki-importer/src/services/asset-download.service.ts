import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ScraperConfig } from '../config/scraper.config';
import type { TibiaWikiHttpClient } from '../http/tibiawiki-http.client';
import { imageExtension } from '../parser/wiki-url';
import type { AssetPaths, NormalizedCreature } from '../types/scraper.types';
import { Logger } from '../utils/logger';

/**
 * Download de assets (imagem/GIF) com cache local e respeito ao servidor:
 * não baixa novamente arquivos que já existem e estão válidos.
 */
export class AssetDownloadService {
  constructor(
    private readonly http: TibiaWikiHttpClient,
    private readonly config: ScraperConfig,
    private readonly logger: Logger,
  ) {}

  async downloadCreatureAssets(
    n: NormalizedCreature,
    opts: { force: boolean; dryRun: boolean },
  ): Promise<AssetPaths> {
    if (opts.dryRun) return { imagePath: null, gifPath: null };

    const dir = path.join(this.config.creaturesDir, n.slug);
    await fs.mkdir(dir, { recursive: true });

    const result: AssetPaths = { imagePath: null, gifPath: null };

    if (n.imageUrl) {
      const ext = imageExtension(n.imageUrl) ?? 'png';
      const target = path.join(dir, `creature.${ext}`);
      result.imagePath = (await this.downloadTo(n.imageUrl, target, opts.force, n.slug)) ?? null;
    }
    if (n.gifUrl && n.gifUrl !== n.imageUrl) {
      const ext = imageExtension(n.gifUrl) ?? 'gif';
      const target = path.join(dir, `creature.${ext}`);
      result.gifPath = (await this.downloadTo(n.gifUrl, target, opts.force, n.slug)) ?? null;
    } else if (n.gifUrl && n.gifUrl === n.imageUrl) {
      // Mesmo arquivo usado como imagem e GIF — não duplicar fisicamente.
      result.gifPath = result.imagePath;
    }

    await fs.writeFile(
      path.join(dir, 'metadata.json'),
      JSON.stringify(
        {
          slug: n.slug,
          name: n.name,
          sourceUrl: n.sourceUrl,
          imageUrl: n.imageUrl,
          gifUrl: n.gifUrl,
          imagePath: result.imagePath,
          gifPath: result.gifPath,
          downloadedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );

    return result;
  }

  async downloadItemAsset(
    url: string,
    name: string,
    opts: { force: boolean; dryRun: boolean },
  ): Promise<string | null> {
    if (opts.dryRun) return null;
    const dir = path.join(this.config.itemsDir, name);
    await fs.mkdir(dir, { recursive: true });
    const ext = imageExtension(url) ?? 'png';
    const target = path.join(dir, `item.${ext}`);
    return this.downloadTo(url, target, opts.force, name);
  }

  /** Baixa (ou usa cache) e grava em `target`. Retorna o caminho relativo ou null. */
  private async downloadTo(
    url: string,
    target: string,
    force: boolean,
    label: string,
  ): Promise<string | null> {
    // Já existe localmente e válido?
    try {
      if (!force && (await fs.stat(target)).size > 0) {
        this.logger.debug('asset', `Usando arquivo existente: ${path.basename(target)}`);
        return this.relativePath(target);
      }
    } catch {
      /* não existe ainda */
    }

    let data: Buffer;
    const cacheFile = this.cacheFileFor(url);
    let cached: Buffer | null = null;
    if (!force) {
      try {
        if ((await fs.stat(cacheFile)).size > 0) cached = await fs.readFile(cacheFile);
      } catch {
        /* cache miss */
      }
    }
    if (cached) {
      data = cached;
    } else {
      const res = await this.http.getBinary(url);
      data = res.data;
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, data);
    }

    await fs.writeFile(target, data);
    this.logger.info('asset', `Baixado: ${path.basename(target)} (${label})`);
    return this.relativePath(target);
  }

  private cacheFileFor(url: string): string {
    const ext = imageExtension(url) ?? 'bin';
    const hash = createHash('sha256').update(url).digest('hex').slice(0, 16);
    return path.join(this.config.cacheDir, `${hash}.${ext}`);
  }

  private relativePath(target: string): string {
    return path.relative(this.config.assetsRoot, target).replace(/\\/g, '/');
  }
}
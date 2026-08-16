import { PrismaClient } from '@aetheria/database';
import type { ImportSummary } from '../types/scraper.types';

/**
 * Repositório de histórico da importação: runs, erros e snapshots de HTML.
 */
export class ImportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createRun(categoryUrl: string): Promise<string> {
    const run = await this.prisma.importRun.create({ data: { category_url: categoryUrl } });
    return run.id;
  }

  async finishRun(id: string, summary: ImportSummary, status: 'COMPLETED' | 'FAILED'): Promise<void> {
    await this.prisma.importRun.update({
      where: { id },
      data: {
        status,
        finished_at: new Date(),
        total_found: summary.found,
        total_processed: summary.processed,
        total_inserted: summary.inserted,
        total_updated: summary.updated,
        total_failed: summary.failed,
        total_skipped: summary.skipped,
      },
    });
  }

  async logError(
    sourceUrl: string,
    entityName: string | null,
    error: string,
    stack: string | null,
  ): Promise<void> {
    await this.prisma.importError.create({
      data: {
        source_url: sourceUrl,
        entity_name: entityName,
        error: error.slice(0, 2000),
        stack: stack ? stack.slice(0, 4000) : null,
      },
    });
  }

  async saveSnapshot(sourceUrl: string, contentHash: string, htmlPath: string): Promise<void> {
    await this.prisma.importSnapshot.upsert({
      where: { source_url: sourceUrl },
      update: { content_hash: contentHash, html_path: htmlPath, scraped_at: new Date() },
      create: { source_url: sourceUrl, content_hash: contentHash, html_path: htmlPath },
    });
  }

  async findSourceHash(sourceUrl: string): Promise<string | null> {
    const source = await this.prisma.creatureSource.findFirst({
      where: { source_url: sourceUrl },
      select: { source_hash: true },
    });
    return source?.source_hash ?? null;
  }

  async findCreatureBySlug(slug: string) {
    return this.prisma.creatureDefinition.findUnique({ where: { slug }, include: { loots: true } });
  }
}
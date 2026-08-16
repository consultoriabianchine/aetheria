import { PrismaClient } from '@aetheria/database';
import { slugify } from '../utils/slugify';

export interface WikiItemData {
  name: string;
  url: string;
  imageUrl: string | null;
  imagePath: string | null;
  description: string | null;
}

/**
 * Persistência de itens importados da Wiki (páginas de itens do loot).
 * Importação de itens é opcional (IMPORT_ITEMS).
 */
export class LootRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertWikiItem(item: WikiItemData): Promise<void> {
    const data = {
      name: item.name,
      slug: slugify(item.name),
      image_url: item.imageUrl,
      image_path: item.imagePath,
      description: item.description ?? '',
    };
    await this.prisma.wikiItem.upsert({
      where: { source_url: item.url },
      update: data,
      create: { ...data, source_url: item.url },
    });
  }
}
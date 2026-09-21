import { PrismaClient } from '@aetheria/database';
import { slugify } from '../utils/slugify';

export interface WikiItemData {
  name: string;
  url: string;
  imageUrl: string | null;
  imagePath: string | null;
  description: string | null;
  weight?: number;
  armor?: number;
  attack?: number;
  defense?: number;
  sellValue?: number;
  stackable?: boolean;
  category?: string;
  type?: string;
  slot?: string | null;
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

  async upsertItemDefinition(item: WikiItemData): Promise<string> {
    const normalizedName = item.name.trim();
    const id = normalizedName.toLowerCase().includes('gold coin') || normalizedName.toLowerCase().includes('moeda de ouro')
      ? 'gold'
      : slugify(normalizedName);
    const existing = await this.prisma.itemDefinition.findFirst({
      where: {
        OR: [
          { id },
          { sourceItemId: item.url },
          { name: { equals: normalizedName, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    const data = {
      name: normalizedName,
      description: item.description ?? '',
      type: item.type ?? 'loot',
      slot: item.slot ?? null,
      imagePath: item.imagePath ?? item.imageUrl,
      stackable: item.stackable ?? false,
      weight: item.weight ?? 0,
      category: item.category ?? 'Outros',
      sellValue: Math.max(0, Math.round(item.sellValue ?? 0)),
      attackPower: Math.max(0, Math.round((item.attack ?? 0) + (item.type === 'armor' ? 0 : 0))),
      armor: Math.max(0, Math.round(item.armor ?? 0)),
      defense: Math.max(0, Math.round(item.defense ?? 0)),
      sourceItemId: item.url,
      enabled: true,
    };
    if (existing) {
      await this.prisma.itemDefinition.update({ where: { id: existing.id }, data });
      return existing.id;
    }
    const created = await this.prisma.itemDefinition.create({ data: { id, ...data } });
    return created.id;
  }

  async ensureItemDefinition(name: string): Promise<string> {
    return this.upsertItemDefinition({ name, url: `https://www.tibiawiki.com.br/wiki/${name.replace(/\s+/g, '_')}`, imageUrl: null, imagePath: null, description: null });
  }
}

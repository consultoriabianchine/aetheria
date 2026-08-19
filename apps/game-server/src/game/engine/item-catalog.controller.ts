import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getItemCatalog, loadItemCatalogFromDatabase } from './item-catalog';

@Controller('assets/items')
export class ItemCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('catalog')
  async catalog() {
    await loadItemCatalogFromDatabase(this.prisma);
    return { items: [...getItemCatalog().values()] };
  }
}

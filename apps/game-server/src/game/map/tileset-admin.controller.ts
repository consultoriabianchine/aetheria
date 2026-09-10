import { Body, Controller, Delete, Get, NotFoundException, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { TilesetAdminService, type TileUpdateInput, type TilesetUploadInput } from './tileset-admin.service';
import { TilesetRegistry } from './tileset-registry.service';

@Controller('admin/tilesets')
@UseGuards(AdminAuthGuard)
export class TilesetAdminController {
  constructor(
    private readonly admin: TilesetAdminService,
    private readonly registry: TilesetRegistry,
  ) {}

  @Get()
  list() {
    return this.admin.list();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.admin.get(id);
  }

  @Post()
  upload(@Body() body: TilesetUploadInput) {
    return this.admin.upload(body);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string; enabled?: boolean }) {
    return this.admin.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.admin.remove(id);
  }

  @Get(':id/tiles')
  tiles(@Param('id', ParseIntPipe) id: number) {
    return this.admin.listTiles(id);
  }

  @Put(':id/tiles')
  updateTiles(@Param('id', ParseIntPipe) id: number, @Body() body: { tiles: TileUpdateInput[] }) {
    return this.admin.updateTiles(id, body.tiles ?? []);
  }

  @Get(':id/usage')
  usage(@Param('id', ParseIntPipe) id: number) {
    return this.admin.usedBy(id);
  }

  @Get(':id/preview')
  preview(@Param('id', ParseIntPipe) id: number) {
    const tileset = this.registry.getTileset(id);
    if (!tileset) throw new NotFoundException('Tileset não encontrado');
    return { tilesetId: id, tileWidth: tileset.tileWidth, tileHeight: tileset.tileHeight, columns: tileset.columns, rows: tileset.rows, imageUrl: `/assets/tilesets/${id}` };
  }
}

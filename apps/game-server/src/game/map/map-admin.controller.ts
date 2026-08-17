import { Body, Controller, Delete, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { MapAdminService, type MapSaveInput } from './map-admin.service';
import { MapRegistry } from './map-registry.service';

@Controller('admin/maps')
@UseGuards(AdminAuthGuard)
export class MapAdminController {
  constructor(
    private readonly registry: MapRegistry,
    private readonly maps: MapAdminService,
  ) {}

  @Get()
  list() {
    return this.registry.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const map = this.registry.getMap(id);
    if (!map) throw new NotFoundException('Mapa não encontrado');
    return map;
  }

  @Post()
  save(@Body() body: MapSaveInput) {
    return this.maps.save(body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.maps.remove(id);
  }
}

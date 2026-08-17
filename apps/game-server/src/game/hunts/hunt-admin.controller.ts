import { Body, Controller, Delete, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import type { HuntDefinition } from '@aetheria/types';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { HuntAdminService } from './hunt-admin.service';
import { HuntRegistry } from './hunt-registry.service';

@Controller('admin/hunts')
@UseGuards(AdminAuthGuard)
export class HuntAdminController {
  constructor(
    private readonly registry: HuntRegistry,
    private readonly hunts: HuntAdminService,
  ) {}

  @Get()
  list() {
    return this.registry.getAll();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    const hunt = this.registry.get(id);
    if (!hunt) throw new NotFoundException('Hunt não encontrada');
    return hunt;
  }

  @Post()
  save(@Body() body: HuntDefinition & { id?: string }) {
    return this.hunts.save(body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.hunts.remove(id);
  }
}

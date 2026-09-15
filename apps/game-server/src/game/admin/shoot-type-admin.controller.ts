import { Prisma } from '@aetheria/database';
import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { getShootType, listShootTypes, loadShootEffectCatalog } from '../combat/shoot-effect-registry';

interface ShootTypeInput {
  slug: string;
  name: string;
  description?: string;
  sprite?: string;
  spriteAssetId?: number | null;
  frameWidth?: number;
  frameHeight?: number;
  frames?: Record<string, number>;
  speedPxPerSecond?: number;
  offsetX?: number;
  offsetY?: number;
  enabled?: boolean;
}

@Controller('admin/shoot-types')
@UseGuards(AdminAuthGuard)
export class ShootTypeAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    await loadShootEffectCatalog(this.prisma);
    return listShootTypes();
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    await loadShootEffectCatalog(this.prisma);
    const def = getShootType(id);
    if (!def) throw new NotFoundException('Tipo de tiro não encontrado');
    return def;
  }

  @Post()
  async create(@Body() body: ShootTypeInput) {
    await this.prisma.shootType.create({ data: toData(body) });
    await loadShootEffectCatalog(this.prisma);
    return { ok: true };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: ShootTypeInput) {
    await this.prisma.shootType.update({ where: { id }, data: toData(body) });
    await loadShootEffectCatalog(this.prisma);
    return { ok: true };
  }
}

function toData(body: ShootTypeInput) {
  if (!body.slug || !body.name) throw new Error('slug e name são obrigatórios');
  return {
    slug: body.slug,
    name: body.name,
    description: body.description ?? '',
    sprite: body.sprite ?? '',
    spriteAssetId: body.spriteAssetId ?? null,
    frameWidth: Math.max(1, Math.round(body.frameWidth ?? 32)),
    frameHeight: Math.max(1, Math.round(body.frameHeight ?? 32)),
    frames: (body.frames ?? {}) as unknown as Prisma.InputJsonValue,
    speedPxPerSecond: Math.max(0, Math.round(body.speedPxPerSecond ?? 520)),
    offsetX: Math.round(body.offsetX ?? 0),
    offsetY: Math.round(body.offsetY ?? 0),
    enabled: body.enabled ?? true,
  };
}

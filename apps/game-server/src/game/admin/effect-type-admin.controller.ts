import { Prisma } from '@aetheria/database';
import { Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { getEffectType, listEffectTypes, loadShootEffectCatalog } from '../combat/shoot-effect-registry';

interface EffectTypeInput {
  slug: string;
  name: string;
  description?: string;
  sprite?: string;
  spriteAssetId?: number | null;
  frameWidth?: number;
  frameHeight?: number;
  frames?: number[];
  fps?: number;
  enabled?: boolean;
}

@Controller('admin/effect-types')
@UseGuards(AdminAuthGuard)
export class EffectTypeAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    await loadShootEffectCatalog(this.prisma);
    return listEffectTypes();
  }

  @Get(':id')
  async get(@Param('id', ParseIntPipe) id: number) {
    await loadShootEffectCatalog(this.prisma);
    const def = getEffectType(id);
    if (!def) throw new NotFoundException('Tipo de efeito não encontrado');
    return def;
  }

  @Post()
  async create(@Body() body: EffectTypeInput) {
    await this.prisma.effectType.create({ data: toData(body) });
    await loadShootEffectCatalog(this.prisma);
    return { ok: true };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() body: EffectTypeInput) {
    await this.prisma.effectType.update({ where: { id }, data: toData(body) });
    await loadShootEffectCatalog(this.prisma);
    return { ok: true };
  }
}

function toData(body: EffectTypeInput) {
  if (!body.slug || !body.name) throw new Error('slug e name são obrigatórios');
  return {
    slug: body.slug,
    name: body.name,
    description: body.description ?? '',
    sprite: body.sprite ?? '',
    spriteAssetId: body.spriteAssetId ?? null,
    frameWidth: Math.max(1, Math.round(body.frameWidth ?? 32)),
    frameHeight: Math.max(1, Math.round(body.frameHeight ?? 32)),
    frames: (body.frames ?? []) as unknown as Prisma.InputJsonValue,
    fps: Math.max(1, Math.round(body.fps ?? 12)),
    enabled: body.enabled ?? true,
  };
}

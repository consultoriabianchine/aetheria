import { Prisma } from '@aetheria/database';
import { BadRequestException, Body, Controller, Get, NotFoundException, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { CreatureAnimationService } from './creature-animation.service';
import { CreatureAssetService } from './creature-asset.service';
import { CreatureRegistry } from './creature-registry.service';
import { normalizeDamageAffinities } from '@aetheria/types';

interface LootEntryInput {
  id?: string;
  itemId?: string | null;
  itemName?: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
}

interface LootEntryResolved {
  itemId: string;
  itemName: string;
  chance: number;
  minQuantity: number;
  maxQuantity: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

@Controller('admin/creatures')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CreatureRegistry,
    private readonly assetService: CreatureAssetService,
    private readonly animationService: CreatureAnimationService,
  ) {}

  @Get()
  list() {
    return this.registry.listCreatures();
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const summary = await this.registry.findCreature(id);
    if (!summary) throw new NotFoundException('Criatura não encontrada');
    const animation = await this.animationService.findById(id);
    const asset = await this.assetService.findById(id);
    return {
      ...summary,
      animation,
      asset: asset
        ? {
            fileName: asset.fileName,
            mimeType: asset.mimeType,
            fileSize: asset.fileSize,
            imageWidth: asset.imageWidth,
            imageHeight: asset.imageHeight,
            checksum: asset.checksum,
          }
        : null,
    };
  }

  @Put(':id/stats')
  async putStats(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    const creature = await this.prisma.creatureDefinition.findUnique({ where: { creature_id: id } });
    if (!creature) throw new NotFoundException('Criatura não encontrada');
    const fields = ['game_level', 'game_max_health', 'game_attack', 'game_defense', 'game_experience', 'game_attack_speed', 'game_attack_range', 'game_view_range', 'game_chase_range', 'game_footprint_width', 'game_footprint_height'] as const;
    const data = Object.fromEntries(fields.filter((field) => body[field] !== undefined).map((field) => [field, Math.max(0, Math.round(Number(body[field])))]));
    await this.prisma.creatureDefinition.update({ where: { creature_id: id }, data });
    await this.audit('CREATURE_STATS_UPDATED', id, null, data);
    return { ok: true };
  }

  @Put(':id/loot')
  async putLoot(@Param('id', ParseIntPipe) id: number, @Body() body: { loot?: LootEntryInput[] }) {
    const creature = await this.prisma.creatureDefinition.findUnique({ where: { creature_id: id } });
    if (!creature) throw new NotFoundException('Criatura não encontrada');
    const definitionId = creature.id;

    const entries = await this.resolveLoot(body.loot ?? []);

    const before = await this.prisma.creatureLoot.findMany({ where: { creature_id: definitionId } });
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.creatureLoot.deleteMany({ where: { creature_id: definitionId } });
      const rows: { id: string; item_id: string | null; item_name: string; chance: number | null; min_quantity: number | null; max_quantity: number | null }[] = [];
      for (const loot of entries) {
        rows.push(
          await tx.creatureLoot.create({
            data: {
              creature_id: definitionId,
              item_id: loot.itemId,
              item_name: loot.itemName,
              item_slug: loot.itemId,
              chance: loot.chance,
              min_quantity: loot.minQuantity,
              max_quantity: loot.maxQuantity,
              rarity: 'CUSTOM',
            },
          }),
        );
      }
      return rows;
    });
    await this.audit('CREATURE_LOOT_UPDATED', id, before, saved);
    return {
      ok: true,
      loot: saved.map((row) => ({
        id: row.id,
        itemId: row.item_id,
        itemName: row.item_name,
        chance: row.chance ?? 0,
        minQuantity: row.min_quantity ?? 1,
        maxQuantity: row.max_quantity ?? 1,
      })),
    };
  }

  private async resolveLoot(entries: LootEntryInput[]): Promise<LootEntryResolved[]> {
    const requested = new Set(entries.map((loot) => loot.itemId).filter((itemId): itemId is string => !!itemId));
    const items = requested.size > 0
      ? await this.prisma.itemDefinition.findMany({ where: { id: { in: [...requested] } } })
      : [];
    const itemById = new Map(items.map((item) => [item.id, item]));

    const seen = new Set<string>();
    return entries.map((loot, index) => {
      if (!loot.itemId) throw new BadRequestException(`Loot #${index + 1}: selecione um item do catálogo (itemId ausente).`);
      const item = itemById.get(loot.itemId) ?? (loot.itemId === 'gold' ? { id: 'gold', name: 'Moedas de Ouro', enabled: true } : undefined);
      if (!item) throw new BadRequestException(`Loot #${index + 1}: item "${loot.itemId}" não existe no catálogo.`);
      if (!item.enabled) throw new BadRequestException(`Loot #${index + 1}: item "${item.name}" está desabilitado.`);
      if (seen.has(item.id)) throw new BadRequestException(`Loot #${index + 1}: item "${item.name}" duplicado.`);
      seen.add(item.id);

      if (!Number.isFinite(Number(loot.chance)) || Number(loot.chance) < 0 || Number(loot.chance) > 100) {
        throw new BadRequestException(`Loot #${index + 1}: chance deve estar entre 0 e 100.`);
      }
      const minQuantity = Math.round(Number(loot.minQuantity));
      const maxQuantity = Math.round(Number(loot.maxQuantity));
      if (!Number.isFinite(minQuantity) || !Number.isFinite(maxQuantity) || minQuantity < 1 || maxQuantity < minQuantity) {
        throw new BadRequestException(`Loot #${index + 1}: quantidades inválidas (mín. >= 1 e máx. >= mín.).`);
      }

      return { itemId: item.id, itemName: item.name, chance: clamp(Number(loot.chance), 0, 100), minQuantity, maxQuantity };
    });
  }

  @Put(':id/affinities')
  async putAffinities(@Param('id', ParseIntPipe) id: number, @Body() body: { affinities?: unknown }) {
    const creature = await this.prisma.creatureDefinition.findUnique({ where: { creature_id: id } });
    if (!creature) throw new NotFoundException('Criatura não encontrada');
    const affinities = normalizeDamageAffinities(body.affinities);
    await this.prisma.creatureDefinition.update({ where: { creature_id: id }, data: { damage_affinities: affinities as unknown as Prisma.InputJsonValue } });
    await this.audit('CREATURE_AFFINITIES_UPDATED', id, creature.damage_affinities, affinities);
    return { ok: true, affinities };
  }

  @Post(':id/spritesheet')
  async uploadSpritesheet(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { fileName?: string; mimeType?: string; width?: number; height?: number; dataBase64?: string },
  ) {
    if (!body.dataBase64) throw new BadRequestException('dataBase64 é obrigatório');
    const asset = await this.assetService.upsert(id, {
      fileName: body.fileName ?? `${id}.png`,
      mimeType: body.mimeType ?? 'image/png',
      width: body.width ?? 0,
      height: body.height ?? 0,
      data: new Uint8Array(Buffer.from(body.dataBase64, 'base64')),
      uploadedBy: 'admin',
    });
    this.registry.invalidate(id);
    await this.audit('CREATURE_SPRITESHEET_UPLOADED', id, null, { checksum: asset.checksum, fileSize: asset.fileSize });
    return { ok: true, asset: this.meta(asset) };
  }

  @Get(':id/animation')
  async getAnimation(@Param('id', ParseIntPipe) id: number) {
    const animation = await this.animationService.findById(id);
    if (!animation) throw new NotFoundException('Nenhuma configuração de animação');
    return animation;
  }

  @Put(':id/animation')
  async putAnimation(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { config?: unknown; version?: number },
  ) {
    const before = await this.animationService.findById(id);
    const saved = await this.animationService.save(id, body.config, body.version);
    this.registry.invalidate(id);
    await this.audit('CREATURE_ANIMATION_UPDATED', id, before, saved);
    return { ok: true, animation: saved };
  }

  private meta(asset: { fileName: string; mimeType: string; fileSize: number; imageWidth: number; imageHeight: number; checksum: string }) {
    return {
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      imageWidth: asset.imageWidth,
      imageHeight: asset.imageHeight,
      checksum: asset.checksum,
    };
  }

  private async audit(action: string, entityId: number, before: unknown, after: unknown) {
    await this.prisma.adminAuditLog.create({
      data: {
        actor: 'admin',
        action,
        entity_type: 'creature',
        entity_id: String(entityId),
        before: before === null ? undefined : (before as object),
        after: after === null ? undefined : (after as object),
      },
    });
  }
}

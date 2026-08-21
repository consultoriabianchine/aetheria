import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Prisma } from '@aetheria/database';
import type { AmmoType, DamageType, EquipmentSlot, ItemImpactVisual, ItemProjectileVisual, ItemType, ItemVisualEffects, WeaponType } from '@aetheria/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { loadItemCatalogFromDatabase, rowToItemDefinition } from '../engine/item-catalog';

interface ItemDefinitionInput {
  id?: string;
  name: string;
  description?: string;
  type: ItemType;
  slot?: EquipmentSlot | null;
  imagePath?: string | null;
  stackable?: boolean;
  weight?: number;
  category?: string;
  sellValue?: number;
  attackPower?: number;
  magicPower?: number;
  armor?: number;
  defense?: number;
  maxHp?: number;
  maxMana?: number;
  criticalChance?: number;
  criticalDamage?: number;
  accuracy?: number;
  dodge?: number;
  weaponType?: WeaponType | null;
  ammoType?: AmmoType | null;
  damageType?: DamageType | null;
  range?: number;
  allowedAmmoType?: AmmoType | null;
  skillBonuses?: Record<string, number> | null;
  resistances?: Record<string, number> | null;
  requirements?: Record<string, unknown> | null;
  specialModifiers?: Record<string, unknown> | null;
  visual?: ItemVisualEffects | null;
  enabled?: boolean;
  sourceItemId?: string | null;
}

@Controller('admin/items')
@UseGuards(AdminAuthGuard)
export class ItemAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const rows = await this.prisma.itemDefinition.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row) => ({ ...rowToItemDefinition(row as never), enabled: row.enabled, description: row.description, specialModifiers: row.specialModifiers }));
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const row = await this.prisma.itemDefinition.findUnique({ where: { id } });
    if (!row) return null;
    return { ...rowToItemDefinition(row as never), enabled: row.enabled, description: row.description, specialModifiers: row.specialModifiers };
  }

  @Post()
  async create(@Body() body: ItemDefinitionInput) {
    const id = normalizeId(body.id || body.name);
    const row = await this.prisma.itemDefinition.create({ data: toPrismaData(id, body) });
    await loadItemCatalogFromDatabase(this.prisma);
    return { ok: true, item: { ...rowToItemDefinition(row as never), enabled: row.enabled, description: row.description, specialModifiers: row.specialModifiers } };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: ItemDefinitionInput) {
    const row = await this.prisma.itemDefinition.update({ where: { id }, data: toPrismaData(id, body) });
    await loadItemCatalogFromDatabase(this.prisma);
    return { ok: true, item: { ...rowToItemDefinition(row as never), enabled: row.enabled, description: row.description, specialModifiers: row.specialModifiers } };
  }
}

function toPrismaData(id: string, input: ItemDefinitionInput): Prisma.ItemDefinitionCreateInput {
  const attackPower = int(input.attackPower);
  const magicPower = int(input.magicPower);
  const weapon = input.weaponType
    ? {
        itemId: id,
        weaponType: input.weaponType,
        attackPower,
        magicPower: magicPower || undefined,
        damageType: input.damageType ?? (input.weaponType === 'staff' ? 'arcane' : 'physical'),
        range: int(input.range, input.weaponType === 'staff' ? 5 : input.weaponType === 'bow' ? 6 : input.weaponType === 'crossbow' ? 7 : 1),
        allowedAmmoType: input.allowedAmmoType ?? undefined,
      }
    : undefined;
  const ammo = input.ammoType
    ? {
        itemId: id,
        ammoType: input.ammoType,
        attackPower,
        damageType: input.damageType ?? 'physical',
      }
    : undefined;
  const canStoreVisual = !!input.ammoType || input.weaponType === 'staff';
  const specialModifiers = withVisual(input.specialModifiers, canStoreVisual ? input.visual : null);
  return {
    id,
    name: input.name?.trim() || id,
    description: input.description ?? '',
    type: input.type ?? 'other',
    slot: input.slot ?? null,
    imagePath: input.imagePath || null,
    stackable: input.stackable ?? false,
    weight: num(input.weight),
    category: input.category?.trim() || input.type || 'outros',
    sellValue: int(input.sellValue),
    attackPower,
    magicPower,
    armor: int(input.armor),
    defense: int(input.defense),
    maxHp: int(input.maxHp),
    maxMana: int(input.maxMana),
    criticalChance: num(input.criticalChance),
    criticalDamage: num(input.criticalDamage),
    accuracy: num(input.accuracy),
    dodge: num(input.dodge),
    weapon: weapon as Prisma.InputJsonValue | undefined,
    ammo: ammo as Prisma.InputJsonValue | undefined,
    skillBonuses: input.skillBonuses as Prisma.InputJsonValue | undefined,
    resistances: input.resistances as Prisma.InputJsonValue | undefined,
    requirements: input.requirements as Prisma.InputJsonValue | undefined,
    specialModifiers: specialModifiers as Prisma.InputJsonValue | undefined,
    enabled: input.enabled ?? true,
    sourceItemId: input.sourceItemId ?? null,
  };
}

function withVisual(value: Record<string, unknown> | null | undefined, visual: ItemVisualEffects | null | undefined): Record<string, unknown> | undefined {
  const next = { ...(value ?? {}) };
  if (visual && (isProjectileVisual(visual.projectile) || isImpactVisual(visual.impact))) {
    next['visual'] = {
      ...(isProjectileVisual(visual.projectile) ? { projectile: visual.projectile } : {}),
      ...(isImpactVisual(visual.impact) ? { impact: visual.impact } : {}),
    };
  } else {
    delete next['visual'];
  }
  return Object.keys(next).length ? next : undefined;
}

function isProjectileVisual(value: unknown): value is ItemProjectileVisual {
  if (typeof value !== 'object' || value === null) return false;
  const visual = value as { sprite?: unknown; spriteAssetId?: unknown };
  return (typeof visual.sprite === 'string' && visual.sprite.trim().length > 0) || (typeof visual.spriteAssetId === 'number' && visual.spriteAssetId > 0);
}

function isImpactVisual(value: unknown): value is ItemImpactVisual {
  if (typeof value !== 'object' || value === null) return false;
  const visual = value as { sprite?: unknown; spriteAssetId?: unknown };
  return (typeof visual.sprite === 'string' && visual.sprite.trim().length > 0) || (typeof visual.spriteAssetId === 'number' && visual.spriteAssetId > 0);
}

function normalizeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `item-${Date.now()}`;
}

function int(value: unknown, fallback = 0): number {
  return Math.round(num(value, fallback));
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

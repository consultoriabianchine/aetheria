import { Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Prisma } from '@aetheria/database';
import type { CraftingIntent, CraftingProfession } from '@aetheria/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { loadCraftRecipeCatalog } from '../engine/craft-registry';

interface RecipeInput {
  slug?: string;
  name: string;
  description?: string;
  profession?: CraftingProfession;
  requiredLevel?: number;
  station?: string;
  outputItemId: string;
  outputQuantity?: number;
  goldCost?: number;
  experience?: number;
  qualityMin?: number;
  qualityMax?: number;
  allowedIntents?: CraftingIntent[];
  resonanceTags?: string[];
  status?: 'draft' | 'published' | 'disabled';
  ingredients?: { itemId?: string | null; tag?: string | null; quantity?: number; role?: string }[];
  expectedVersion?: number;
}

@Controller('admin/crafting/recipes')
@UseGuards(AdminAuthGuard)
export class CraftingAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query('q') q?: string, @Query('status') status?: string, @Query('profession') profession?: string) {
    const rows = await this.prisma.craftRecipe.findMany({
      where: {
        ...(q?.trim() ? { OR: [{ name: { contains: q.trim(), mode: 'insensitive' } }, { slug: { contains: q.trim(), mode: 'insensitive' } }] } : {}),
        ...(status ? { status } : {}),
        ...(profession ? { profession } : {}),
      },
      include: { ingredients: { orderBy: { id: 'asc' } } },
      orderBy: { name: 'asc' },
    });
    return rows.map(toResponse);
  }

  @Get(':id/versions')
  async versions(@Param('id') id: string) {
    const recipe = await this.prisma.craftRecipe.findUnique({ where: { id }, select: { id: true } });
    if (!recipe) throw new NotFoundException('Receita não encontrada.');
    return this.prisma.craftRecipeVersion.findMany({ where: { recipeId: id }, orderBy: { version: 'desc' } });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const row = await this.prisma.craftRecipe.findUnique({ where: { id }, include: { ingredients: true } });
    return row ? toResponse(row) : null;
  }

  @Post()
  async create(@Body() input: RecipeInput) {
    await this.validate(input);
    const row = await this.prisma.craftRecipe.create({
      data: recipeData(input, input.status ?? 'draft'),
      include: { ingredients: true },
    });
    await this.saveVersion(row, 'created');
    await this.audit('CRAFT_RECIPE_CREATED', row.id, null, toResponse(row));
    await loadCraftRecipeCatalog(this.prisma);
    return { ok: true, recipe: toResponse(row) };
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() input: RecipeInput) {
    await this.validate(input);
    const current = await this.prisma.craftRecipe.findUnique({ where: { id }, include: { ingredients: true } });
    if (!current) throw new NotFoundException('Receita não encontrada.');
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new ConflictException(`Receita desatualizada. Versão atual: ${current.version}.`);
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.craftRecipe.updateMany({
        where: { id, version: input.expectedVersion ?? current.version },
        data: { ...recipeScalarData(input, input.status ?? current.status), version: current.version + 1 },
      });
      if (claimed.count !== 1) throw new ConflictException('A receita foi alterada por outro administrador.');
      await tx.craftRecipeIngredient.deleteMany({ where: { recipeId: id } });
      await tx.craftRecipeIngredient.createMany({ data: ingredientData(input, id) as Prisma.CraftRecipeIngredientCreateManyInput[] });
      return tx.craftRecipe.findUniqueOrThrow({ where: { id }, include: { ingredients: true } });
    });
    await this.saveVersion(row, 'updated');
    await this.audit('CRAFT_RECIPE_UPDATED', row.id, toResponse(current), toResponse(row));
    await loadCraftRecipeCatalog(this.prisma);
    return { ok: true, recipe: toResponse(row) };
  }

  @Post(':id/publish')
  async publish(@Param('id') id: string, @Body() body: { expectedVersion?: number } = {}) {
    const current = await this.prisma.craftRecipe.findUnique({ where: { id }, include: { ingredients: true } });
    if (!current) throw new NotFoundException('Receita não encontrada.');
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) throw new ConflictException(`Receita desatualizada. Versão atual: ${current.version}.`);
    const claimed = await this.prisma.craftRecipe.updateMany({ where: { id, version: body.expectedVersion ?? current.version }, data: { status: 'published', version: current.version + 1 } });
    if (claimed.count !== 1) throw new ConflictException('A receita foi alterada por outro administrador.');
    const row = await this.prisma.craftRecipe.findUniqueOrThrow({ where: { id }, include: { ingredients: true } });
    await this.saveVersion(row, 'published');
    await this.audit('CRAFT_RECIPE_PUBLISHED', id, toResponse(current), toResponse(row));
    await loadCraftRecipeCatalog(this.prisma);
    return { ok: true, recipe: toResponse(row) };
  }

  @Post(':id/disable')
  async disable(@Param('id') id: string, @Body() body: { expectedVersion?: number } = {}) {
    const current = await this.prisma.craftRecipe.findUnique({ where: { id }, include: { ingredients: true } });
    if (!current) throw new NotFoundException('Receita não encontrada.');
    if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) throw new ConflictException(`Receita desatualizada. Versão atual: ${current.version}.`);
    const claimed = await this.prisma.craftRecipe.updateMany({ where: { id, version: body.expectedVersion ?? current.version }, data: { status: 'disabled', version: current.version + 1 } });
    if (claimed.count !== 1) throw new ConflictException('A receita foi alterada por outro administrador.');
    const row = await this.prisma.craftRecipe.findUniqueOrThrow({ where: { id }, include: { ingredients: true } });
    await this.saveVersion(row, 'disabled');
    await this.audit('CRAFT_RECIPE_DISABLED', id, toResponse(current), toResponse(row));
    await loadCraftRecipeCatalog(this.prisma);
    return { ok: true, recipe: toResponse(row) };
  }

  @Post('validate')
  async validateEndpoint(@Body() input: RecipeInput) {
    try {
      await this.validate(input);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Receita inválida.' };
    }
  }

  private async validate(input: RecipeInput) {
    if (!input.name?.trim() || !input.outputItemId?.trim()) throw new Error('Nome e item de saída são obrigatórios.');
    const output = await this.prisma.itemDefinition.findUnique({ where: { id: input.outputItemId } });
    if (!output || !output.enabled) throw new Error('O item de saída não existe ou está desativado.');
    const ingredients = input.ingredients ?? [];
    if (ingredients.length === 0) throw new Error('A receita precisa de pelo menos um ingrediente.');
    for (const ingredient of ingredients) {
      if ((!ingredient.itemId && !ingredient.tag) || (ingredient.itemId && ingredient.tag)) throw new Error('Cada ingrediente deve informar itemId ou tag.');
      if (!Number.isFinite(Number(ingredient.quantity)) || Number(ingredient.quantity) < 1) throw new Error('Quantidade de ingrediente inválida.');
      if (ingredient.itemId) {
        const item = await this.prisma.itemDefinition.findUnique({ where: { id: ingredient.itemId } });
        if (!item) throw new Error(`Ingrediente não encontrado: ${ingredient.itemId}`);
      }
    }
    if ((input.qualityMin ?? 100) < 1 || (input.qualityMax ?? 100) < (input.qualityMin ?? 100)) throw new Error('Faixa de qualidade inválida.');
  }

  private saveVersion(row: any, action: string) {
    return this.prisma.craftRecipeVersion.create({ data: { recipeId: row.id, version: row.version, action, snapshot: toResponse(row) as unknown as Prisma.InputJsonValue } });
  }

  private audit(action: string, entityId: string, before: unknown, after: unknown) {
    return this.prisma.adminAuditLog.create({ data: { actor: 'admin', action, entity_type: 'craft_recipe', entity_id: entityId, before: before == null ? Prisma.JsonNull : before as Prisma.InputJsonValue, after: after == null ? Prisma.JsonNull : after as Prisma.InputJsonValue } });
  }
}

function recipeData(input: RecipeInput, status: string) {
  return {
    ...recipeScalarData(input, status),
    ingredients: { create: ingredientData(input) },
  };
}

function recipeScalarData(input: RecipeInput, status: string) {
  return {
    slug: normalizeSlug(input.slug || input.name),
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    profession: input.profession ?? 'forging',
    requiredLevel: positive(input.requiredLevel, 1),
    station: input.station?.trim() || 'forge',
    outputItemId: input.outputItemId,
    outputQuantity: positive(input.outputQuantity, 1),
    goldCost: Math.max(0, Math.round(input.goldCost ?? 0)),
    experience: positive(input.experience, 10),
    qualityMin: Math.max(1, Math.min(200, Math.round(input.qualityMin ?? 100))),
    qualityMax: Math.max(1, Math.min(200, Math.round(input.qualityMax ?? 100))),
    allowedIntents: (input.allowedIntents ?? []) as unknown as Prisma.InputJsonValue,
    resonanceTags: (input.resonanceTags ?? []) as unknown as Prisma.InputJsonValue,
    status,
  };
}

function ingredientData(input: RecipeInput, recipeId?: string) {
  return (input.ingredients ?? []).map((ingredient) => ({
    ...(recipeId ? { recipeId } : {}),
    itemId: ingredient.itemId || null,
    tag: ingredient.tag || null,
    quantity: positive(ingredient.quantity, 1),
    role: ingredient.role || 'material',
  }));
}

function toResponse(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    profession: row.profession,
    requiredLevel: row.requiredLevel,
    station: row.station,
    outputItemId: row.outputItemId,
    outputQuantity: row.outputQuantity,
    goldCost: row.goldCost,
    experience: row.experience,
    qualityMin: row.qualityMin,
    qualityMax: row.qualityMax,
    allowedIntents: Array.isArray(row.allowedIntents) ? row.allowedIntents : [],
    resonanceTags: Array.isArray(row.resonanceTags) ? row.resonanceTags : [],
    status: row.status,
    version: row.version,
    ingredients: (row.ingredients ?? []).map((ingredient: any) => ({ itemId: ingredient.itemId, tag: ingredient.tag, quantity: ingredient.quantity, role: ingredient.role })),
  };
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `recipe-${Date.now()}`;
}

function positive(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.round(parsed)) : fallback;
}

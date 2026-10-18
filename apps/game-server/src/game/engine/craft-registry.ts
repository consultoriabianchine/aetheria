import type { CraftRecipe, CraftRecipeIngredient, CraftingIntent, CraftingProfession } from '@aetheria/types';
import type { PrismaService } from '../../prisma/prisma.service';

let catalog = new Map<string, CraftRecipe>();

export async function loadCraftRecipeCatalog(prisma: PrismaService | undefined): Promise<void> {
  if (!prisma) {
    catalog = new Map();
    return;
  }
  const rows = await prisma.craftRecipe.findMany({
    where: { status: 'published' },
    include: { ingredients: { orderBy: { id: 'asc' } } },
    orderBy: { name: 'asc' },
  });
  catalog = new Map(rows.map((row) => [row.id, toRecipe(row)]));
}

export function getCraftRecipes(): CraftRecipe[] {
  return [...catalog.values()].map((recipe) => ({ ...recipe, ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient })) }));
}

export function getCraftRecipe(id: string): CraftRecipe | undefined {
  const recipe = catalog.get(id);
  return recipe ? { ...recipe, ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient })) } : undefined;
}

export function setCraftRecipeCatalog(recipes: CraftRecipe[]): void {
  catalog = new Map(recipes.map((recipe) => [recipe.id, { ...recipe, ingredients: recipe.ingredients.map((ingredient) => ({ ...ingredient })) }]));
}

function toRecipe(row: {
  id: string;
  slug: string;
  name: string;
  description: string;
  profession: string;
  requiredLevel: number;
  station: string;
  outputItemId: string;
  outputQuantity: number;
  goldCost: number;
  experience: number;
  qualityMin: number;
  qualityMax: number;
  allowedIntents: unknown;
  resonanceTags: unknown;
  status: string;
  version: number;
  ingredients: Array<{ itemId: string | null; tag: string | null; quantity: number; role: string }>;
}): CraftRecipe {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    profession: normalizeProfession(row.profession),
    requiredLevel: Math.max(1, row.requiredLevel),
    station: row.station,
    outputItemId: row.outputItemId,
    outputQuantity: Math.max(1, row.outputQuantity),
    goldCost: Math.max(0, row.goldCost),
    experience: Math.max(1, row.experience),
    qualityMin: Math.max(1, Math.min(200, row.qualityMin)),
    qualityMax: Math.max(1, Math.min(200, row.qualityMax)),
    allowedIntents: stringArray(row.allowedIntents).filter(isIntent),
    resonanceTags: stringArray(row.resonanceTags),
    ingredients: row.ingredients.map((ingredient) => ({
      ...(ingredient.itemId ? { itemId: ingredient.itemId } : {}),
      ...(ingredient.tag ? { tag: ingredient.tag } : {}),
      quantity: Math.max(1, ingredient.quantity),
      role: normalizeRole(ingredient.role),
    })),
    status: row.status === 'disabled' ? 'disabled' : row.status === 'draft' ? 'draft' : 'published',
    version: Math.max(1, row.version),
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function isIntent(value: string): value is CraftingIntent {
  return ['offense', 'defense', 'arcane', 'utility'].includes(value);
}

function normalizeProfession(value: string): CraftingProfession {
  return value === 'alchemy' || value === 'runecraft' ? value : 'forging';
}

function normalizeRole(value: string): CraftRecipeIngredient['role'] {
  return value === 'base' || value === 'essence' || value === 'catalyst' ? value : 'material';
}

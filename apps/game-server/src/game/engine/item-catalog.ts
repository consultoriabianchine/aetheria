import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AmmoDefinition, ItemDefinition, ItemType, ItemVisualEffects, WeaponDefinition } from '@aetheria/types';
import type { PrismaService } from '../../prisma/prisma.service';

let catalog: Map<string, ItemDefinition> | null = null;

const LOCAL_ITEMS: ItemDefinition[] = ([
  {
    id: 'apprentice-staff',
    name: 'Apprentice Staff',
    type: 'weapon',
    weight: 18,
    stackable: false,
    attack: 12,
    defense: 0,
    image: '',
    category: 'Staff',
    slot: 'weapon',
    weapon: { itemId: 'apprentice-staff', weaponType: 'staff', attackPower: 0, magicPower: 12, damageType: 'arcane', range: 5 },
  },
  {
    id: 'iron-sword',
    name: 'Iron Sword',
    type: 'weapon',
    weight: 35,
    stackable: false,
    attack: 18,
    defense: 0,
    image: '',
    category: 'Sword',
    slot: 'weapon',
    weapon: { itemId: 'iron-sword', weaponType: 'sword', attackPower: 18, damageType: 'physical', range: 1 },
  },
  {
    id: 'hunter-bow',
    name: 'Hunter Bow',
    type: 'weapon',
    weight: 31,
    stackable: false,
    attack: 10,
    defense: 0,
    image: '',
    category: 'Bow',
    slot: 'weapon',
    weapon: { itemId: 'hunter-bow', weaponType: 'bow', attackPower: 10, damageType: 'physical', range: 6, allowedAmmoType: 'arrow' },
  },
  {
    id: 'iron-arrow',
    name: 'Iron Arrow',
    type: 'ammo',
    weight: 0.7,
    stackable: true,
    attack: 8,
    defense: 0,
    image: '',
    category: 'Arrow',
    slot: 'ammo',
    ammo: { itemId: 'iron-arrow', ammoType: 'arrow', attackPower: 8, damageType: 'physical' },
  },
  {
    id: 'novice-spellbook',
    name: 'Novice Spellbook',
    type: 'offhand',
    weight: 12,
    stackable: false,
    attack: 4,
    defense: 1,
    image: '',
    category: 'Spellbook',
    slot: 'offhand',
    combatStats: { magicPower: 4, defense: 1, maxMana: 15 },
  },
  {
    id: 'apprentice-robe',
    name: 'Apprentice Robe',
    type: 'armor',
    weight: 18,
    stackable: false,
    attack: 2,
    defense: 0,
    image: '',
    category: 'Robe',
    slot: 'armor',
    combatStats: { armor: 2, maxMana: 10 },
  },
  {
    id: 'cloth-boots',
    name: 'Cloth Boots',
    type: 'boots',
    weight: 8,
    stackable: false,
    attack: 1,
    defense: 0,
    image: '',
    category: 'Boots',
    slot: 'boots',
    combatStats: { armor: 1 },
  },
  {
    id: 'training-shield',
    name: 'Training Shield',
    type: 'offhand',
    weight: 32,
    stackable: false,
    attack: 0,
    defense: 8,
    image: '',
    category: 'Shield',
    slot: 'offhand',
    combatStats: { defense: 8 },
  },
  {
    id: 'leather-helmet',
    name: 'Leather Helmet',
    type: 'helmet',
    weight: 18,
    stackable: false,
    attack: 2,
    defense: 0,
    image: '',
    category: 'Helmet',
    slot: 'helmet',
    combatStats: { armor: 2 },
  },
  {
    id: 'leather-armor',
    name: 'Leather Armor',
    type: 'armor',
    weight: 35,
    stackable: false,
    attack: 4,
    defense: 0,
    image: '',
    category: 'Armor',
    slot: 'armor',
    combatStats: { armor: 4 },
  },
  {
    id: 'leather-legs',
    name: 'Leather Legs',
    type: 'legs',
    weight: 22,
    stackable: false,
    attack: 2,
    defense: 0,
    image: '',
    category: 'Legs',
    slot: 'legs',
    combatStats: { armor: 2 },
  },
  {
    id: 'leather-boots',
    name: 'Leather Boots',
    type: 'boots',
    weight: 12,
    stackable: false,
    attack: 1,
    defense: 0,
    image: '',
    category: 'Boots',
    slot: 'boots',
    combatStats: { armor: 1 },
  },
] satisfies Omit<ItemDefinition, 'sellValue'>[]).map((item) => ({ ...item, sellValue: estimateSellValue(item) }));

function estimateSellValue(item: Omit<ItemDefinition, 'sellValue'>): number {
  if (item.id === 'gold') return 1;
  const combatValue = item.attack + item.defense + (item.combatStats?.attackPower ?? 0) + (item.combatStats?.magicPower ?? 0) + (item.combatStats?.armor ?? 0) + (item.combatStats?.defense ?? 0);
  const typeMultiplier = item.type === 'loot' ? 2 : item.slot ? 8 : 1;
  return Math.max(1, Math.round((combatValue + Math.max(1, item.weight)) * typeMultiplier));
}

type ItemDefinitionRow = {
  id: string;
  name: string;
  description: string;
  type: string;
  slot: string | null;
  imagePath: string | null;
  stackable: boolean;
  weight: number;
  category: string;
  sellValue: number;
  attackPower: number;
  magicPower: number;
  armor: number;
  defense: number;
  maxHp: number;
  maxMana: number;
  criticalChance: number;
  criticalDamage: number;
  accuracy: number;
  dodge: number;
  weapon: unknown;
  ammo: unknown;
  skillBonuses: unknown;
  resistances: unknown;
  specialModifiers: unknown;
  enabled: boolean;
};

/** Carrega o catálogo de itens gerado (data/items.json) uma única vez. */
export function getItemCatalog(): Map<string, ItemDefinition> {
  if (catalog) return catalog;
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'data', 'items.json'),
    path.join(__dirname, '..', '..', 'data', 'items.json'),
    path.join(process.cwd(), 'data', 'items.json'),
    path.join(process.cwd(), 'apps', 'game-server', 'data', 'items.json'),
  ];
  const file = candidates.find((c) => existsSync(c));
  if (!file) throw new Error(`items.json não encontrado (procurado em: ${candidates.join(', ')})`);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { items: ItemDefinition[] };
  catalog = new Map([...LOCAL_ITEMS, ...parsed.items].map((i) => [i.id, i]));
  return catalog;
}

export async function loadItemCatalogFromDatabase(prisma: PrismaService | undefined): Promise<void> {
  if (!prisma) {
    catalog = null;
    getItemCatalog();
    return;
  }
  const rows = await prisma.itemDefinition.findMany({ where: { enabled: true }, orderBy: { name: 'asc' } });
  catalog = new Map([...LOCAL_ITEMS, ...rows.map((row) => rowToItemDefinition(row as unknown as ItemDefinitionRow))].map((i) => [i.id, i]));
}

export function setItemCatalog(items: ItemDefinition[]): void {
  catalog = new Map([...LOCAL_ITEMS, ...items].map((i) => [i.id, i]));
}

export function getItemDef(id: string): ItemDefinition | undefined {
  return getItemCatalog().get(id);
}

export function rowToItemDefinition(row: ItemDefinitionRow): ItemDefinition {
  const combatStats = {
    attackPower: row.attackPower || undefined,
    magicPower: row.magicPower || undefined,
    armor: row.armor || undefined,
    defense: row.defense || undefined,
    maxHp: row.maxHp || undefined,
    maxMana: row.maxMana || undefined,
    criticalChance: row.criticalChance || undefined,
    criticalDamage: row.criticalDamage || undefined,
    accuracy: row.accuracy || undefined,
    dodge: row.dodge || undefined,
    skillBonuses: isObject(row.skillBonuses) ? row.skillBonuses : undefined,
    resistances: isObject(row.resistances) ? row.resistances : undefined,
  };
  return {
    id: row.id,
    name: row.name,
    type: row.type as ItemType,
    weight: row.weight,
    stackable: row.stackable,
    attack: row.attackPower + row.magicPower + row.armor,
    defense: row.defense,
    image: row.imagePath ?? '',
    category: row.category,
    sellValue: row.sellValue,
    slot: (row.slot ?? undefined) as ItemDefinition['slot'],
    combatStats,
    weapon: isObject(row.weapon) ? (row.weapon as unknown as WeaponDefinition) : undefined,
    ammo: isObject(row.ammo) ? (row.ammo as unknown as AmmoDefinition) : undefined,
    visual: visualFromSpecialModifiers(row.specialModifiers),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function visualFromSpecialModifiers(value: unknown): ItemVisualEffects | undefined {
  if (!isObject(value) || !isObject(value['visual'])) return undefined;
  return value['visual'] as unknown as ItemVisualEffects;
}

import { PrismaClient } from '@aetheria/database';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NPC_TEMPLATES } from '@aetheria/config';
import { generateWorldMap } from '../src/game/engine/world-map';
import { CREATURE_SEED, CREATURE_SPAWN_SEED } from '../data/creature-seed';

const prisma = new PrismaClient();

const INITIAL_ITEM_DEFINITIONS = [
  {
    id: 'apprentice-staff',
    name: 'Apprentice Staff',
    description: 'Cajado inicial para magos aprendizes.',
    type: 'weapon',
    slot: 'weapon',
    imagePath: null,
    stackable: false,
    weight: 18,
    category: 'Staff',
    attackPower: 0,
    magicPower: 12,
    armor: 0,
    defense: 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: { itemId: 'apprentice-staff', weaponType: 'staff', attackPower: 0, magicPower: 12, damageType: 'arcane', range: 5 },
    ammo: undefined,
  },
  {
    id: 'iron-sword',
    name: 'Iron Sword',
    description: 'Espada inicial simples e confiável.',
    type: 'weapon',
    slot: 'weapon',
    imagePath: null,
    stackable: false,
    weight: 35,
    category: 'Sword',
    attackPower: 18,
    magicPower: 0,
    armor: 0,
    defense: 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: { itemId: 'iron-sword', weaponType: 'sword', attackPower: 18, damageType: 'physical', range: 1 },
    ammo: undefined,
  },
  {
    id: 'hunter-bow',
    name: 'Hunter Bow',
    description: 'Arco inicial para combate à distância.',
    type: 'weapon',
    slot: 'weapon',
    imagePath: null,
    stackable: false,
    weight: 31,
    category: 'Bow',
    attackPower: 10,
    magicPower: 0,
    armor: 0,
    defense: 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: { itemId: 'hunter-bow', weaponType: 'bow', attackPower: 10, damageType: 'physical', range: 6, allowedAmmoType: 'arrow' },
    ammo: undefined,
  },
  {
    id: 'iron-arrow',
    name: 'Iron Arrow',
    description: 'Munição inicial para arcos.',
    type: 'ammo',
    slot: 'ammo',
    imagePath: null,
    stackable: true,
    weight: 0.7,
    category: 'Arrow',
    attackPower: 8,
    magicPower: 0,
    armor: 0,
    defense: 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: undefined,
    ammo: { itemId: 'iron-arrow', ammoType: 'arrow', attackPower: 8, damageType: 'physical' },
  },
  {
    id: 'novice-spellbook',
    name: 'Novice Spellbook',
    description: 'Livro de foco inicial para magos aprendizes.',
    type: 'offhand',
    slot: 'offhand',
    imagePath: null,
    stackable: false,
    weight: 12,
    category: 'Spellbook',
    attackPower: 0,
    magicPower: 4,
    armor: 0,
    defense: 1,
    maxHp: 0,
    maxMana: 15,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: undefined,
    ammo: undefined,
  },
  {
    id: 'apprentice-robe',
    name: 'Apprentice Robe',
    description: 'Veste leve usada por magos iniciantes.',
    type: 'armor',
    slot: 'armor',
    imagePath: null,
    stackable: false,
    weight: 18,
    category: 'Robe',
    attackPower: 0,
    magicPower: 0,
    armor: 2,
    defense: 0,
    maxHp: 0,
    maxMana: 10,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: undefined,
    ammo: undefined,
  },
  {
    id: 'cloth-boots',
    name: 'Cloth Boots',
    description: 'Botas simples de tecido.',
    type: 'boots',
    slot: 'boots',
    imagePath: null,
    stackable: false,
    weight: 8,
    category: 'Boots',
    attackPower: 0,
    magicPower: 0,
    armor: 1,
    defense: 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: undefined,
    ammo: undefined,
  },
  {
    id: 'training-shield',
    name: 'Training Shield',
    description: 'Escudo resistente para guerreiros em treinamento.',
    type: 'offhand',
    slot: 'offhand',
    imagePath: null,
    stackable: false,
    weight: 32,
    category: 'Shield',
    attackPower: 0,
    magicPower: 0,
    armor: 0,
    defense: 8,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: undefined,
    ammo: undefined,
  },
  {
    id: 'leather-helmet',
    name: 'Leather Helmet',
    description: 'Capacete de couro básico.',
    type: 'helmet',
    slot: 'helmet',
    imagePath: null,
    stackable: false,
    weight: 18,
    category: 'Helmet',
    attackPower: 0,
    magicPower: 0,
    armor: 2,
    defense: 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: undefined,
    ammo: undefined,
  },
  {
    id: 'leather-armor',
    name: 'Leather Armor',
    description: 'Armadura de couro básica.',
    type: 'armor',
    slot: 'armor',
    imagePath: null,
    stackable: false,
    weight: 35,
    category: 'Armor',
    attackPower: 0,
    magicPower: 0,
    armor: 4,
    defense: 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: undefined,
    ammo: undefined,
  },
  {
    id: 'leather-legs',
    name: 'Leather Legs',
    description: 'Calças de couro básicas.',
    type: 'legs',
    slot: 'legs',
    imagePath: null,
    stackable: false,
    weight: 22,
    category: 'Legs',
    attackPower: 0,
    magicPower: 0,
    armor: 2,
    defense: 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: undefined,
    ammo: undefined,
  },
  {
    id: 'leather-boots',
    name: 'Leather Boots',
    description: 'Botas de couro básicas.',
    type: 'boots',
    slot: 'boots',
    imagePath: null,
    stackable: false,
    weight: 12,
    category: 'Boots',
    attackPower: 0,
    magicPower: 0,
    armor: 1,
    defense: 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: undefined,
    ammo: undefined,
  },
] as const;

async function seed() {
  const items = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'items.json'), 'utf8')) as {
    items: {
      id: string;
      name: string;
      type: string;
      weight: number;
      stackable: boolean;
      attack: number;
      defense: number;
      image: string | null;
      category: string;
      slot: string | null;
    }[];
  };
  const itemNameById = new Map(items.items.map((i) => [i.id, i.name]));

  for (const item of INITIAL_ITEM_DEFINITIONS) {
    await prisma.itemDefinition.upsert({
      where: { id: item.id },
      update: item,
      create: item,
    });
  }

  for (const def of CREATURE_SEED) {
    const { loot, ...definition } = def;
    const gameFields = {
      name: definition.name,
      description: definition.description,
      type: definition.type,
      game_level: definition.level,
      game_max_health: definition.maxHealth,
      game_attack: definition.attack,
      game_defense: definition.defense,
      game_experience: definition.experience,
      game_speed: definition.movementSpeed,
      game_attack_speed: definition.attackSpeed,
      game_attack_range: definition.attackRange,
      game_view_range: definition.viewRange,
      game_chase_range: definition.chaseRange,
      game_flee_health_percent: definition.fleeHealthPercent,
      game_can_wander: definition.canWander,
      game_can_chase: definition.canChase,
      game_can_flee: definition.canFlee,
      game_return_to_spawn: definition.returnToSpawn,
    };
    await prisma.creatureDefinition.upsert({
      where: { slug: def.slug },
      update: gameFields,
      create: {
        id: definition.id,
        slug: definition.slug,
        ...gameFields,
      },
    });
    await prisma.creatureLoot.deleteMany({ where: { creature_id: definition.id } });
    await prisma.creatureLoot.createMany({
      data: loot.map((l) => ({
        creature_id: definition.id,
        item_id: l.itemId,
        item_name: itemNameById.get(l.itemId) ?? l.itemId,
        item_slug: l.itemId,
        chance: l.chance,
        min_quantity: l.minQuantity,
        max_quantity: l.maxQuantity,
        rarity: 'COMMON',
      })),
    });
  }

  for (const npc of Object.values(NPC_TEMPLATES)) {
    await prisma.npc.upsert({
      where: { id: npc.id },
      update: { name: npc.name, title: npc.dialogue.title, lines: npc.dialogue.lines },
      create: { id: npc.id, name: npc.name, title: npc.dialogue.title, lines: npc.dialogue.lines },
    });
  }

  const world = generateWorldMap();
  await prisma.map.deleteMany({});
  const map = await prisma.map.create({
    data: { id: 'world', name: 'Aetheria', width: world.width, height: world.height },
  });
  await prisma.mapTile.createMany({
    data: world.tiles.map((t) => ({
      mapId: map.id,
      x: t.x,
      y: t.y,
      z: t.z,
      type: t.type,
      walkable: t.walkable,
      blocksVision: t.blocksVision,
    })),
  });

  for (const spawn of CREATURE_SPAWN_SEED) {
    const id = `${spawn.creatureDefinitionId}-${spawn.x}-${spawn.y}-${spawn.z}`;
    await prisma.creatureSpawn.upsert({
      where: { id },
      update: { map_id: 'world', respawn_time: spawn.respawnTime, max_instances: spawn.maxInstances },
      create: {
        id,
        creature_definition_id: spawn.creatureDefinitionId,
        map_id: 'world',
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        respawn_time: spawn.respawnTime,
        max_instances: spawn.maxInstances,
      },
    });
  }

  console.log(
    'Seed concluído:',
    INITIAL_ITEM_DEFINITIONS.length,
    'item_definitions,',
    world.tiles.length,
    'tiles,',
    CREATURE_SEED.length,
    'criaturas,',
    CREATURE_SPAWN_SEED.length,
    'spawns.',
  );
}

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

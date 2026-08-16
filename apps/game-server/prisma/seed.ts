import { PrismaClient } from '@aetheria/database';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NPC_TEMPLATES } from '@aetheria/config';
import { generateWorldMap } from '../src/game/engine/world-map';
import { CREATURE_SEED, CREATURE_SPAWN_SEED } from '../data/creature-seed';

const prisma = new PrismaClient();

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

  for (const item of items.items) {
    await prisma.item.upsert({
      where: { id: item.id },
      update: { ...item, slot: item.slot ?? null },
      create: { ...item, slot: item.slot ?? null },
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
    items.items.length,
    'itens,',
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
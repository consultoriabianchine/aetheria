import { PrismaClient, Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { MONSTER_SPAWNS, MONSTER_TEMPLATES, NPC_TEMPLATES } from '@aetheria/config';
import { generateWorldMap } from '../src/game/engine/world-map';

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

  for (const item of items.items) {
    await prisma.item.upsert({
      where: { id: item.id },
      update: { ...item, slot: item.slot ?? null },
      create: { ...item, slot: item.slot ?? null },
    });
  }

  for (const template of Object.values(MONSTER_TEMPLATES)) {
    await prisma.monster.upsert({
      where: { id: template.id },
      update: {
        templateId: template.id,
        name: template.name,
        level: template.level,
        maxHealth: template.maxHealth,
        attack: template.attack,
        defense: template.defense,
        speed: template.speed,
        attackRange: template.attackRange,
        attackInterval: template.attackInterval,
        experience: template.experience,
        aggroRadius: template.aggroRadius,
        leashRadius: template.leashRadius,
        loot: template.loot as unknown as Prisma.InputJsonValue,
      },
      create: {
        id: template.id,
        templateId: template.id,
        name: template.name,
        level: template.level,
        maxHealth: template.maxHealth,
        attack: template.attack,
        defense: template.defense,
        speed: template.speed,
        attackRange: template.attackRange,
        attackInterval: template.attackInterval,
        experience: template.experience,
        aggroRadius: template.aggroRadius,
        leashRadius: template.leashRadius,
        loot: template.loot as unknown as Prisma.InputJsonValue,
      },
    });
  }

  for (const spawn of MONSTER_SPAWNS) {
    await prisma.monsterSpawn.upsert({
      where: { id: `${spawn.templateId}-${spawn.x}-${spawn.y}` },
      update: spawn,
      create: { id: `${spawn.templateId}-${spawn.x}-${spawn.y}`, ...spawn },
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
    data: { name: 'Aetheria', width: world.width, height: world.height },
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

  console.log('Seed concluído:', items.items.length, 'itens,', world.tiles.length, 'tiles.');
}

seed()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
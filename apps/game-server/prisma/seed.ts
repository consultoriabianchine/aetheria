import { PrismaClient } from '@aetheria/database';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { NPC_TEMPLATES, DEFAULT_TILESET_SLUG, TILE } from '@aetheria/config';
import { generateWorldMap } from '../src/game/engine/world-map';
import { CREATURE_SEED, CREATURE_SPAWN_SEED } from '../data/creature-seed';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// PNG encoder mínimo (para o Default Tileset, sem dependência de canvas).
// ---------------------------------------------------------------------------

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const DEFAULT_TILES = [
  { tile: TILE.GRASS, name: 'Grass', category: 'ground', layer: 'ground', color: [74, 138, 61, 255] },
  { tile: TILE.PATH, name: 'Path', category: 'path', layer: 'ground', color: [179, 160, 108, 255] },
  { tile: TILE.WATER, name: 'Water', category: 'water', layer: 'ground', color: [61, 111, 163, 255] },
  { tile: TILE.TREE, name: 'Tree', category: 'vegetation', layer: 'object', color: [47, 107, 47, 255] },
  { tile: TILE.ROCK, name: 'Rock', category: 'rock', layer: 'object', color: [138, 141, 146, 255] },
  { tile: TILE.WALL, name: 'Wall', category: 'wall', layer: 'object', color: [86, 90, 96, 255] },
] as const;

/** Gera uma strip 6×1 (192×32) com os tiles base e dá seed do tileset padrão. */
async function seedDefaultTileset() {
  const existing = await prisma.tileset.findUnique({ where: { slug: DEFAULT_TILESET_SLUG } });
  if (existing) return existing;

  const tileSize = 32;
  const width = DEFAULT_TILES.length * tileSize;
  const height = tileSize;
  const rgba = Buffer.alloc(width * height * 4);
  for (let t = 0; t < DEFAULT_TILES.length; t++) {
    const [r, g, b, a] = DEFAULT_TILES[t].color;
    for (let py = 0; py < tileSize; py++) {
      for (let px = 0; px < tileSize; px++) {
        const idx = (py * width + (t * tileSize + px)) * 4;
        // leve ruído determinístico para textura
        const n = ((px * 7 + py * 13 + t * 17) % 9) - 4;
        rgba[idx] = Math.max(0, Math.min(255, r + n));
        rgba[idx + 1] = Math.max(0, Math.min(255, g + n));
        rgba[idx + 2] = Math.max(0, Math.min(255, b + n));
        rgba[idx + 3] = a;
      }
    }
  }
  const png = encodePng(width, height, rgba);
  const checksum = createHash('sha256').update(png).digest('hex');

  const asset = await prisma.spriteAsset.create({
    data: {
      file_name: `tileset_default.png`,
      mime_type: 'image/png',
      file_size: png.length,
      image_width: width,
      image_height: height,
      data: new Uint8Array(png),
      checksum,
    },
  });

  const tileset = await prisma.tileset.create({
    data: {
      name: 'aetheria Default Tiles',
      slug: DEFAULT_TILESET_SLUG,
      sprite_asset_id: asset.sprite_asset_id,
      tile_width: tileSize,
      tile_height: tileSize,
      columns: DEFAULT_TILES.length,
      rows: 1,
    },
  });

  await prisma.tileDefinition.createMany({
    data: DEFAULT_TILES.map((d, index) => {
      const isWall = d.tile === TILE.WALL;
      const isWater = d.tile === TILE.WATER;
      const isTree = d.tile === TILE.TREE;
      const isRock = d.tile === TILE.ROCK;
      const isWalkable = d.tile === TILE.GRASS || d.tile === TILE.PATH;
      const blocksMovement = isWall || isWater || isTree || isRock;
      const blocksVision = isWall || isTree || isRock;
      return {
        tileset_id: tileset.tileset_id,
        index,
        source_x: index * tileSize,
        source_y: 0,
        width: tileSize,
        height: tileSize,
        name: d.name,
        category: d.category,
        layer_type: d.layer,
        walkable: isWalkable,
        blocks_movement: blocksMovement,
        blocks_projectiles: blocksMovement && !isWater,
        blocks_vision: blocksVision,
        is_water: isWater,
        tags: [],
      };
    }),
  });

  return tileset;
}

const INITIAL_ABILITIES = [
  { slug: 'fire-strike', name: 'Fire Strike', owner_type: 'player', player_class: 'mage', category: 'attack', target_mode: 'single_enemy', damage_type: 'fire', power_source: 'magic_weapon', cooldown_ms: 4000, cooldown_group: 'attack', range_tiles: 5, mana_cost: 25, allowed_parameters: [], enabled: true },
  { slug: 'heavy-slash', name: 'Heavy Slash', owner_type: 'player', player_class: 'warrior', category: 'attack', target_mode: 'single_enemy', damage_type: 'physical', power_source: 'weapon', cooldown_ms: 4000, cooldown_group: 'attack', range_tiles: 1, mana_cost: 0, allowed_parameters: [], enabled: true },
  { slug: 'arrow-shot', name: 'Arrow Shot', owner_type: 'both', player_class: 'archer', category: 'attack', target_mode: 'single_enemy', damage_type: 'physical', power_source: 'weapon_ammo', cooldown_ms: 3000, cooldown_group: 'attack', range_tiles: 6, mana_cost: 0, allowed_parameters: [{ key: 'power', label: 'Power', min: 0, max: 10000 }], enabled: true },
  { slug: 'throw-rock', name: 'Throw Rock', owner_type: 'monster', category: 'attack', target_mode: 'single_enemy', damage_type: 'physical', power_source: 'monster_parameters', cooldown_ms: 5000, cooldown_group: 'attack', range_tiles: 6, allowed_parameters: [{ key: 'power', label: 'Power', min: 0, max: 10000 }], enabled: true },
  { slug: 'fire-wave', name: 'Fire Wave', owner_type: 'both', player_class: 'mage', category: 'area', target_mode: 'area_enemy', damage_type: 'fire', power_source: 'magic_weapon', cooldown_ms: 8000, cooldown_group: 'attack', range_tiles: 5, mana_cost: 60, area_config: { shape: 'wave', width: 3, height: 3 }, allowed_parameters: [{ key: 'minTargets', label: 'Minimum targets', min: 1, max: 20 }], enabled: true },
  { slug: 'minor-heal', name: 'Minor Heal', owner_type: 'both', category: 'heal', target_mode: 'self', damage_type: 'holy', power_source: 'fixed', cooldown_ms: 4000, cooldown_group: 'healing', range_tiles: 0, mana_cost: 20, allowed_parameters: [{ key: 'power', label: 'Power', min: 1, max: 10000 }], default_parameters: { power: 30 }, enabled: true },
] as const;


type SourceItem = {
  id: string;
  name: string;
  type: string;
  weight: number;
  stackable: boolean;
  attack: number;
  defense: number;
  image: string | null;
  category: string;
  slot?: string | null;
};

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

const INITIAL_ITEM_IMAGE_FALLBACK: Record<string, string> = {
  'apprentice-staff': 'Staff.gif',
  'iron-sword': 'Sword.gif',
  'hunter-bow': 'Bow.gif',
  'iron-arrow': 'Arrow.gif',
  'novice-spellbook': 'Spellbook_of_the_Novice.gif',
  'apprentice-robe': 'Magician\'s_Robe.gif',
  'cloth-boots': 'Leather_Boots.gif',
  'training-shield': 'Training_Shield.gif',
};

function normalizeSlot(slot: string | null | undefined): string | null {
  if (slot === 'head') return 'helmet';
  if (slot === 'shield') return 'offhand';
  return slot ?? null;
}

function normalizeType(item: SourceItem): string {
  if (item.type === 'shield') return 'offhand';
  if (item.id === 'arrow') return 'ammo';
  return item.type;
}

function weaponType(item: SourceItem): string {
  const category = item.category.toLowerCase();
  if (category.includes('machado')) return 'axe';
  if (category.includes('clava')) return 'club';
  if (category.includes('dist')) return 'bow';
  if (category.includes('espada')) return 'sword';
  return 'sword';
}

function itemDefinitionFromSource(item: SourceItem, fallbackName?: string) {
  const slot = normalizeSlot(item.slot);
  const type = normalizeType(item);
  const isWeapon = slot === 'weapon';
  const isAmmo = item.id === 'arrow' || slot === 'ammo';
  const isArmorSlot = slot === 'helmet' || slot === 'armor' || slot === 'legs' || slot === 'boots';
  const isOffhand = slot === 'offhand';
  return {
    id: item.id,
    name: item.name || fallbackName || item.id,
    description: `Item de loot: ${item.name || fallbackName || item.id}.`,
    type,
    slot: isAmmo ? 'ammo' : slot,
    imagePath: item.image,
    stackable: item.stackable,
    weight: item.weight,
    category: item.category || 'Loot',
    sellValue: estimateSellValue({ id: item.id, type, slot, weight: item.weight, attack: item.attack, defense: item.defense }),
    attackPower: isWeapon || isAmmo ? item.attack : 0,
    magicPower: 0,
    armor: isArmorSlot ? item.attack : 0,
    defense: isWeapon || isOffhand ? item.defense : 0,
    maxHp: 0,
    maxMana: 0,
    criticalChance: 0,
    criticalDamage: 0,
    accuracy: 0,
    dodge: 0,
    weapon: isWeapon
      ? {
          itemId: item.id,
          weaponType: weaponType(item),
          attackPower: item.attack,
          damageType: 'physical',
          range: weaponType(item) === 'bow' ? 6 : 1,
          allowedAmmoType: weaponType(item) === 'bow' ? 'arrow' : undefined,
        }
      : undefined,
    ammo: isAmmo ? { itemId: item.id, ammoType: 'arrow', attackPower: item.attack, damageType: 'physical' } : undefined,
  };
}

function estimateSellValue(item: { id: string; type: string; slot: string | null; weight: number; attack: number; defense: number }): number {
  if (item.id === 'gold') return 1;
  const typeMultiplier = item.type === 'loot' ? 2 : item.slot ? 8 : 1;
  return Math.max(1, Math.round((item.attack + item.defense + Math.max(1, item.weight)) * typeMultiplier));
}

async function seedLootItemDefinitions(items: SourceItem[]) {
  const sourceById = new Map(items.map((item) => [item.id, item]));
  const lootById = new Map<string, string>();
  for (const creature of CREATURE_SEED) {
    for (const loot of creature.loot) {
      lootById.set(loot.itemId, sourceById.get(loot.itemId)?.name ?? loot.itemId);
    }
  }

  let created = 0;
  for (const [itemId, fallbackName] of lootById) {
    const source = sourceById.get(itemId) ?? {
      id: itemId,
      name: fallbackName,
      type: 'loot',
      weight: 0,
      stackable: true,
      attack: 0,
      defense: 0,
      image: null,
      category: 'Loot',
      slot: null,
    };
    const data = itemDefinitionFromSource(source, fallbackName);
    const existing = await prisma.itemDefinition.findUnique({ where: { id: itemId }, select: { id: true, imagePath: true, sellValue: true } });
    if (existing) {
      if (existing.sellValue <= 0 || !existing.imagePath) {
        await prisma.itemDefinition.update({
          where: { id: itemId },
          data: {
            sellValue: existing.sellValue > 0 ? existing.sellValue : data.sellValue,
            imagePath: existing.imagePath ?? data.imagePath,
          },
        });
      }
      continue;
    }
    await prisma.itemDefinition.create({ data });
    created++;
  }
  return { total: lootById.size, created };
}

async function seed() {
  await seedDefaultTileset();
  const items = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'items.json'), 'utf8')) as {
    items: SourceItem[];
  };
  const sourceById = new Map(items.items.map((i) => [i.id, i]));
  const itemNameById = new Map(items.items.map((i) => [i.id, i.name]));

  for (const item of INITIAL_ITEM_DEFINITIONS) {
    const existing = await prisma.itemDefinition.findUnique({ where: { id: item.id }, select: { imagePath: true, sellValue: true } });
    const imagePath = existing?.imagePath ?? sourceById.get(item.id)?.image ?? INITIAL_ITEM_IMAGE_FALLBACK[item.id] ?? item.imagePath;
    const source = sourceById.get(item.id);
    const sellValue = existing && existing.sellValue > 0
      ? existing.sellValue
      : estimateSellValue({
          id: item.id,
          type: item.type,
          slot: item.slot,
          weight: item.weight,
          attack: source?.attack ?? item.attackPower + item.magicPower + item.armor,
          defense: source?.defense ?? item.defense,
        });
    await prisma.itemDefinition.upsert({
      where: { id: item.id },
      update: { ...item, imagePath, sellValue },
      create: { ...item, imagePath, sellValue },
    });
  }

  const lootItems = await seedLootItemDefinitions(items.items);
  for (const ability of INITIAL_ABILITIES) {
    await prisma.combatAbility.upsert({ where: { slug: ability.slug }, update: ability, create: ability });
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
    'item_definitions iniciais,',
    lootItems.total,
    'loot item_definitions mapeados,',
    lootItems.created,
    'criados,',
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

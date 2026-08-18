const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('../packages/database/generated');
const { decodePng, centerSheet } = require('./lib/png.cjs');

const prisma = new PrismaClient();

const CREATURES_DIR = path.resolve(__dirname, '../apps/web/src/assets/creatures');

const DIRS = ['south', 'east', 'north', 'west'];

function sheetConfig(spriteWidth, spriteHeight, columns, rows, anims) {
  return {
    spriteWidth,
    spriteHeight,
    sheetColumns: columns,
    sheetRows: rows,
    anchor: { x: spriteWidth / 2, y: spriteHeight },
    animations: anims,
  };
}

// Assume layout row-major com `columns` colunas = direções [south, east, north, west];
// linhas 0..7 = walk, linha 8 = idle. Refine na Central de Comando se necessário.
function standardConfig(columns) {
  const animations = [];
  DIRS.forEach((dir, col) => {
    const walk = [];
    for (let row = 0; row < 8; row++) walk.push(row * columns + col);
    animations.push({ animation: 'walk', direction: dir, frames: walk, frameDurationMs: 120, loop: true });
    animations.push({ animation: 'idle', direction: dir, frames: [8 * columns + col], frameDurationMs: 400, loop: true });
  });
  return animations;
}

async function upsertAsset(slug, fileName, cellSize) {
  const def = await prisma.creatureDefinition.findUnique({ where: { slug } });
  if (!def) {
    console.log(`SKIP ${slug} (não encontrada)`);
    return null;
  }
  const existing = await prisma.creatureSpriteAsset.findUnique({ where: { creature_id: def.creature_id } });
  if (existing) {
    console.log(`SPRITE ${slug} já existe — mantido (configurado na Central de Comando)`);
    return { creatureId: def.creature_id, width: existing.image_width, height: existing.image_height };
  }
  const src = decodePng(fs.readFileSync(path.join(CREATURES_DIR, fileName)));
  const centered = centerSheet(src, cellSize);
  const data = centered ? centered.png : fs.readFileSync(path.join(CREATURES_DIR, fileName));
  const mime = 'image/png';
  const checksum = crypto.createHash('sha256').update(data).digest('hex');
  const width = src.width;
  const height = src.height;
  await prisma.creatureSpriteAsset.create({
    data: { creature_id: def.creature_id, file_name: fileName, mime_type: mime, file_size: data.length, image_width: width, image_height: height, data, checksum, uploaded_by: 'migration' },
  });
  console.log(`UPLOAD ${slug} (creature_id=${def.creature_id}) ${width}x${height}`);
  return { creatureId: def.creature_id, width, height };
}

async function upsertConfig(creatureId, config) {
  const existing = await prisma.creatureAnimationConfig.findUnique({ where: { creature_id: creatureId } });
  if (existing) {
    console.log(`CONFIG creature_id=${creatureId} já existe (v${existing.version}) — mantido, configure na Central de Comando`);
    return;
  }
  const created = await prisma.creatureAnimationConfig.create({
    data: { creature_id: creatureId, version: 1, config },
  });
  console.log(`CONFIG creature_id=${creatureId} criado version=${created.version} seqs=${config.animations.length}`);
}

(async () => {
  // dwarf: 128x288 = 4 colunas x 9 linhas (32x32)
  const dwarf = await upsertAsset('dwarf', 'dwarf_todos_movimentos.png', 32);
  if (dwarf) await upsertConfig(dwarf.creatureId, sheetConfig(32, 32, 4, 9, standardConfig(4)));

  // troll: 256x576 = 4 colunas x 9 linhas (64x64)
  const troll = await upsertAsset('troll', 'troll_todos_movimentos.png', 64);
  if (troll) await upsertConfig(troll.creatureId, sheetConfig(64, 64, 4, 9, standardConfig(4)));

  await prisma.$disconnect();
  console.log('OK');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

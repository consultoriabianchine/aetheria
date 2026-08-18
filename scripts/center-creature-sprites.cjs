const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PrismaClient } = require('../packages/database/generated');
const { decodePng, centerSheet } = require('./lib/png.cjs');

const prisma = new PrismaClient();
const CREATURES_DIR = path.resolve(__dirname, '../apps/web/src/assets/creatures');

(async () => {
  const targets = [
    { slug: 'troll', fileName: 'troll_todos_movimentos.png', C: 64 },
  ];
  for (const t of targets) {
    const src = decodePng(fs.readFileSync(path.join(CREATURES_DIR, t.fileName)));
    const res = centerSheet(src, t.C);
    if (!res) { console.log(t.slug, 'sem arte'); continue; }
    const def = await prisma.creatureDefinition.findUnique({ where: { slug: t.slug } });
    if (!def) { console.log(t.slug, 'não encontrada'); continue; }
    const checksum = crypto.createHash('sha256').update(res.png).digest('hex');
    await prisma.creatureSpriteAsset.upsert({
      where: { creature_id: def.creature_id },
      create: { creature_id: def.creature_id, file_name: t.fileName, mime_type: 'image/png', file_size: res.png.length, image_width: src.width, image_height: src.height, data: res.png, checksum, uploaded_by: 'migration' },
      update: { file_name: t.fileName, mime_type: 'image/png', file_size: res.png.length, image_width: src.width, image_height: src.height, data: res.png, checksum, uploaded_by: 'migration' },
    });
    console.log(`${t.slug}: shiftX=${res.shiftX} ${src.width}x${src.height} atualizado`);
  }
  await prisma.$disconnect();
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });
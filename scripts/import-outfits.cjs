const fs = require('fs');
const crypto = require('crypto');
const { PrismaClient } = require('../packages/database/generated');
const { decodePng, encodePng, artBBox } = require('./lib/png.cjs');

const prisma = new PrismaClient();

function isMaskColor(r, g, b, a) {
  if (a < 128) return null;
  if (r > 200 && g > 200 && b < 60) return 'head';
  if (r > 200 && g < 60 && b < 60) return 'primary';
  if (r < 60 && g > 200 && b < 60) return 'secondary';
  if (r < 60 && g < 60 && b > 200) return 'detail';
  return null;
}

/**
 * Extrai base e máscara ALINHADAS mantendo a grade original (16 colunas × 27 linhas
 * em 64px). O sheet original intercala [base][máscara] por direção nas colunas pares
 * (base) e ímpares (máscara). Aqui a máscara é deslocada para a coluna PAR para que
 * base e máscara fiquem na MESMA célula (necessário para o recolor pixel-a-pixel).
 * Colunas ímpares ficam transparentes (nunca renderizadas pela config).
 *
 * A arte original ocupa a metade DIREITA da célula 64x64 (x em [C/2, C)) e pode
 * exceder 32px. Para que o sprite fique centralizado no tile (origem 0.5,1) SEM
 * cortar nada, calcula o bounding box real da arte (apenas nas linhas de frame,
 * onde existe máscara) e desloca TODA a arte por um shift uniforme para o centro.
 */
function extractAligned(src, C) {
  const cols = src.width / C;
  const rows = src.height / C;
  const w = cols * C;
  const h = rows * C;
  const base = Buffer.alloc(w * h * 4);
  const mask = Buffer.alloc(w * h * 4);

  const cellHasMask = (cx, cy) => {
    let m = 0;
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const o = ((cy * C + y) * src.width + (cx * C + x)) * 4;
      if (isMaskColor(src.data[o], src.data[o + 1], src.data[o + 2], src.data[o + 3])) m++;
    }
    return m > C * C * 0.02;
  };

  const frameRows = [];
  for (let R = 0; R < rows; R += 3) {
    if (cellHasMask(1, R) || cellHasMask(3, R)) frameRows.push(R);
  }

  let maxK = 0;
  for (const R of frameRows) for (let k = 0; k < cols / 2; k++) {
    if (cellHasMask(k * 2 + 1, R)) maxK = Math.max(maxK, k + 1);
  }
  const pairs = Math.max(maxK, 1);

  let gminX = C, gmaxX = -1;
  for (const R of frameRows) {
    for (let k = 0; k < pairs; k++) {
      const b = artBBox(src.data, src.width, C, k * 2, R);
      if (!b) continue;
      gminX = Math.min(gminX, b.minX);
      gmaxX = Math.max(gmaxX, b.maxX);
    }
  }
  const shiftX = gmaxX < 0 ? 0 : C / 2 - Math.round((gminX + gmaxX) / 2);

  const copyCell = (dst, srcCol, srcRow, dstCol, dx0, dx1) => {
    for (let y = 0; y < C; y++) for (let x = dx0; x < dx1; x++) {
      const dx = x + shiftX;
      if (dx < 0 || dx >= C) continue;
      const so = ((srcRow * C + y) * src.width + (srcCol * C + x)) * 4;
      const do_ = ((srcRow * C + y) * w + (dstCol * C + dx)) * 4;
      dst[do_] = src.data[so]; dst[do_ + 1] = src.data[so + 1]; dst[do_ + 2] = src.data[so + 2]; dst[do_ + 3] = src.data[so + 3];
    }
  };

  for (let R = 0; R < rows; R++) {
    const blockMaskRow = Math.floor(R / 3) * 3;
    for (let k = 0; k < cols / 2; k++) {
      const baseCol = k * 2;
      const maskCol = k * 2 + 1;
      copyCell(base, baseCol, R, baseCol, 0, C);
      const maskSrcRow = cellHasMask(maskCol, R) ? R : blockMaskRow;
      copyCell(mask, maskCol, maskSrcRow, baseCol, 0, C);
    }
  }
  return { base, mask, cols, rows, w, h, shiftX };
}

async function upsertAsset(fileName, png) {
  const checksum = crypto.createHash('sha256').update(png).digest('hex');
  let a = await prisma.spriteAsset.findFirst({ where: { checksum } });
  if (!a) a = await prisma.spriteAsset.create({ data: { file_name: fileName, mime_type: 'image/png', file_size: png.length, image_width: 0, image_height: 0, data: png, checksum } });
  return a.sprite_asset_id;
}

// Config de animação 16 colunas: direções em colunas pares, idle na linha 0,
// walk nas linhas 3,6,...,24 (grupos de 3 linhas: base + addons).
function buildConfig(cols, rows) {
  const COL = { north: 0, east: 2, south: 4, west: 6 };
  const DIRS = ['south', 'north', 'east', 'west'];
  const animations = [];
  for (const dir of DIRS) {
    const col = COL[dir];
    animations.push({ animation: 'idle', direction: dir, frames: [col], frameDurationMs: 400, loop: true });
    const walk = [];
    for (let r = 3; r < rows; r += 3) walk.push(r * cols + col);
    animations.push({ animation: 'walk', direction: dir, frames: walk, frameDurationMs: 140, loop: true });
  }
  return { spriteWidth: 64, spriteHeight: 64, sheetColumns: cols, sheetRows: rows, animations };
}

(async () => {
  const names = { 128: 'Outfit 128', 129: 'Outfit 129', 130: 'Outfit 130', 131: 'Outfit 131' };
  for (const id of [128, 129, 130, 131]) {
    const p = `doc/outfit_${id}_.png`;
    if (!fs.existsSync(p)) { console.log(id, 'MISSING'); continue; }
    const src = decodePng(fs.readFileSync(p));
    const { base, mask, cols, rows, w, h, shiftX } = extractAligned(src, 64);
    console.log(`outfit_${id}: shiftX=${shiftX}`);
    const basePng = encodePng(w, h, base);
    const maskPng = encodePng(w, h, mask);
    const baseAsset = await upsertAsset(`outfit_${id}_base16.png`, basePng);
    const maskAsset = await upsertAsset(`outfit_${id}_mask16.png`, maskPng);
    await prisma.spriteAsset.update({ where: { sprite_asset_id: baseAsset }, data: { image_width: w, image_height: h } });
    await prisma.spriteAsset.update({ where: { sprite_asset_id: maskAsset }, data: { image_width: w, image_height: h } });

    const config = buildConfig(cols, rows);
    let set = await prisma.animationSet.findFirst({ where: { name: `Outfit ${id} (4-dir)` } });
    if (!set) set = await prisma.animationSet.create({ data: { name: `Outfit ${id} (4-dir)`, config } });
    else set = await prisma.animationSet.update({ where: { animation_set_id: set.animation_set_id }, data: { config } });

    const existing = await prisma.outfit.findUnique({ where: { slug: `outfit_${id}` } });
    if (existing) {
      await prisma.outfit.update({
        where: { slug: `outfit_${id}` },
        data: { sprite_asset_id: baseAsset, color_mask_asset_id: maskAsset },
      });
      console.log(`outfit_${id}: ASSETS atualizados (base=${baseAsset} mask=${maskAsset}) set mantido=${existing.animation_set_id}`);
    } else {
      await prisma.outfit.create({
        data: {
          slug: `outfit_${id}`, name: names[id], description: `Outfit importado do fixture ${id}.`,
          sprite_asset_id: baseAsset, animation_set_id: set.animation_set_id, color_mask_asset_id: maskAsset,
          category: 'default', body_type: 'unisex', supports_colors: true, supports_addons: false,
          default_head_color: 6, default_primary_color: 11, default_secondary_color: 18, default_detail_color: 0,
          available_by_default: true, enabled: true, published: true,
        },
      });
      console.log(`outfit_${id}: criado (base=${baseAsset} mask=${maskAsset} set=${set.animation_set_id})`);
    }
  }
  await prisma.$disconnect();
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });

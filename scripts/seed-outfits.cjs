const fs = require('fs');
const zlib = require('zlib');
const crypto = require('crypto');
const { PrismaClient } = require('../packages/database/generated');

const prisma = new PrismaClient();
const DIRS = ['south', 'east', 'north', 'west'];

function standardConfig(columns) {
  const animations = [];
  DIRS.forEach((dir, col) => {
    const walk = [];
    for (let r = 0; r < 8; r++) walk.push(r * columns + col);
    animations.push({ animation: 'walk', direction: dir, frames: walk, frameDurationMs: 120, loop: true });
    animations.push({ animation: 'idle', direction: dir, frames: [8 * columns + col], frameDurationMs: 400, loop: true });
  });
  return animations;
}

// ---------------- PNG decode ----------------
function decodePng(buf) {
  let pos = 8, width, height, colorType;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let o = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[o++];
    const row = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) row[i] = raw[o++];
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (f === 1) v = (v + a) & 255;
      else if (f === 2) v = (v + b) & 255;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; }
      cur[x] = v;
    }
    for (let x = 0; x < width; x++) {
      const oo = (y * width + x) * 4;
      if (colorType === 6) { out[oo] = cur[x * 4]; out[oo + 1] = cur[x * 4 + 1]; out[oo + 2] = cur[x * 4 + 2]; out[oo + 3] = cur[x * 4 + 3]; }
      else { out[oo] = cur[x * 3]; out[oo + 1] = cur[x * 3 + 1]; out[oo + 2] = cur[x * 3 + 2]; out[oo + 3] = 255; }
    }
    prev = cur;
  }
  return { width, height, data: out };
}

// ---------------- PNG encode ----------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Gera a color mask: pixels opacos -> primary (vermelho). */
function generateMask(basePng) {
  const { width, height, data } = decodePng(basePng);
  const mask = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] > 16) {
      mask[i * 4] = 255; mask[i * 4 + 1] = 0; mask[i * 4 + 2] = 0; mask[i * 4 + 3] = 255;
    }
  }
  return encodePng(width, height, mask);
}

(async () => {
  const png = fs.readFileSync('apps/web/src/assets/creatures/dwarf_todos_movimentos.png');
  const checksum = crypto.createHash('sha256').update(png).digest('hex');

  let asset = await prisma.spriteAsset.findFirst({ where: { checksum } });
  if (!asset) {
    asset = await prisma.spriteAsset.create({
      data: { file_name: 'druid.png', mime_type: 'image/png', file_size: png.length, image_width: 128, image_height: 288, data: png, checksum },
    });
  }
  console.log('sprite_asset_id', asset.sprite_asset_id);

  const maskPng = generateMask(png);
  const maskChecksum = crypto.createHash('sha256').update(maskPng).digest('hex');
  let mask = await prisma.spriteAsset.findFirst({ where: { checksum: maskChecksum } });
  if (!mask) {
    mask = await prisma.spriteAsset.create({
      data: { file_name: 'druid_mask.png', mime_type: 'image/png', file_size: maskPng.length, image_width: 128, image_height: 288, data: maskPng, checksum: maskChecksum },
    });
  }
  console.log('mask_asset_id', mask.sprite_asset_id);

  const config = { spriteWidth: 32, spriteHeight: 32, sheetColumns: 4, sheetRows: 9, animations: standardConfig(4) };
  let set = await prisma.animationSet.findFirst({ where: { name: 'Humanoid 4-dir (8 frames)' } });
  if (!set) set = await prisma.animationSet.create({ data: { name: 'Humanoid 4-dir (8 frames)', config } });
  else set = await prisma.animationSet.update({ where: { animation_set_id: set.animation_set_id }, data: { config } });
  console.log('animation_set_id', set.animation_set_id);

  const outfit = await prisma.outfit.upsert({
    where: { slug: 'druid' },
    update: { sprite_asset_id: asset.sprite_asset_id, animation_set_id: set.animation_set_id, color_mask_asset_id: mask.sprite_asset_id, available_by_default: true },
    create: {
      slug: 'druid', name: 'Druida', description: 'Outfit padrão do jogador.',
      sprite_asset_id: asset.sprite_asset_id, animation_set_id: set.animation_set_id, color_mask_asset_id: mask.sprite_asset_id,
      category: 'default', body_type: 'unisex', supports_colors: true, supports_addons: false,
      default_head_color: 6, default_primary_color: 0, default_secondary_color: 18, default_detail_color: 0,
      available_by_default: true, enabled: true, published: true,
    },
  });
  console.log('outfit_id', outfit.outfit_id, 'mask', outfit.color_mask_asset_id);

  await prisma.$disconnect();
  console.log('OK');
})().catch((e) => { console.error(e); process.exit(1); });

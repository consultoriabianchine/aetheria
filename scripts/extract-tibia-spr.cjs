const fs = require('fs');
const path = require('path');
const { encodePng } = require('./lib/png.cjs');

const DEFAULT_SPR = path.resolve('doc/tibia_dat/Tibia.spr');
const DEFAULT_OUT = path.resolve('doc/tibia_extracted');
const SPRITE_SIZE = 32;
const SPRITE_BYTES = SPRITE_SIZE * SPRITE_SIZE * 4;

function usage() {
  console.log(`Usage:
  node scripts/extract-tibia-spr.cjs --id 123,124
  node scripts/extract-tibia-spr.cjs --from 100 --to 120
  node scripts/extract-tibia-spr.cjs --from 100 --to 120 --sheet

Options:
  --spr <file>       Tibia.spr path (default: doc/tibia_dat/Tibia.spr)
  --out <directory>  output directory (default: doc/tibia_extracted)
  --id <ids>         comma-separated sprite IDs
  --from <id>        first ID in an inclusive range
  --to <id>          last ID in an inclusive range
  --sheet             write one spritesheet instead of separate PNGs
  --vertical          with --sheet, stack sprites vertically
  --grid               with --sheet, arrange sprites in a compact grid
`);
}

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function parseIds() {
  const explicit = option('--id');
  if (explicit) return explicit.split(',').map(Number);

  const from = Number(option('--from', ''));
  const to = Number(option('--to', ''));
  if (Number.isInteger(from) && Number.isInteger(to) && from > 0 && to >= from) {
    return Array.from({ length: to - from + 1 }, (_, index) => from + index);
  }

  return [];
}

function readSprite(spr, id, spriteCount) {
  if (!Number.isInteger(id) || id <= 0 || id > spriteCount) return null;

  const tableOffset = 8 + (id - 1) * 4;
  const address = spr.readUInt32LE(tableOffset);
  if (address === 0) return null;

  const nextAddress = id < spriteCount ? spr.readUInt32LE(tableOffset + 4) : spr.length;
  if (address + 5 > spr.length || nextAddress <= address || nextAddress > spr.length) return null;

  const pixelDataSize = spr.readUInt16LE(address + 3);
  const dataStart = address + 5;
  const dataEnd = dataStart + pixelDataSize;
  if (dataEnd > nextAddress || dataEnd > spr.length) return null;

  const rgba = Buffer.alloc(SPRITE_BYTES);
  let read = dataStart;
  let write = 0;

  while (read < dataEnd && write < SPRITE_BYTES) {
    if (read + 4 > dataEnd) return null;
    const transparentPixels = spr.readUInt16LE(read);
    const coloredPixels = spr.readUInt16LE(read + 2);
    read += 4;

    const coloredBytes = coloredPixels * 3;
    if (read + coloredBytes > dataEnd || write + (transparentPixels + coloredPixels) * 4 > SPRITE_BYTES) return null;

    write += transparentPixels * 4;
    for (let pixel = 0; pixel < coloredPixels; pixel++) {
      rgba[write] = spr[read];
      rgba[write + 1] = spr[read + 1];
      rgba[write + 2] = spr[read + 2];
      rgba[write + 3] = 255;
      read += 3;
      write += 4;
    }
  }

  return rgba;
}

const sprPath = option('--spr', DEFAULT_SPR);
const outDir = path.resolve(option('--out', DEFAULT_OUT));
const gridMode = process.argv.includes('--grid');
const sheetMode = process.argv.includes('--sheet') || gridMode;
const verticalMode = process.argv.includes('--vertical');
const ids = [...new Set(parseIds())].sort((a, b) => a - b);

if (process.argv.includes('--help') || ids.length === 0) {
  usage();
  process.exit(ids.length === 0 ? 1 : 0);
}

if (!fs.existsSync(sprPath)) throw new Error(`SPR file not found: ${sprPath}`);
const spr = fs.readFileSync(sprPath);
const signature = spr.readUInt32LE(0);
const spriteCount = spr.readUInt32LE(4);
if (signature !== 0x59e48e02) throw new Error(`Unsupported SPR signature: 0x${signature.toString(16)}`);
if (8 + spriteCount * 4 > spr.length) throw new Error('Invalid SPR offset table');

fs.mkdirSync(outDir, { recursive: true });
let extracted = 0;
let empty = 0;
const sprites = [];
for (const id of ids) {
  const rgba = readSprite(spr, id, spriteCount);
  if (!rgba) {
    empty++;
    sprites.push(Buffer.alloc(SPRITE_BYTES));
    continue;
  }
  sprites.push(rgba);
  if (!sheetMode) fs.writeFileSync(path.join(outDir, `${id}.png`), encodePng(SPRITE_SIZE, SPRITE_SIZE, rgba));
  extracted++;
}

if (sheetMode) {
  const columns = gridMode ? Math.ceil(Math.sqrt(ids.length)) : ids.length;
  const rows = gridMode ? Math.ceil(ids.length / columns) : 1;
  const width = verticalMode ? SPRITE_SIZE : columns * SPRITE_SIZE;
  const height = verticalMode ? ids.length * SPRITE_SIZE : rows * SPRITE_SIZE;
  const sheet = Buffer.alloc(width * height * 4);
  for (let index = 0; index < sprites.length; index++) {
    for (let row = 0; row < SPRITE_SIZE; row++) {
      const source = row * SPRITE_SIZE * 4;
      const target = gridMode
        ? ((Math.floor(index / columns) * SPRITE_SIZE + row) * width + (index % columns) * SPRITE_SIZE) * 4
        : verticalMode
        ? (index * SPRITE_SIZE * SPRITE_SIZE * 4) + source
        : (row * ids.length * SPRITE_SIZE + index * SPRITE_SIZE) * 4;
      sprites[index].copy(sheet, target, source, source + SPRITE_SIZE * 4);
    }
  }
  const suffix = gridMode ? '-grid' : verticalMode ? '-vertical' : '';
  fs.writeFileSync(path.join(outDir, `sprites-${ids[0]}-${ids[ids.length - 1]}${suffix}.png`), encodePng(width, height, sheet));
}

console.log(`SPR signature: 0x${signature.toString(16).toUpperCase()}`);
console.log(`Sprite IDs: ${spriteCount}`);
console.log(`Extracted: ${extracted}; empty/invalid: ${empty}`);
console.log(`Output: ${outDir}${sheetMode ? ' (spritesheet)' : ''}`);

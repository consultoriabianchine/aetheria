const fs = require('fs');
const zlib = require('zlib');

function decodePng(buf) {
  let pos = 8, width, height, bitDepth, colorType;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[offset++];
    const row = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) row[i] = raw[offset++];
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let val = row[x];
      switch (filter) {
        case 0: break;
        case 1: val = (val + a) & 255; break;
        case 2: val = (val + b) & 255; break;
        case 3: val = (val + Math.floor((a + b) / 2)) & 255; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          val = (val + pr) & 255; break;
        }
      }
      cur[x] = val;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (colorType === 6) { out[o] = cur[x * 4]; out[o + 1] = cur[x * 4 + 1]; out[o + 2] = cur[x * 4 + 2]; out[o + 3] = cur[x * 4 + 3]; }
      else { out[o] = cur[x * 3]; out[o + 1] = cur[x * 3 + 1]; out[o + 2] = cur[x * 3 + 2]; out[o + 3] = 255; }
    }
    prev = cur;
  }
  return { width, height, data: out };
}

function classify(px) {
  const [r, g, b, a] = px;
  if (a < 128) return null;
  if (r > 200 && g > 200 && b < 60) return 'yellow';
  if (r > 200 && g < 60 && b < 60) return 'red';
  if (r < 60 && g > 200 && b < 60) return 'green';
  if (r < 60 && g < 60 && b > 200) return 'blue';
  return null;
}

const buf = fs.readFileSync('doc/outfit_exemplo.png');
const { width, height, data } = decodePng(buf);
const CELL = 32;
const cols = width / CELL, rows = height / CELL;
console.log(`PNG ${width}x${height} -> grid ${cols}x${rows} (${cols * rows} células)`);

// por célula, contagem de pixels de máscara
const rows_report = [];
for (let ry = 0; ry < rows; ry++) {
  const line = [];
  for (let cx = 0; cx < cols; cx++) {
    const counts = { yellow: 0, red: 0, green: 0, blue: 0 };
    let opaque = 0;
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const o = ((ry * CELL + y) * width + (cx * CELL + x)) * 4;
        const c = classify([data[o], data[o + 1], data[o + 2], data[o + 3]]);
        if (data[o + 3] > 128) opaque++;
        if (c) counts[c]++;
      }
    }
    const maskTotal = counts.yellow + counts.red + counts.green + counts.blue;
    const isMask = maskTotal > (CELL * CELL) * 0.2;
    line.push(isMask ? 'M' : '.');
  }
  rows_report.push(line.join(''));
}
console.log('Mapa (M=máscara, .=base/outro), 32 colunas:');
rows_report.forEach((l, i) => console.log(`linha ${String(i).padStart(2)}: ${l}`));

// resumo: qual metade é base vs máscara
let topMask = 0, botMask = 0;
for (let i = 0; i < rows; i++) {
  const line = rows_report[i];
  const maskCount = [...line].filter((ch) => ch === 'M').length;
  if (i < rows / 2) topMask += maskCount; else botMask += maskCount;
}
console.log(`\nMáscaras na metade superior: ${topMask}, inferior: ${botMask} (total linhas ${rows})`);

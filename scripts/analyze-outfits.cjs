const fs = require('fs');
const zlib = require('zlib');

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

function region(r, g, b, a) {
  if (a < 128) return null;
  if (r > 200 && g > 200 && b < 60) return 'Y'; // yellow=head
  if (r > 200 && g < 60 && b < 60) return 'R';   // red=primary
  if (r < 60 && g > 200 && b < 60) return 'G';   // green=secondary
  if (r < 60 && g < 60 && b > 200) return 'B';   // blue=detail
  return null;
}

function cellClass(data, width, C, cx, cy) {
  const counts = { Y: 0, R: 0, G: 0, B: 0 };
  let opaque = 0;
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const o = ((cy * C + y) * width + (cx * C + x)) * 4;
    const a = data[o + 3];
    if (a > 128) opaque++;
    const reg = region(data[o], data[o + 1], data[o + 2], a);
    if (reg) counts[reg]++;
  }
  const maskTotal = counts.Y + counts.R + counts.G + counts.B;
  if (maskTotal > C * C * 0.25) {
    // qual máscara domina
    let dom = '?', mx = 0;
    for (const k of ['Y', 'R', 'G', 'B']) if (counts[k] > mx) { mx = counts[k]; dom = k; }
    return dom;
  }
  return opaque > C * C * 0.02 ? 'b' : '.';
}

for (const id of [128, 129, 130, 131]) {
  const p = `doc/outfit_${id}_.png`;
  if (!fs.existsSync(p)) { console.log(id, 'MISSING'); continue; }
  const buf = fs.readFileSync(p);
  const { width, height, data } = decodePng(buf);
  const C = 32, cols = width / C, rows = height / C;
  console.log(`\n=== outfit_${id} === ${width}x${height} grid ${cols}x${rows}`);
  for (let ry = 0; ry < rows; ry++) {
    let line = '';
    for (let cx = 0; cx < cols; cx++) line += cellClass(data, width, C, cx, ry);
    console.log(String(ry).padStart(2) + ': ' + line);
  }
}

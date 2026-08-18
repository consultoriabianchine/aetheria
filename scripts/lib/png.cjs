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

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const tb = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tb, data]))); return Buffer.concat([len, tb, data, crc]); }
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function artBBox(data, width, C, cx, cy) {
  let minX = C, minY = C, maxX = -1, maxY = -1, n = 0;
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const o = ((cy * C + y) * width + (cx * C + x)) * 4;
    if (data[o + 3] > 40) { n++; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  return n === 0 ? null : { minX, minY, maxX, maxY };
}

/** Centraliza a arte em cada frame C×C (shift horizontal uniforme, mantém a base inferior). */
function centerSheet(src, C) {
  const cols = src.width / C;
  const rows = src.height / C;
  let gminX = C, gmaxX = -1;
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const b = artBBox(src.data, src.width, C, cx, cy);
    if (b) { gminX = Math.min(gminX, b.minX); gmaxX = Math.max(gmaxX, b.maxX); }
  }
  if (gmaxX < 0) return null;
  const shiftX = C / 2 - Math.round((gminX + gmaxX) / 2);
  const out = Buffer.alloc(src.data.length);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const so = ((cy * C + y) * src.width + (cx * C + x)) * 4;
      if (src.data[so + 3] === 0) continue;
      const dx = x + shiftX;
      if (dx < 0 || dx >= C) continue;
      const do_ = ((cy * C + y) * src.width + (cx * C + dx)) * 4;
      out[do_] = src.data[so]; out[do_ + 1] = src.data[so + 1]; out[do_ + 2] = src.data[so + 2]; out[do_ + 3] = src.data[so + 3];
    }
  }
  return { png: encodePng(src.width, src.height, out), shiftX };
}

module.exports = { decodePng, encodePng, artBBox, centerSheet };
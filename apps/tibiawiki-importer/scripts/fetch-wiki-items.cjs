const https = require('https');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.tibiawiki.com.br/api.php';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const OUT_DIR = path.resolve(__dirname, '../data/wiki-items-raw');
const ITEMS_OUT = path.resolve(__dirname, '../../web/src/assets/items');
const MAP_FILE = path.join(OUT_DIR, 'image-map.json');

const CATEGORIES = [
  'Capacetes', 'Armaduras', 'Escudos', 'Calças', 'Spellbooks', 'Botas', 'Aljavas', 'Extra Slot',
  'Machados', 'Clavas', 'Espadas', 'Rods', 'Wands', 'Antigas Wands e Rods', 'Distância', 'Munição',
  'Punhos', 'Réplicas', 'Réplicas de Clavas', 'Réplicas de Crossbows e Bows', 'Réplicas de Espadas',
  'Réplicas de Itens de Fansites', 'Réplicas de Machados', 'Réplicas de Rods', 'Réplicas de Wands',
  'Réplicas da Store',
  'Livros', 'Prêmios de Eventos', 'Runas de Decoração', 'Documentos e Papéis', 'Dolls e Bears',
  'Decorações', 'Instrumentos Musicais', 'Troféus', 'Itens de Fansites', 'Recipientes',
  'Comidas', 'Líquidos', 'Plantas e Ervas', 'Produtos de Criaturas',
  'Amuletos e Colares', 'Anéis', 'Chaves', 'Ferramentas', 'Ferramentas de Cozinha',
  'Fontes de Luz', 'Itens de Domar',
  'Itens de Addons', 'Itens de Imbuements', 'Itens Encantados', 'Jogos e Diversão',
  'Itens de Quest', 'Cristais', 'Itens de Festa', 'Valiosos', 'Lixos', 'Runas',
];

const BATCH = 50;

function api(params) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams(params).toString();
    const req = https.get(`${BASE}?${qs}`, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${qs.slice(0, 80)}...`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse failed: ${e.message}`)); }
      });
    });
    req.on('error', reject);
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        res.resume();
        download(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(dest, Buffer.concat(chunks));
        resolve();
      });
    });
    req.on('error', reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sanitizeFile(title) {
  return title.replace(/\s+/g, '_').replace(/[/\\?%*:|"<>]/g, '_');
}

async function fetchCategory(name) {
  const seenTitles = new Set();
  let cmcontinue = null;
  do {
    const p = { action: 'query', list: 'categorymembers', cmtitle: `Category:${name}`, cmtype: 'page', cmlimit: '500', format: 'json' };
    if (cmcontinue) p.cmcontinue = cmcontinue;
    const d = await api(p);
    for (const m of d.query?.categorymembers ?? []) seenTitles.add(m.title);
    cmcontinue = d.continue?.cmcontinue ?? null;
    if (cmcontinue) await sleep(250);
  } while (cmcontinue);

  const titles = [...seenTitles];
  const pages = new Map();
  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH);
    let d = await api({
      action: 'query', titles: batch.join('|'), prop: 'revisions',
      rvprop: 'content', rvslots: 'main', format: 'json', formatversion: '2',
    });
    let ps = d.query?.pages ?? [];
    const missing = ps.filter((p) => p.revisions === undefined && p.title);
    for (const m of missing) {
      const d2 = await api({
        action: 'query', titles: m.title, prop: 'revisions',
        rvprop: 'content', rvslots: 'main', format: 'json', formatversion: '2',
      });
      const p2 = d2.query?.pages ?? [];
      ps = ps.filter((x) => x.title !== m.title).concat(p2);
      await sleep(200);
    }
    for (const p of ps) pages.set(p.title, p);
    if (titles.length > BATCH) {
      console.log(`  ${name}: conteúdo ${pages.size}/${titles.length}`);
      await sleep(250);
    }
  }

  const fname = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(fname, JSON.stringify({ query: { pages: [...pages.values()] } }, null, 1));
  return { name, total: titles.length, withContent: pages.size };
}

function collectTitles() {
  const titles = new Set();
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (!f.endsWith('.json') || f === 'image-map.json') continue;
    const d = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
    for (const p of d.query?.pages ?? []) if (p.title && p.revisions) titles.add(p.title);
  }
  return [...titles];
}

async function resolveImageInfo(fileTitles) {
  const out = new Map();
  for (let i = 0; i < fileTitles.length; i += BATCH) {
    const batch = fileTitles.slice(i, i + BATCH);
    const d = await api({
      action: 'query', titles: batch.join('|'), prop: 'imageinfo',
      iiprop: 'url', format: 'json', formatversion: '2',
    });
    for (const p of d.query?.pages ?? []) {
      const clean = p.title.replace(/^(File|Arquivo):/i, '').replace(/\.(gif|png|jpe?g)$/i, '');
      if (p.imageinfo?.[0]?.url) out.set(clean, p.imageinfo[0].url);
    }
    await sleep(200);
  }
  return out;
}

async function fetchImages() {
  const titles = collectTitles();
  console.log(`IMAGES: resolvendo imagens de ${titles.length} itens...`);

  const gif = await resolveImageInfo(titles.map((t) => `File:${t}.gif`));
  const missing = titles.filter((t) => !gif.has(t));
  const png = await resolveImageInfo(missing.map((t) => `File:${t}.png`));

  const map = {};
  for (const t of titles) {
    const url = gif.get(t) ?? png.get(t);
    if (url) {
      const ext = gif.has(t) ? '.gif' : '.png';
      map[t] = `${sanitizeFile(t)}${ext}`;
    } else {
      map[t] = null;
    }
  }

  fs.mkdirSync(ITEMS_OUT, { recursive: true });
  const entries = Object.entries(map).filter(([, n]) => n !== null);
  let ok = 0;
  let fail = 0;
  const queue = [...entries];
  async function worker() {
    while (queue.length) {
      const [title, name] = queue.shift();
      const dest = path.join(ITEMS_OUT, name);
      if (fs.existsSync(dest)) { ok += 1; continue; }
      const url = gif.get(title) ?? png.get(title);
      try {
        await download(url, dest);
        ok += 1;
      } catch (e) {
        fail += 1;
        console.error(`DL FAIL ${title}: ${e.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1));
  console.log(`IMAGES: ${ok} ok, ${fail} falhas, ${Object.values(map).filter((v) => v === null).length} sem imagem -> ${ITEMS_OUT}`);
  return { ok, fail, semImagem: Object.values(map).filter((v) => v === null).length };
}

(async () => {
  const imagesOnly = process.argv.includes('--images-only');

  if (!imagesOnly) {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const f of fs.readdirSync(OUT_DIR)) if (f !== 'image-map.json') fs.unlinkSync(path.join(OUT_DIR, f));

    const results = [];
    for (const cat of CATEGORIES) {
      try {
        const r = await fetchCategory(cat);
        results.push(r);
        console.log(`${r.name}: ${r.withContent}/${r.total} com conteúdo`);
      } catch (e) {
        results.push({ name: cat, error: e.message });
        console.error(`FAIL ${cat}: ${e.message}`);
      }
      await sleep(300);
    }

    console.log('\n=== CONTENT SUMMARY ===');
    let total = 0;
    let withContent = 0;
    for (const r of results) {
      if (r.error) console.log(`ERR  ${r.name}: ${r.error}`);
      else {
        console.log(`${r.name}: ${r.withContent}/${r.total}`);
        total += r.total;
        withContent += r.withContent;
      }
    }
    console.log(`TOTAL: ${withContent} itens com conteúdo de ${total} títulos`);
  }

  await fetchImages();
})().catch((e) => { console.error(e); process.exit(1); });
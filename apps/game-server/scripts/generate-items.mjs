import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SRC_ITENS = 'C:/Users/Suter/Documents/teste/tibia-rods/src/assets/itens.json';
const OUT = path.join(__dirname, '..', 'data', 'items.json');

const raw = JSON.parse(readFileSync(SRC_ITENS, 'utf8'));

const CATEGORY_TYPE = {
  Capacetes: ['helmet', 'head'],
  Armaduras: ['armor', 'armor'],
  Escudos: ['shield', 'shield'],
  Calças: ['legs', 'legs'],
  Botas: ['boots', 'boots'],
  Amuletos_e_Colares: ['amulet', 'amulet'],
  Anéis: ['ring', 'ring'],
  Machados: ['weapon', 'weapon'],
  Clavas: ['weapon', 'weapon'],
  Espadas: ['weapon', 'weapon'],
  Rods: ['weapon', 'weapon'],
  Wands: ['weapon', 'weapon'],
  Antigas_Wands_e_Rods: ['weapon', 'weapon'],
  Distância: ['weapon', 'weapon'],
  Punhos: ['weapon', 'weapon'],
  Munição: ['consumable', undefined],
  Comidas: ['consumable', undefined],
  Líquidos: ['consumable', undefined],
  'Cristais_(Itens)': ['consumable', undefined],
  Runas: ['consumable', undefined],
  Spellbooks: ['other', undefined],
};

function slugId(slug) {
  return slug.replace(/_/g, '-').toLowerCase();
}

function num(value) {
  const n = parseFloat(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

const items = [];
for (const it of raw.items) {
  const category = it.categories?.[0] ?? 'Outros';
  const [type, slot] = CATEGORY_TYPE[category] ?? ['loot', undefined];
  items.push({
    id: slugId(it.slug),
    name: it.name,
    type,
    weight: num(it.weight),
    stackable: false,
    attack: Math.max(0, num(it.data?.Arm) + num(it.data?.Ataque)),
    defense: Math.max(0, num(it.data?.Def) + num(it.data?.Defesa)),
    image: it.image ? it.image.replace('assets/items/', '') : null,
    category,
    slot,
  });
}

items.push(
  {
    id: 'gold',
    name: 'Moedas de Ouro',
    type: 'loot',
    weight: 0.1,
    stackable: true,
    attack: 0,
    defense: 0,
    image: null,
    category: 'Moeda',
  },
  {
    id: 'i-tear-of-forest',
    name: 'Lágrima da Floresta',
    type: 'loot',
    weight: 0.5,
    stackable: true,
    attack: 0,
    defense: 0,
    image: null,
    category: 'Troféu',
  },
  {
    id: 'i-wolf-pelt',
    name: 'Pele de Lobo',
    type: 'loot',
    weight: 1.2,
    stackable: true,
    attack: 0,
    defense: 0,
    image: null,
    category: 'Troféu',
  },
);

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({ source: 'tibia-wiki-itens', generatedAt: new Date().toISOString(), total: items.length, items }, null, 1));
console.log(`Catálogo gerado: ${items.length} itens -> ${OUT}`);
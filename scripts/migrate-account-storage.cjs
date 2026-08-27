// Migração do storage unificado por conta.
//
// Antes desta atualização, `gold`, backpack e loot pouch eram por personagem
// (Character.gold + CharacterInventory.slots). Agora são da conta
// (AccountStorage). Este script consolida os dados legados em `account_storage`.
//
// Idempotente: não sobrescreve um AccountStorage já existente.
//
// Uso: node scripts/migrate-account-storage.cjs

const { PrismaClient } = require('../packages/database/generated');

const INVENTORY_SIZE = 24;
const LOOT_POUCH_SIZE = 10;
const LOOT_POUCH_MAX = 60;

const prisma = new PrismaClient();

function parseInventory(slots) {
  const raw = slots ?? {};
  const backpack = Array.isArray(raw.backpack) ? raw.backpack : [];
  const lootPouch = Array.isArray(raw.lootPouch) ? raw.lootPouch : [];
  const size = Number(raw.lootPouchSize);
  return {
    backpack,
    lootPouch,
    lootPouchSize: Number.isFinite(size) ? Math.round(size) : LOOT_POUCH_SIZE,
  };
}

function stackOf(value) {
  if (!value || typeof value !== 'object' || typeof value.itemId !== 'string') return null;
  const quantity = Number(value.quantity);
  return { itemId: value.itemId, quantity: Number.isFinite(quantity) ? Math.round(quantity) : 1 };
}

async function main() {
  const characters = await prisma.character.findMany({
    select: {
      id: true,
      accountId: true,
      gold: true,
      inventory: { select: { slots: true } },
    },
  });

  const byAccount = new Map();
  for (const c of characters) {
    const acc = byAccount.get(c.accountId) ?? { gold: 0, backpack: [], lootPouch: [], lootPouchSize: LOOT_POUCH_SIZE };
    acc.gold += c.gold ?? 0;
    const inv = parseInventory(c.inventory?.slots);
    for (const slot of inv.backpack) {
      const stack = stackOf(slot);
      if (stack) acc.backpack.push(stack);
    }
    for (const slot of inv.lootPouch) {
      const stack = stackOf(slot);
      if (stack) acc.lootPouch.push(stack);
    }
    acc.lootPouchSize = Math.max(acc.lootPouchSize, inv.lootPouchSize);
    byAccount.set(c.accountId, acc);
  }

  let created = 0;
  let skipped = 0;

  for (const [accountId, acc] of byAccount) {
    const existing = await prisma.accountStorage.findUnique({ where: { accountId } });
    if (existing) {
      skipped++;
      continue;
    }
    const backpack = new Array(INVENTORY_SIZE).fill(null);
    for (let i = 0; i < Math.min(acc.backpack.length, INVENTORY_SIZE); i++) backpack[i] = acc.backpack[i];
    const size = Math.max(LOOT_POUCH_SIZE, acc.lootPouchSize, acc.lootPouch.length);
    const capped = Math.min(LOOT_POUCH_MAX, size);
    const lootPouch = new Array(capped).fill(null);
    for (let i = 0; i < Math.min(acc.lootPouch.length, capped); i++) lootPouch[i] = acc.lootPouch[i];

    await prisma.accountStorage.create({
      data: { accountId, gold: acc.gold, backpack, lootPouchSize: capped, lootPouch },
    });
    created++;
  }

  console.log(`Migração concluída: ${created} contas criadas, ${skipped} já existentes.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

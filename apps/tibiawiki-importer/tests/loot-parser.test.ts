import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { buildLootEntry, interpretLootCell, looksLikeQuantity, normalizeQuantity, normalizeRarity } from '../src/normalization/loot.normalizer';
import { LootParser } from '../src/parser/loot.parser';

const BASE = 'https://www.tibiawiki.com.br';

describe('normalizeRarity', () => {
  it('normaliza raridades em pt/en', () => {
    expect(normalizeRarity('Comum')).toEqual({ rarity: 'COMMON', rarityRaw: 'Comum' });
    expect(normalizeRarity('Raro')).toEqual({ rarity: 'RARE', rarityRaw: 'Raro' });
    expect(normalizeRarity('Uncommon')).toEqual({ rarity: 'UNCOMMON', rarityRaw: 'Uncommon' });
    expect(normalizeRarity('Semi-Raro')).toEqual({ rarity: 'SEMI_RARE', rarityRaw: 'Semi-Raro' });
  });

  it('retorna UNKNOWN para desconhecido/vazio', () => {
    expect(normalizeRarity('--').rarity).toBe('UNKNOWN');
    expect(normalizeRarity(null).rarity).toBe('UNKNOWN');
  });
});

describe('normalizeQuantity', () => {
  it('extrai min/max', () => {
    expect(normalizeQuantity('0-21')).toEqual({ min: 0, max: 21, quantityRaw: '0-21' });
    expect(normalizeQuantity('1')).toEqual({ min: 1, max: 1, quantityRaw: '1' });
  });
});

describe('looksLikeQuantity', () => {
  it('detecta padrões de quantidade', () => {
    expect(looksLikeQuantity('0-21')).toBe(true);
    expect(looksLikeQuantity('1')).toBe(true);
    expect(looksLikeQuantity('Comum')).toBe(false);
    expect(looksLikeQuantity('--')).toBe(false);
  });
});

describe('interpretLootCell', () => {
  it('combina raridade + quantidade na mesma célula', () => {
    const r = interpretLootCell('Comum (0-21)');
    expect(r.rarity).toBe('COMMON');
    expect(r.min).toBe(0);
    expect(r.max).toBe(21);
  });
});

describe('LootParser', () => {
  it('extrai itens de tabela de loot', () => {
    const html = `
      <div id="loot">
        <table>
          <tr><th>Item</th><th>Raridade</th><th>Quantidade</th><th>Chance</th></tr>
          <tr><td><a href="/wiki/Meat" title="Meat">Meat</a></td><td>Comum</td><td>0-21</td><td>--</td></tr>
          <tr><td><a href="/wiki/Ham" title="Ham">Ham</a></td><td>Raro</td><td>1</td><td>50%</td></tr>
        </table>
      </div>`;
    const $ = cheerio.load(html);
    const entries = new LootParser(BASE).parse($, $('#loot'));
    expect(entries).toHaveLength(2);

    const meat = entries[0];
    expect(meat.itemName).toBe('Meat');
    expect(meat.itemUrl).toBe('https://www.tibiawiki.com.br/wiki/Meat');
    expect(meat.rarity).toBe('COMMON');
    expect(meat.minQuantity).toBe(0);
    expect(meat.maxQuantity).toBe(21);

    const ham = entries[1];
    expect(ham.rarity).toBe('RARE');
    expect(ham.chance).toBe(50);
    expect(ham.minQuantity).toBe(1);
  });

  it('suporta formato de lista (ul/li)', () => {
    const html = '<div id="loot"><ul><li><a href="/wiki/Meat">Meat</a> (Comum)</li></ul></div>';
    const $ = cheerio.load(html);
    const entries = new LootParser(BASE).parse($, $('#loot'));
    expect(entries).toHaveLength(1);
    expect(entries[0].itemName).toBe('Meat');
    expect(entries[0].rarity).toBe('COMMON');
  });

  it('remove duplicados por nome', () => {
    const html = `
      <div id="loot">
        <ul>
          <li><a href="/wiki/Meat">Meat</a></li>
          <li><a href="/wiki/Meat">Meat</a></li>
        </ul>
      </div>`;
    const $ = cheerio.load(html);
    expect(new LootParser(BASE).parse($, $('#loot'))).toHaveLength(1);
  });

  it('ignora cabeçalhos de raridade ("Comum:", "Incomum:") como itens', () => {
    const html = `
      <div id="loot">
        <table>
          <tr><td>Comum:</td></tr>
          <tr><td>0-12 <span class="tooltip"><a href="/wiki/Gold_Coin" title="Gold Coin">Gold Coins</a></span></td></tr>
          <tr><td><a href="/wiki/Hatchet" title="Hatchet">Hatchet</a></td></tr>
          <tr><td>Incomum:</td></tr>
          <tr><td><a href="/wiki/Axe" title="Axe">Axe</a></td></tr>
        </table>
      </div>`;
    const $ = cheerio.load(html);
    const entries = new LootParser(BASE).parse($, $('#loot'));
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.itemName)).toEqual(['Gold Coins', 'Hatchet', 'Axe']);
    expect(entries[0].rarity).toBe('COMMON');
    expect(entries[0].minQuantity).toBe(0);
    expect(entries[0].maxQuantity).toBe(12);
    expect(entries[1].rarity).toBe('COMMON');
    expect(entries[2].rarity).toBe('UNCOMMON');
    expect(entries.some((e) => e.rarity === 'UNKNOWN')).toBe(false);
  });

  it('ignora legendas/sub-seções sem link ("Durante Eventos:")', () => {
    const html = `
      <div id="loot">
        <table>
          <tr><td>Comum:</td></tr>
          <tr><td><a href="/wiki/Meat" title="Meat">Meat</a></td></tr>
          <tr><td>Durante Eventos:</td></tr>
          <tr><td><a href="/wiki/Frost_Chili" title="Frost Chili">Frost Chili</a></td></tr>
        </table>
      </div>`;
    const $ = cheerio.load(html);
    const entries = new LootParser(BASE).parse($, $('#loot'));
    expect(entries.map((e) => e.itemName)).toEqual(['Meat', 'Frost Chili']);
    expect(entries.filter((e) => e.itemName.includes('Durante'))).toHaveLength(0);
  });
});

describe('buildLootEntry', () => {
  it('usa fallback para nome vazio', () => {
    const entry = buildLootEntry({
      itemName: '   ',
      itemUrl: null,
      rarity: 'UNKNOWN',
      rarityRaw: null,
      min: null,
      max: null,
      quantityRaw: null,
      chance: null,
      rawText: '',
    });
    expect(entry.itemName).toBe('Desconhecido');
  });
});
import * as cheerio from 'cheerio';
import { describe, expect, it } from 'vitest';
import { parseChance, parseNumber, parseQuantity, StatsParser } from '../src/parser/stats.parser';

describe('parseNumber', () => {
  it('remove separadores de milhar', () => {
    expect(parseNumber('9.200')).toBe(9200);
    expect(parseNumber('9200')).toBe(9200);
  });

  it('ignora texto não numérico', () => {
    expect(parseNumber('--')).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber('abc')).toBeNull();
  });
});

describe('parseQuantity', () => {
  it('parseia faixas "0-21"', () => {
    expect(parseQuantity('0-21')).toEqual({ min: 0, max: 21 });
  });

  it('parseia valor único', () => {
    expect(parseQuantity('1')).toEqual({ min: 1, max: 1 });
  });

  it('aceita separadores variados', () => {
    expect(parseQuantity('1 a 3')).toEqual({ min: 1, max: 3 });
    expect(parseQuantity('2–4')).toEqual({ min: 2, max: 4 });
  });

  it('retorna null sem número', () => {
    expect(parseQuantity('--')).toEqual({ min: null, max: null });
    expect(parseQuantity(null)).toEqual({ min: null, max: null });
  });
});

describe('parseChance', () => {
  it('parseia porcentagem', () => {
    expect(parseChance('50%')).toBe(50);
    expect(parseChance('12.5%')).toBe(12.5);
  });

  it('rejeita valores sem % ou fora do intervalo', () => {
    expect(parseChance('--')).toBeNull();
    expect(parseChance('150%')).toBeNull();
  });
});

describe('StatsParser', () => {
  it('extrai HP, XP, charms e dificuldade do infobox', () => {
    const html = `
      <table class="infobox">
        <tr><th>HP</th><td>9.200</td></tr>
        <tr><th>Experience</th><td>9.200</td></tr>
        <tr><th>Charm Points</th><td>2</td></tr>
        <tr><th>Difficulty</th><td>Médio</td></tr>
      </table>`;
    const $ = cheerio.load(html);
    const infobox = $('table').first();
    const stats = new StatsParser().parse($, infobox);
    expect(stats.hp).toBe(9200);
    expect(stats.experience).toBe(9200);
    expect(stats.charms).toBe(2);
    expect(stats.difficulty).toBe('MEDIUM');
    expect(stats.difficultyRaw).toBe('Médio');
  });

  it('retorna null para campos ausentes', () => {
    const $ = cheerio.load('<table><tr><th>Nome</th><td>X</td></tr></table>');
    const stats = new StatsParser().parse($, $('table').first());
    expect(stats.hp).toBeNull();
    expect(stats.experience).toBeNull();
    expect(stats.difficulty).toBe('UNKNOWN');
  });
});
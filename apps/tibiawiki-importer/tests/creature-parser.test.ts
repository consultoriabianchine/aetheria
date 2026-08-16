import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CreatureParser } from '../src/parser/creature.parser';

const fixture = (name: string): string => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');

describe('CreatureParser', () => {
  it('extrai nome, stats, imagem, loot e descrição', () => {
    const raw = new CreatureParser().parse(fixture('creature-page.html'), 'https://www.tibiawiki.com.br/wiki/Boar_Man', 'Humanóides');

    expect(raw.name).toBe('Boar Man');
    expect(raw.sourceUrl).toBe('https://www.tibiawiki.com.br/wiki/Boar_Man');
    expect(raw.category).toBe('Humanóides');

    expect(raw.hp).toBe(9200);
    expect(raw.experience).toBe(9200);
    expect(raw.charms).toBe(2);
    expect(raw.difficulty).toBe('MEDIUM');
    expect(raw.difficultyRaw).toBe('Médio');

    // Thumbnail convertido para o arquivo original (GIF).
    expect(raw.imageUrl).toBe('https://www.tibiawiki.com.br/images/8/82/Boar_Man.gif');
    expect(raw.gifUrl).toBe('https://www.tibiawiki.com.br/images/8/82/Boar_Man.gif');

    expect(raw.description).toContain('O Boar Man é uma criatura');

    expect(raw.loot).toHaveLength(2);
    expect(raw.loot[0].itemName).toBe('Meat');
    expect(raw.loot[1].itemName).toBe('Ham');
  });

  it('tolera páginas sem infobox/loot', () => {
    const raw = new CreatureParser().parse('<div id="firstHeading">Teste</div>', 'https://www.tibiawiki.com.br/wiki/Teste', null);
    expect(raw.name).toBe('Teste');
    expect(raw.hp).toBeNull();
    expect(raw.loot).toEqual([]);
  });
});
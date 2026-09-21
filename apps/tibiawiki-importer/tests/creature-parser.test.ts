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

  it('extrai armadura e afinidades elementais do formato atual da Wiki', () => {
    const html = `
      <div id="firstHeading">Orc Berserker</div>
      <div id="mw-content-text">
        <table class="infobox">
          <tr><td>210 HP Pontos de Vida</td></tr>
          <tr><td>195 XP Pontos de Experiência</td></tr>
          <tr><td>12 de Armadura</td></tr>
          <tr><td>110%Fraco a Terra</td></tr>
          <tr><td>85%Forte a Energia</td></tr>
        </table>
      </div>`;
    const raw = new CreatureParser().parse(html, 'https://www.tibiawiki.com.br/wiki/Orc_Berserker', null);

    expect(raw.armor).toBe(12);
    expect(raw.damageAffinities.earth).toEqual({ modifier: 0.1, immune: false });
    expect(raw.damageAffinities.energy).toEqual({ modifier: -0.15, immune: false });
  });
});

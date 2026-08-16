import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CategoryParser } from '../src/parser/category.parser';

const fixture = (name: string): string => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
const BASE = 'https://www.tibiawiki.com.br';

describe('CategoryParser', () => {
  it('descobre links de criaturas e exclui prefixos especiais', () => {
    const links = new CategoryParser().parse(fixture('category-page.html'), BASE);
    expect(links).toHaveLength(3);
    expect(links.map((l) => l.name)).toEqual(['Boar Man', 'Ancient Scarab', 'Barkless Devotee']);
    expect(links[0].url).toBe('https://www.tibiawiki.com.br/wiki/Boar_Man');
    expect(links.some((l) => l.name.includes('Categoria'))).toBe(false);
    expect(links.some((l) => l.name.includes('Especial'))).toBe(false);
  });

  it('remove duplicados por URL', () => {
    const html = `
      <div id="mw-pages">
        <a href="/wiki/Boar_Man" title="Boar Man">Boar Man</a>
        <a href="/wiki/Boar_Man" title="Boar Man">Boar Man</a>
      </div>`;
    expect(new CategoryParser().parse(html, BASE)).toHaveLength(1);
  });

  it('exclui âncoras de navegação "Ir para pesquisar"', () => {
    const html = `
      <div id="mw-pages">
        <a href="#pesquisar" title="Ir para pesquisar">Ir para pesquisar</a>
        <a href="/wiki/Boar_Man" title="Boar Man">Boar Man</a>
      </div>`;
    const links = new CategoryParser().parse(html, BASE);
    expect(links).toHaveLength(1);
    expect(links[0].name).toBe('Boar Man');
  });

  it('encontra link da próxima página via pagefrom', () => {
    const html = `
      <div id="mw-pages">
        <a href="/index.php?title=Categoria:Human%C3%B3ides&pagefrom=Boar+Man" title="Próxima página">próxima página</a>
      </div>`;
    const next = new CategoryParser().findNextPageUrl(html, BASE);
    expect(next).toContain('pagefrom=');
  });
});
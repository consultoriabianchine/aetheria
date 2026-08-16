import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CreatureParser } from '../src/parser/creature.parser';
import { CreatureNormalizer } from '../src/normalization/creature.normalizer';

const fixture = (name: string): string => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');

const normalizer = new CreatureNormalizer();

describe('CreatureNormalizer', () => {
  it('gera slug, valida dados e calcula source_hash estável', () => {
    const raw = new CreatureParser().parse(
      fixture('creature-page.html'),
      'https://www.tibiawiki.com.br/wiki/Boar_Man',
      'Humanóides',
    );
    const a = normalizer.normalize(raw);
    const b = normalizer.normalize(raw);

    expect(a.slug).toBe('boar-man');
    expect(a.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(a.loot[0].itemUrl).toBe('https://www.tibiawiki.com.br/wiki/Meat');
  });

  it('rejeita nomes vazios via Zod', () => {
    const raw = {
      name: '',
      sourceUrl: 'https://www.tibiawiki.com.br/wiki/X',
      imageUrl: null,
      gifUrl: null,
      hp: null,
      experience: null,
      charms: null,
      difficulty: null,
      difficultyRaw: null,
      category: null,
      description: null,
      loot: [],
    };
    expect(() => normalizer.normalize(raw)).toThrow();
  });

  it('limpa URLs inválidas', () => {
    const raw = {
      name: 'X',
      sourceUrl: 'https://www.tibiawiki.com.br/wiki/X',
      imageUrl: 'javascript:alert(1)',
      gifUrl: null,
      hp: null,
      experience: null,
      charms: null,
      difficulty: null,
      difficultyRaw: null,
      category: null,
      description: null,
      loot: [],
    };
    const out = normalizer.normalize(raw);
    expect(out.imageUrl).toBeNull();
  });
});
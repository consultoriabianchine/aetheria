import { describe, expect, it } from 'vitest';
import { slugify } from '../src/utils/slugify';

describe('slugify', () => {
  it('gera slug com hífens e minúsculas', () => {
    expect(slugify('Boar Man')).toBe('boar-man');
    expect(slugify('Ancient Scarab')).toBe('ancient-scarab');
  });

  it('remove acentos e apóstrofos', () => {
    expect(slugify('Orc Warlord')).toBe('orc-warlord');
    expect(slugify("Barkless Devotee")).toBe('barkless-devotee');
  });

  it('remove caracteres especiais e colapsa hífens', () => {
    expect(slugify('   Humanóide   Extra!!! ')).toBe('humanoide-extra');
    expect(slugify('a--b')).toBe('a-b');
  });

  it('normaliza espaço/underscore', () => {
    expect(slugify('Boar_Man')).toBe('boar-man');
  });
});
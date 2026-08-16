import { describe, expect, it } from 'vitest';
import { imageExtension, normalizeWikiUrl, originalImageUrl, resolveAssetUrl } from '../src/parser/wiki-url';

const BASE = 'https://www.tibiawiki.com.br';

describe('normalizeWikiUrl', () => {
  it('resolver links relativos e limpar query/hash', () => {
    expect(normalizeWikiUrl('/wiki/Boar_Man', BASE)).toBe('https://www.tibiawiki.com.br/wiki/Boar_Man');
    expect(normalizeWikiUrl('/wiki/Boar_Man?oldid=1#Loot', BASE)).toBe(
      'https://www.tibiawiki.com.br/wiki/Boar_Man',
    );
  });

  it('rejeita protocolos inválidos', () => {
    expect(normalizeWikiUrl('javascript:alert(1)', BASE)).toBeNull();
    expect(normalizeWikiUrl('ftp://x/y', BASE)).toBeNull();
    expect(normalizeWikiUrl('', BASE)).toBeNull();
  });
});

describe('resolveAssetUrl', () => {
  it('converte protocol-relative para https', () => {
    expect(resolveAssetUrl('//static.tibia.com/foo.png', BASE)).toBe('https://static.tibia.com/foo.png');
  });

  it('resolve caminhos relativos', () => {
    expect(resolveAssetUrl('/images/x.png', BASE)).toBe('https://www.tibiawiki.com.br/images/x.png');
  });
});

describe('originalImageUrl', () => {
  it('converte thumbnail para arquivo original', () => {
    const thumb = 'https://www.tibiawiki.com.br/images/thumb/8/82/Boar_Man.gif/250px-Boar_Man.gif';
    expect(originalImageUrl(thumb)).toBe('https://www.tibiawiki.com.br/images/8/82/Boar_Man.gif');
  });

  it('mantém URLs sem /thumb/', () => {
    expect(originalImageUrl('https://x.com/a.png')).toBe('https://x.com/a.png');
  });
});

describe('imageExtension', () => {
  it('detecta extensões conhecidas', () => {
    expect(imageExtension('https://x.com/a.gif')).toBe('gif');
    expect(imageExtension('https://x.com/a.png')).toBe('png');
    expect(imageExtension('https://x.com/a.jpeg')).toBe('jpg');
  });

  it('retorna null para arquivos sem extensão de imagem', () => {
    expect(imageExtension(null)).toBeNull();
    expect(imageExtension('https://x.com/a.txt')).toBeNull();
  });
});
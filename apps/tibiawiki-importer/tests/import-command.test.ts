import { describe, expect, it } from 'vitest';
import { parseCliOptions } from '../src/cli/import.command';

describe('parseCliOptions', () => {
  it('aplica valores padrão', () => {
    const opts = parseCliOptions([]);
    expect(opts.dryRun).toBe(false);
    expect(opts.force).toBe(false);
    expect(opts.downloadAssets).toBe(true);
    expect(opts.verbose).toBe(false);
    expect(opts.help).toBe(false);
    expect(opts.limit).toBeUndefined();
  });

  it('interpreta flags booleanas e numéricas', () => {
    const opts = parseCliOptions(['--dry-run', '--limit=3', '--verbose']);
    expect(opts.dryRun).toBe(true);
    expect(opts.limit).toBe(3);
    expect(opts.verbose).toBe(true);
  });

  it('--skip-assets desativa o download', () => {
    const opts = parseCliOptions(['--skip-assets']);
    expect(opts.downloadAssets).toBe(false);
  });

  it('captura --category-url e --slug', () => {
    const opts = parseCliOptions(['--category-url=https://x/wiki/A', '--slug=boar-man']);
    expect(opts.categoryUrl).toBe('https://x/wiki/A');
    expect(opts.slug).toBe('boar-man');
  });

  it('ignora limit inválido', () => {
    expect(parseCliOptions(['--limit=abc']).limit).toBeUndefined();
  });
});
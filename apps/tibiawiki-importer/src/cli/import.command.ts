import { parseArgs } from 'node:util';
import { PrismaClient } from '@aetheria/database';
import { ImportRepository } from '../database/import.repository';
import { ImportOrchestrator } from '../services/import-orchestrator.service';
import type { CliOptions } from '../types/scraper.types';
import { Logger } from '../utils/logger';

const OPTIONS = {
  'category-url': { type: 'string' as const },
  limit: { type: 'string' as const },
  'dry-run': { type: 'boolean' as const, default: false },
  force: { type: 'boolean' as const, default: false },
  'download-assets': { type: 'boolean' as const, default: true },
  'skip-assets': { type: 'boolean' as const, default: false },
  update: { type: 'boolean' as const, default: false },
  verbose: { type: 'boolean' as const, default: false },
  inspect: { type: 'boolean' as const, default: false },
  slug: { type: 'string' as const },
  help: { type: 'boolean' as const, default: false },
};

/** Interpreta os argumentos da linha de comando. */
export function parseCliOptions(argv: string[]): CliOptions {
  const { values } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  const rawLimit = values['limit'];
  const limit = rawLimit ? parseInt(rawLimit, 10) : undefined;
  return {
    categoryUrl: values['category-url'],
    limit: Number.isFinite(limit) && limit !== undefined ? limit : undefined,
    dryRun: values['dry-run'] ?? false,
    force: values['force'] ?? false,
    downloadAssets: (values['download-assets'] ?? true) && !(values['skip-assets'] ?? false),
    update: values['update'] ?? false,
    verbose: values['verbose'] ?? false,
    inspect: values['inspect'] ?? false,
    slug: values['slug'],
    help: values['help'] ?? false,
  };
}

export function printHelp(): void {
  console.log(`
TibiaWiki Importer — importa criaturas/loot da TibiaWiki para o PostgreSQL.

Uso:
  npm run importer [-- <flags>]

Flags:
  --category-url=<URL>   Categoria a importar (padrão: TIBIAWIKI_CATEGORY_URL)
  --limit=<N>            Processa apenas as N primeiras criaturas
  --dry-run              Não salva no banco nem baixa assets (apenas mostra)
  --force                Reprocessa mesmo sem alteração de conteúdo
  --update               Atualiza registros existentes
  --download-assets      Baixa imagens/GIFs (padrão)
  --skip-assets          Não baixa assets
  --verbose              Logs detalhados
  --inspect --slug=<x>   Inspeciona uma criatura já importada
  --help                 Esta ajuda

Exemplos:
  npm run importer -- --dry-run --limit=3
  npm run importer -- --limit=3
  npm run importer
  npm run importer -- --category-url="https://www.tibiawiki.com.br/wiki/Human%C3%B3ides"
`);
}

/** Executa o comando (importação ou inspeção) e retorna o exit code. */
export async function runCli(argv: string[], logger: Logger): Promise<number> {
  const opts = parseCliOptions(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (opts.inspect) {
    await inspectCreature(opts.slug, logger);
    return 0;
  }
  const orchestrator = new ImportOrchestrator(opts.verbose);
  const summary = await orchestrator.run(opts);
  return summary.failed > 0 ? 1 : 0;
}

/** Modo debug: mostra uma criatura já importada no banco. */
async function inspectCreature(slug: string | undefined, logger: Logger): Promise<void> {
  if (!slug) {
    logger.error('inspect', 'Informe --slug=<slug>');
    return;
  }
  const prisma = new PrismaClient();
  try {
    const creature = await new ImportRepository(prisma).findCreatureBySlug(slug);
    if (!creature) {
      logger.error('inspect', `Criatura não encontrada: ${slug}`);
      return;
    }
    console.log(`Creature: ${creature.name}`);
    console.log(`Slug: ${creature.slug}`);
    console.log(`HP: ${creature.source_hp ?? '—'}`);
    console.log(`XP: ${creature.source_experience ?? '—'}`);
    console.log(`Dificuldade: ${creature.difficulty ?? '—'}${creature.difficulty_raw ? ` (${creature.difficulty_raw})` : ''}`);
    console.log(`Charms: ${creature.charms ?? '—'}`);
    console.log(`Imagem: ${creature.image_url ?? '—'}`);
    console.log(`GIF: ${creature.gif_url ?? '—'}`);
    console.log(`URL: ${creature.source_url ?? '—'}`);
    console.log('Loot:');
    creature.loots.forEach((l, i) => {
      const qty = l.min_quantity !== null ? `${l.min_quantity}-${l.max_quantity ?? l.min_quantity}` : '—';
      console.log(
        `  ${i + 1}. ${l.item_name} (Raridade: ${l.rarity}, Quantidade: ${qty}${l.chance !== null ? `, Chance: ${l.chance}%` : ''})`,
      );
    });
  } finally {
    await prisma.$disconnect();
  }
}
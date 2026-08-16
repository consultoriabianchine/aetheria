import dotenv from 'dotenv';
import path from 'node:path';
import { runCli } from './cli/import.command';
import { Logger } from './utils/logger';

// Carrega .env local e o .env do monorepo (raiz) — sem sobrescrever vars já definidas.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '..', '..', '.env') });
dotenv.config();

async function main(): Promise<void> {
  const logger = new Logger();
  const code = await runCli(process.argv.slice(2), logger);
  process.exitCode = code;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ItemDefinition } from '@aetheria/types';

let catalog: Map<string, ItemDefinition> | null = null;

/** Carrega o catálogo de itens gerado (data/items.json) uma única vez. */
export function getItemCatalog(): Map<string, ItemDefinition> {
  if (catalog) return catalog;
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'data', 'items.json'),
    path.join(__dirname, '..', '..', 'data', 'items.json'),
    path.join(process.cwd(), 'data', 'items.json'),
    path.join(process.cwd(), 'apps', 'game-server', 'data', 'items.json'),
  ];
  const file = candidates.find((c) => existsSync(c));
  if (!file) throw new Error(`items.json não encontrado (procurado em: ${candidates.join(', ')})`);
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { items: ItemDefinition[] };
  catalog = new Map(parsed.items.map((i) => [i.id, i]));
  return catalog;
}

export function getItemDef(id: string): ItemDefinition | undefined {
  return getItemCatalog().get(id);
}
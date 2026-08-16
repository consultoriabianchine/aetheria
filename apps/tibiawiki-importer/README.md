# TibiaWiki Importer

Scraper/importador de criaturas e loot da [TibiaWiki](https://www.tibiawiki.com.br) para o PostgreSQL
do MMORPG Aetheria. Compartilha o schema Prisma com o resto do monorepo (`packages/database`).

## Funcionalidades

- Descobre criaturas da categoria (default: **Humanóides**), respeitando paginação (`pagefrom`).
- Extrai de cada página: nome, HP, XP, charm points, dificuldade, imagem/GIF, descrição e **loot**
  (item, raridade, quantidade, chance).
- **Idempotente**: upsert por `source_url` (fallback: `slug`), `source_hash` (SHA256) para pular
  conteúdo inalterado, `creature_loot` sincronizada sem apagar loot do jogo (linhas com `item_id`).
- **Separação fonte × jogo**: grava apenas colunas `source_*`; as colunas `game_*` são do balanceamento
  do jogo e nunca são tocadas pelo importador.
- Registra histórico: `import_runs`, `import_errors`, `import_snapshots`.
- Baixa assets (imagens/GIFs) com cache, sanitização de slug e modo `--dry-run`.

## Pré-requisitos

- Node 20+ e PostgreSQL 14+ (ou `docker compose up -d postgres`).
- A partir da raiz do monorepo: `npm install` (gera o client Prisma em `packages/database/generated`).

## Uso

Tudo a partir da raiz do monorepo:

```bash
# Dry-run limitado (não persiste nada) — validação rápida
npm run importer -- --dry-run --limit=3

# Importação real de 3 criaturas
npm run importer -- --limit=3

# Importação completa da categoria
npm run importer

# Inspecionar o que foi importado
npm run importer -- --inspect --slug=boar-man

# Atalhos prontos (definidos em package.json da raiz)
npm run importer:dry
npm run importer:test
npm run importer:integration
```

### Flags

| Flag | Efeito |
| --- | --- |
| `--category-url=<URL>` | Categoria a importar (default: `TIBIAWIKI_CATEGORY_URL`) |
| `--limit=<N>` | Processa só as N primeiras criaturas |
| `--dry-run` | Não grava no banco nem baixa assets |
| `--force` | Reprocessa mesmo sem alteração de conteúdo |
| `--update` | Atualiza registros existentes |
| `--download-assets` | Baixa imagens/GIFs (default) |
| `--skip-assets` | Não baixa assets |
| `--verbose` | Logs detalhados |
| `--inspect --slug=<x>` | Inspeciona uma criatura importada |
| `--help` | Ajuda |

## Configuração (env)

| Variável | Default | Descrição |
| --- | --- | --- |
| `TIBIAWIKI_CATEGORY_URL` | `https://www.tibiawiki.com.br/wiki/Human%C3%B3ides` | Categoria padrão |
| `DATABASE_URL` | — | Conexão PostgreSQL (Prisma) |
| `SCRAPER_CONCURRENCY` | `1` | Requests simultâneos |
| `SCRAPER_DELAY_MS` | `2500` | Atraso entre requests (gentileza com a wiki / Cloudflare) |
| `SCRAPER_TIMEOUT_MS` | `15000` | Timeout HTTP |
| `SCRAPER_MAX_RETRIES` | `5` | Retries com backoff |
| `SCRAPER_USER_AGENT` | `Aetheria-Importer/0.1 (...)` | User-Agent |
| `IMPORT_ITEMS` | `true` | Importa também a tabela `items` |
| `SCRAPER_ASSETS_ROOT` | `<app>/assets` | Saída de assets (relativa ao app, não ao cwd) |
| `SCRAPER_EXPORTS_ROOT` | `<app>/exports/creatures` | Exportação JSON |

Veja `.env.example` na raiz do monorepo.

## Estrutura de saída

```
assets/
  creatures/<slug>/creature.<ext>   # imagem/GIF principal
                     metadata.json  # metadados do asset
  items/<slug>/                     # itens (se IMPORT_ITEMS=true)
  raw/<hash>.html                   # HTML bruto (debug)
  cache/                            # cache HTTP
exports/creatures/<slug>.json       # dados normalizados
```

## Testes

```bash
npm run test -w tibiawiki-importer   # vitest (fixtures locais, sem internet)
```

## Docker

```bash
docker compose --profile importer run --rm tibiawiki-importer
# ou com flags:
docker compose --profile importer run --rm tibiawiki-importer sh -c \
  "node apps/tibiawiki-importer/dist/main.js --limit=3"
```
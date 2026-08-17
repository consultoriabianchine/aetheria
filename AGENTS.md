# AGENTS.md

Guia para agentes de IA que trabalham no repositório **Aetheria Online** — um MMORPG 2D multiplayer original (Angular + Phaser + NestJS + PostgreSQL).

## Visão geral do monorepo

npm workspaces na raiz. Node >= 20. Stack por área:

| Área | Caminho | Stack |
|---|---|---|
| Servidor de jogo | `apps/game-server/` | NestJS 11 + Socket.IO 4 (WebSocket puro, sem REST) |
| Cliente web | `apps/web/` | Angular 22 (standalone/signals) + Phaser 3.90 |
| Importer TibiaWiki | `apps/tibiawiki-importer/` | axios + cheerio + zod (scraper estático) |
| Banco de dados | `packages/database/` | Prisma 6 + PostgreSQL 16 |
| Constantes de jogo | `packages/game-config/` | `@aetheria/config` |
| Protocolo WS | `packages/game-protocol/` | `@aetheria/protocol` (ClientMessage/ServerMessage, SERVER_EVENTS) |
| Tipos compartilhados | `packages/game-types/` | `@aetheria/types` |
| Utilitários | `packages/shared/` | `@aetheria/shared` (math de tile, PRNG) |

## Arquitetura (conceitos-chave)

- **Servidor é autoritativo**: posição, dano, inventário e combate são validados no `GameEngine` (`apps/game-server/src/game/engine/game-engine.ts`). O cliente apenas renderiza o que o servidor emite.
- **Auth**: token HMAC-SHA256 (payload `{a,u,exp}`, TTL 24h), contas criadas automaticamente no login (bcrypt).
- **Mundo**: mapa procedural determinístico 64×64 (z=7) via `mulberry32` (`world-map.ts`). IA de criaturas com state machine IDLE→WANDER→CHASE→ATTACK→FLEE→RETURN→DEAD + A* (`creature-ai.service.ts`, `pathfinding.ts`).
- **Dados de criatura — separação source × game**: o importer escreve **somente** colunas `source_*`; colunas `game_*` são de balanceamento manual. O jogo faz coalesce (`game_*` com fallback `source_*`).
- **Persistência**: `Store` interface com duas implementações — `MemoryStore` (`USE_IN_MEMORY=true`, sem DB) e `PrismaStore` (produção). Sem pasta de migrações: schema aplicado via `prisma db push`.

## Comandos (rodar da raiz)

- **Build**: `npm run build` (ou `build:packages`, `build:server`, `build:web`, `build:importer`)
- **Dev**: `npm run dev:server` (porta 4000) e `npm run dev:web` (porta 4200)
- **Central de Comando (admin)**: `npm run dev:admin` (porta 4300) · `build:admin`. App Angular `apps/admin` — editor de sprites/animação de criaturas. Endpoints REST no game-server: `/admin/creatures*` (Bearer `ADMIN_TOKEN`) e `/assets/creatures/:id[/animation]` (público). Spritesheets ficam em `creature_sprite_assets` (BYTEA) e a config em `creature_animation_configs` (JSONB Zod, versionado). Migrar sprites: `node scripts/seed-creature-sprites.cjs`.
- **Banco**: `npm run db:generate` · `db:push` · `db:migrate` · `db:seed`
- **Testes**: `npm test` (server + importer vitest) · `npm run server:test` · `npm run importer:test-unit`
- **Importer**: `npm run importer:dry` · `importer:test` (dry-run limit 3) · `importer:inspect`
- **Itens (wiki → catálogo + imagens)**: `npm run importer:items:fetch` baixa conteúdo e GIFs da TibiaWiki (snapshots em `apps/tibiawiki-importer/data/wiki-items-raw/`, imagens em `apps/web/src/assets/items/`); `importer:items:fetch-images` refaz só as imagens; `importer:items` regenera `items.json` (server + web). Requer `@aetheria/protocol`… só Node com User-Agent de browser (Cloudflare bloqueia UA padrão).
- **Integração (servidor rodando)**: `node scripts/smoke-test.cjs` · `node scripts/kill-test.cjs` · `node scripts/ws-origin-test.cjs`
- **Docker**: `docker compose up -d postgres` (DB local); `docker compose up --build` sobe postgres+server+web; adicionar `--profile importer` para o job do importer.

## Regras de desenvolvimento

1. **Não duplique constantes**: valores de jogo (mapa, tick, IA, alcances, canais de chat) vêm de `@aetheria/config`. Tipos de mensagem vêm de `@aetheria/protocol`. Matemática de tile de `@aetheria/shared`.
2. **Importer nunca toca `game_*`**; jogo não edita `source_*`.
3. **Servidor valida tudo**: range-check de ataque, pickup e interação com NPC; rate-limit de chat.
4. **Não adicione comentários desnecessários** ao código; siga o estilo dos arquivos vizinhos.
5. **Verifique antes de concluir**: rode o build da parte alterada e os testes correspondentes.
6. **Docker/Postgres**: credenciais default `aetheria`/`aetheria_dev` (veja `.env.example`).

## Agentes do projeto (`.opencode/agent/`)

- `game-server` — lógica autoritativa do servidor (engine, gateway, store, AI, protocolo).
- `web-client` — UI Angular + WorldScene Phaser + GameState/WsService.
- `tibiawiki-importer` — scraping, parsing, normalização, assets e repositórios do importer.
- `database` — schema Prisma, seeds e modelagem de dados.
- `game-tester` — testes vitest, scripts de integração socket.io e diagnóstico de builds.
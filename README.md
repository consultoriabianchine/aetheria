# Aetheria Online

MMORPG 2D multiplayer original, de cima para baixo, construído com **Angular + Phaser** no cliente e **NestJS + Socket.IO** no servidor, com dados populados por um **importer da TibiaWiki** em PostgreSQL.

## Stack

| Camada | Tecnologia |
|---|---|
| Cliente | Angular 22 (standalone/signals) · Phaser 3.90 |
| Servidor | NestJS 11 · Socket.IO 4 (WebSocket puro, sem REST) |
| Banco | PostgreSQL 16 · Prisma 6 |
| Importer | axios · cheerio · zod (scraper estático) |

## Estrutura do monorepo

```
apps/
  game-server/          Servidor autoritativo do jogo (engine, gateway, IA, store)
  web/                  Cliente Angular + WorldScene Phaser + HUD
  tibiawiki-importer/   Scraper/importador da TibiaWiki (criaturas, loot, itens)
packages/
  database/             @aetheria/database — schema Prisma compartilhado
  game-config/          @aetheria/config — constantes de jogo (mapa, tick, IA, chat)
  game-protocol/        @aetheria/protocol — mensagens WS (ClientMessage/ServerMessage)
  game-types/           @aetheria/types — tipos compartilhados
  shared/               @aetheria/shared — math de tile, PRNG, uid
scripts/                Testes de integração socket.io (smoke, kill, origin)
```

## Arquitetura em poucas linhas

- **Servidor autoritativo** — posição, dano, inventário e combate são validados no `GameEngine`. O cliente só renderiza o que o servidor emite via Socket.IO.
- **Auth** — token HMAC-SHA256 (`{a,u,exp}`, TTL 24h); contas criadas automaticamente no primeiro login (bcrypt).
- **Mundo procedural** — mapa determinístico 64×64 (z=7) gerado por `mulberry32`; IA de criaturas com state machine IDLE→WANDER→CHASE→ATTACK→FLEE→RETURN→DEAD e A*.
- **Dados de criatura** — separação `source_*` (importer) × `game_*` (balanceamento manual); o jogo faz coalesce com fallback.

## Pré-requisitos

- Node **>= 20** (npm workspaces)
- PostgreSQL 16 (local ou via Docker)
- Docker Compose (opcional)

## Como rodar

```bash
# 1. Instalar dependências (roda prisma generate via postinstall)
npm install

# 2. Banco de dados (opcional — para usar em memória, veja abaixo)
docker compose up -d postgres
cp .env.example .env        # ajuste DATABASE_URL se necessário
npm run db:push             # aplica o schema (sem pasta de migrações)
npm run db:seed             # itens, criaturas, NPCs, mapa e spawns

# 3. Servidor (porta 4000)
npm run dev:server

# 4. Cliente (porta 4200)
npm run dev:web
# acesse http://localhost:4200
```

> **Sem banco?** Defina `USE_IN_MEMORY=true` no `.env` — o servidor usa `MemoryStore` e não precisa de PostgreSQL. As criaturas caem para o `CREATURE_SEED`.

## Comandos úteis

| Comando | Descrição |
|---|---|
| `npm run build` | Build de packages + server + web + importer |
| `npm test` | Testes unitários (server + importer, vitest) |
| `npm run importer:dry` | Dry-run do importer (sem persistir) |
| `npm run importer:test` | Dry-run limitado a 3 criaturas |
| `npm run importer:inspect` | Inspeciona uma criatura importada |
| `node scripts/smoke-test.cjs` | Fluxo completo via WS (login→mundo→movimento) |
| `node scripts/kill-test.cjs` | Teste de combate e loot (30s) |
| `node scripts/ws-origin-test.cjs` | Validação de CORS/origin |

### Docker (tudo junto)

```bash
docker compose up --build            # postgres + server + web
docker compose up --build --profile importer   # + job de importação
```

## Importer da TibiaWiki

O importer popula criaturas, loot e itens a partir da TibiaWiki (PT-BR), de forma idempotente (upsert por URL + hash de conteúdo). Ele escreve **somente** colunas `source_*` — o balanceamento (`game_*`) é manual. Veja `apps/tibiawiki-importer/README.md`.

## Testes de integração

Os scripts `scripts/*.cjs` exigem o servidor rodando em `localhost:4000` e cobrem: happy path completo, combate/loot e permissão de origin. Para executá-los, rode `npm run dev:server` (ou a imagem Docker do server) e depois os scripts.

## Roadmap (ideias de próximos passos)

- Quest, NPCs comerciantes e mercado
- Mais sprites/criaturas no cliente (configurados na Central de Comando — `apps/admin`)
- Migrações Prisma versionadas (hoje o schema é aplicado via `db push`)
- Sistema de magias/skills por personagem
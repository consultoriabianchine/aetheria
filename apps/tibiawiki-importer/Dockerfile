# Base compartilhada de dependências (monorepo).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/tibiawiki-importer/package.json apps/tibiawiki-importer/
COPY apps/game-server/package.json apps/game-server/
COPY apps/web/package.json apps/web/
COPY packages/*/package.json packages/
RUN npm install

# Build: packages + importer.
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
RUN npm run build:packages && npm run build:importer

# Runtime enxuto (importador é um job: requer também as dists dos packages).
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/tibiawiki-importer/dist ./apps/tibiawiki-importer/dist
COPY --from=build /app/packages ./packages
CMD ["node", "apps/tibiawiki-importer/dist/main.js", "--verbose"]
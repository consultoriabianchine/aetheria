# Base compartilhada de dependências (monorepo).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/game-server/package.json apps/game-server/
COPY apps/web/package.json apps/web/
COPY packages ./packages
RUN npm install

# Build: packages + game-server.
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
RUN npm run build:packages && npm run build:server

# Runtime enxuto.
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/game-server/package.json ./apps/game-server/package.json
COPY --from=build /app/apps/game-server/tsconfig.json ./apps/game-server/tsconfig.json
COPY --from=build /app/apps/game-server/src ./apps/game-server/src
COPY --from=build /app/apps/game-server/dist ./apps/game-server/dist
COPY --from=build /app/apps/game-server/data ./apps/game-server/data
COPY --from=build /app/apps/game-server/prisma ./apps/game-server/prisma
COPY --from=build /app/packages ./packages
COPY apps/game-server/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
EXPOSE 4000
CMD ["/app/entrypoint.sh"]

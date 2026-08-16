# Build: packages + web (Angular).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY apps/game-server/package.json apps/game-server/
COPY packages ./packages
RUN npm install
COPY . .
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
RUN npm run build:packages && npm run build:web

# Runtime: nginx servindo o SPA.
FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist/aetheria-web/browser /usr/share/nginx/html
EXPOSE 80
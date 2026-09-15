# Build: packages + admin (Angular).
FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=4096 \
    NG_BUILD_MAX_WORKERS=2
COPY package.json package-lock.json* ./
COPY apps/admin/package.json apps/admin/
COPY apps/game-server/package.json apps/game-server/
COPY packages ./packages
RUN npm install
COPY . .
RUN npx prisma generate --schema packages/database/prisma/schema.prisma
RUN npm run build:packages && npm run build:admin

# Runtime: nginx servindo o SPA.
FROM nginx:1.27-alpine AS runtime
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin/dist/aetheria-admin/browser /usr/share/nginx/html
EXPOSE 80

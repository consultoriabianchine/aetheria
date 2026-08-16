#!/bin/sh
set -e
cd /app/apps/game-server
if npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script | grep -q .; then
  echo "Sincronizando schema do banco (prisma db push)..."
  npx prisma db push --skip-generate --accept-data-loss
else
  echo "Schema do banco em dia."
fi
echo "Iniciando Aetheria game-server..."
exec node dist/main.js
#!/bin/sh
set -e
cd /app/apps/game-server
SCHEMA=/app/packages/database/prisma/schema.prisma
if npx prisma migrate diff --from-schema-datasource "$SCHEMA" --to-schema-datamodel "$SCHEMA" --script | grep -q .; then
  echo "Sincronizando schema do banco (prisma db push)..."
  npx prisma db push --schema "$SCHEMA" --skip-generate --accept-data-loss
else
  echo "Schema do banco em dia."
fi
echo "Iniciando Aetheria game-server..."
exec node dist/src/main.js
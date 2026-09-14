#!/usr/bin/env bash
# Despliegue de PRODUCCIÓN: trae las imágenes ya publicadas por el CI de
# cada subrepo (ghcr.io/stemhub-dev/*) y levanta el stack.
#
# A diferencia de up.sh, este script NUNCA levanta Supabase local — producción
# usa un proyecto de Supabase Cloud (ver .env.production.example), no la CLI.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

ENV_FILE="${1:-.env.production}"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: no existe '$ENV_FILE'. Copiar .env.production.example y ajustar." >&2
  exit 1
fi

echo "==> 1/2 Descargando imágenes (${ENV_FILE})..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" pull

echo "==> 2/2 Levantando el stack..."
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d

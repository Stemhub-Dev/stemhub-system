#!/usr/bin/env bash
# Baja el proyecto completo: docker compose y Supabase local.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "==> 1/2 Bajando Postgres, MinIO, ML, Backend y Frontend..."
docker compose down

echo "==> 2/2 Bajando Supabase local..."
(cd Stem-Hub-BackEnd && npx supabase stop)

#!/usr/bin/env bash
# Levanta Supabase local (Auth) y el resto del stack (Postgres, MinIO, ML,
# Backend, Frontend) vía docker compose.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "==> 1/2 Levantando Supabase local (Auth, DB propia, Studio)..."
(cd Stem-Hub-BackEnd && npm install --no-fund --no-audit && npx supabase start)

echo "==> 2/2 Levantando Postgres, MinIO, ML, Backend y Frontend..."
docker compose up -d --build

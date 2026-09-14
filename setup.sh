#!/usr/bin/env bash
# Clona (o actualiza) los repos que arma el docker-compose orquestador.
# Siempre deja cada repo en el último commit de su rama principal (main).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

BRANCH="main"

declare -A REPOS=(
  ["Stem-Hub-BackEnd"]="https://github.com/Stemhub-Dev/Stem-Hub-BackEnd.git"
  ["stemhub-frontend"]="https://github.com/Stemhub-Dev/stemhub-frontend.git"
  ["stemhub-microservicio-IA"]="https://github.com/Stemhub-Dev/stemhub-microservicio-IA.git"
)

for dir in "${!REPOS[@]}"; do
  url="${REPOS[$dir]}"

  if [ -d "$dir/.git" ]; then
    echo "==> $dir ya existe, actualizando '$BRANCH'..."
    git -C "$dir" fetch origin "$BRANCH"
    git -C "$dir" checkout "$BRANCH"
    git -C "$dir" reset --hard "origin/$BRANCH"
  else
    echo "==> Clonando $dir desde $url ('$BRANCH')..."
    git clone --branch "$BRANCH" --single-branch "$url" "$dir"
  fi
done

echo "==> Listo. Repos actualizados a la última versión de '$BRANCH'."

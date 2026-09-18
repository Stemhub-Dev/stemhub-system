# Levanta Supabase local (Auth) y el resto del stack (Postgres, MinIO, ML,
# Backend, Frontend) vía docker compose.
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

Write-Host "==> 1/2 Levantando Supabase local (Auth, DB propia, Studio)..."
Set-Location "Stem-Hub-BackEnd"
npm install --no-fund --no-audit
npx supabase start
Set-Location $RootDir

Write-Host "==> 2/2 Levantando Postgres, MinIO, ML, Backend y Frontend..."
docker compose up -d --build

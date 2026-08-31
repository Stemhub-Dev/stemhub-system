# Baja el proyecto completo: docker compose y Supabase local.
$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

Write-Host "==> 1/2 Bajando Postgres, MinIO, ML, Backend y Frontend..."
docker compose down

Write-Host "==> 2/2 Bajando Supabase local..."
Set-Location "Stem-Hub-BackEnd"
npx supabase stop
Set-Location $RootDir

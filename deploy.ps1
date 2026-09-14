# Despliegue de PRODUCCIÓN: trae las imágenes ya publicadas por el CI de
# cada subrepo (ghcr.io/stemhub-dev/*) y levanta el stack.
#
# A diferencia de up.ps1, este script NUNCA levanta Supabase local —
# producción usa un proyecto de Supabase Cloud (ver .env.production.example),
# no la CLI.
param(
    [string]$EnvFile = ".env.production"
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $RootDir

if (-not (Test-Path $EnvFile)) {
    Write-Error "No existe '$EnvFile'. Copiar .env.production.example y ajustar."
    exit 1
}

Write-Host "==> 1/2 Descargando imágenes ($EnvFile)..."
docker compose -f docker-compose.prod.yml --env-file $EnvFile pull

Write-Host "==> 2/2 Levantando el stack..."
docker compose -f docker-compose.prod.yml --env-file $EnvFile up -d

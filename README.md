# stemhub-system

Orquestador de los repos de StemHub (backend, frontend, microservicio de IA).

## Requisitos

- Docker y Docker Compose
- Git

## Desarrollo local vs producción

Este repo separa dos flujos:

- **Desarrollo local**: `docker-compose.yml` (base) + `docker-compose.override.yml`
  (aplicado automático por Compose) construyen las imágenes desde el checkout
  local de cada subrepo y usan Supabase local (Auth/GoTrue) vía su propia CLI
  — no forma parte de este `docker compose`. Es el flujo de abajo (`up.sh`/`up.ps1`).
- **Producción**: `docker-compose.yml` (base) + `docker-compose.prod.yml`
  (aplicado explícito con `-f`) usan las imágenes ya publicadas por el CI de
  cada subrepo en `ghcr.io/stemhub-dev/*` y un proyecto de Supabase Cloud, sin
  build local ni CLI. Ver [`deploy.sh`](./deploy.sh) y
  [`.env.production.example`](./.env.production.example).

`docker-compose.override.yml` y `docker-compose.prod.yml` nunca se combinan
entre sí — son alternativas, no capas apilables.

## Estructura de archivos

| Archivo | Qué hace |
|---|---|
| `docker-compose.yml` | Base común a dev y producción: servicios, redes, volúmenes nombrados, healthchecks y las variables de entorno que no cambian entre entornos. Ningún servicio propio (`backend`/`frontend`/`ml-service`/`ml-spleeter-worker`) define `build:` ni `image:` acá — eso vive exclusivamente en uno de los dos archivos de abajo, para que este archivo nunca se pueda levantar solo por error. |
| `docker-compose.override.yml` | Override de **desarrollo**. Docker Compose lo aplica automáticamente junto al base en cualquier `docker compose ...` sin flags (por eso `up.sh`/`up.ps1` no necesitan `-f`). Agrega el `build: context: ./<subrepo>` de cada servicio (construye desde el checkout local) y la red externa `supabase_network_stemhub` que crea `npx supabase start`, necesaria para que el backend alcance a Kong y descargue el JWKS del Auth local. |
| `docker-compose.prod.yml` | Override de **producción**. Se aplica explícito con `-f` (nunca junto al de dev — lo hace `deploy.sh`). Reemplaza cada `build:` por `image: ghcr.io/stemhub-dev/<servicio>:<tag>`, las imágenes ya publicadas por el CI de cada subrepo. No declara la red de Supabase local: producción usa un proyecto de Supabase Cloud. |
| `.env.example` | Variables de **desarrollo** (usadas por `up.sh`/`down.sh`, es decir base + override). Copiar a `.env`. |
| `.env.production.example` | Variables de **producción** (usadas por `deploy.sh`, es decir base + prod): tags de imagen, URLs de Supabase Cloud, dominios reales, SMTP real, endpoint público de MinIO. Copiar a `.env.production`. |
| `up.sh` / `up.ps1` | Levantan Supabase local + el stack de desarrollo (`docker compose up -d --build`, aplica base+override). Sin cambios de comportamiento respecto a antes de esta reorganización. |
| `down.sh` / `down.ps1` | Bajan el stack de desarrollo y Supabase local, en el orden correcto. |
| `deploy.sh` / `deploy.ps1` | Despliegue de **producción**: `docker compose pull` + `up -d` contra base+prod, usando `.env.production`. A diferencia de `up.sh`, nunca invoca la CLI de Supabase — producción no depende de ella. |
| `setup.sh` | Clona/actualiza los 3 subrepos (`Stem-Hub-BackEnd`, `stemhub-frontend`, `stemhub-microservicio-IA`) a la rama `main`. Sin cambios. |
| `Stem-Hub-BackEnd/.github/workflows/publish-image.yml`, `stemhub-frontend/.github/workflows/publish-image.yml`, `stemhub-microservicio-IA/.github/workflows/publish-image.yml` | Viven en cada subrepo, no acá — build + push de la imagen de ese servicio a `ghcr.io/stemhub-dev/*` en cada push a `main` o tag `v*`. Es lo que `docker-compose.prod.yml` termina consumiendo. |

Los 3 `docker-compose.yml`/`compose.yaml` que antes existían dentro de cada
subrepo (`Stem-Hub-BackEnd/compose.yaml`, `stemhub-frontend/docker-compose.yml`,
`stemhub-microservicio-IA/docker-compose.yml`) se eliminaron: duplicaban
infraestructura compartida (cada uno con su propio Postgres/MinIO/redes) con
nombres que colisionaban entre sí si corrían a la vez, y ninguno estaba
siquiera documentado como flujo real de desarrollo. El único punto de
entrada para levantar el stack es este repo. Cada subrepo sigue siendo
standalone-*buildable* por su `Dockerfile` (`docker build .`) para CI o
debug puntual de la imagen sola.

## Levantar el proyecto (desarrollo local)

### 1. Clonar/actualizar los repos y configurar `.env` (una sola vez)

```bash
./setup.sh                              # clona/actualiza los 3 repos en main
cp .env.example .env                    # completar DB_PASSWORD y demás secretos
```

Los defaults de `.env.example` ya apuntan al Supabase local (mismos puertos y
URLs fijos de la CLI), así que no hace falta tocar esas variables salvo que
uses Supabase Cloud en su lugar — ver
[`Stem-Hub-BackEnd/README.md`](./Stem-Hub-BackEnd/README.md) y
[`Stem-Hub-BackEnd/supabase/README.md`](./Stem-Hub-BackEnd/supabase/README.md)
para el detalle y cómo crear un usuario de prueba.

### 2. Levantar / bajar todo

`up`/`down` levantan y bajan Supabase local (`npx supabase start`/`stop`) y el
resto del stack (`docker compose`) en el orden correcto. Hay una versión por
sistema operativo — usar siempre estos scripts en vez de parar los
contenedores de Supabase a mano (por ejemplo desde Docker Desktop), porque la
CLI mantiene su propio estado interno y queda desincronizada si no pasa por
`supabase stop`.

**Linux / macOS**

```bash
./up.sh
./down.sh
```

**Windows (PowerShell)**

```powershell
.\up.ps1
.\down.ps1
```

Si PowerShell bloquea la ejecución por política de scripts, habilitarla una
vez (no requiere admin):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

El `docker compose up` de arriba ya deja el Frontend disponible en
http://localhost:5173, servido como build estático (sin hot reload). Para
desarrollo activo del Frontend conviene correrlo aparte con Vite en su lugar:

```bash
docker compose stop frontend            # libera el puerto 5173

cd stemhub-frontend
npm install
npm run dev                             # http://localhost:5173, con hot reload
```

Para levantar solo un subconjunto de servicios de forma aislada (por ejemplo,
trabajar en `ml-service` sin levantar backend/frontend/Supabase), usar un
nombre de proyecto (`-p`) propio para no chocar con la instancia completa:

```bash
docker compose -p stemhub-ml-dev up minio ml-spleeter-worker ml-service
```

## Servicios

| Servicio | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:8080 |
| ML Service | http://localhost:8000 |
| Postgres (Backend) | localhost:5432 |
| MinIO (API S3) | http://localhost:9000 |
| MinIO (consola) | http://localhost:9001 |
| Supabase Auth/API (Kong) | http://127.0.0.1:54321 |
| Supabase Studio | http://localhost:54323 |
| Supabase Inbucket (emails de prueba) | http://localhost:54324 |

## Despliegue a producción

Cada subrepo (`Stem-Hub-BackEnd`, `stemhub-frontend`,
`stemhub-microservicio-IA`) publica su imagen a `ghcr.io/stemhub-dev/*` vía
su propio workflow de GitHub Actions (`.github/workflows/publish-image.yml`)
en cada push a `main` o tag `v*`. Este repo orquestador nunca construye esas
imágenes en producción, solo las consume.

```bash
cp .env.production.example .env.production   # completar secretos y dominios reales
./deploy.sh                                   # o .\deploy.ps1 en Windows
```

`deploy.sh` hace `pull` + `up -d` contra `docker-compose.yml` +
`docker-compose.prod.yml`, sin depender de Supabase local — producción usa
un proyecto de Supabase Cloud (ver comentarios en `.env.production.example`).

El punto abierto de este esquema es MinIO: en producción real necesita un
endpoint público con TLS estable, o reemplazarse por un bucket S3-compatible
gestionado (AWS S3, Backblaze B2, DigitalOcean Spaces, MinIO gestionado).
Backend y ml-service ya leen el endpoint por variable de entorno, así que esa
migración es solo de configuración, no de código — ver el comentario
correspondiente en `.env.production.example`.

# stemhub-system

Orquestador de los repos de StemHub (backend, frontend, microservicio de IA).

## Requisitos

- Docker y Docker Compose
- Git

## Levantar el proyecto

La autenticación depende de un Supabase local (Auth/GoTrue), que se levanta
aparte con su propia CLI — no forma parte de este `docker compose`.

```bash
./setup.sh                              # clona/actualiza los 3 repos en main
cp .env.example .env                    # completar DB_PASSWORD y demás secretos

cd Stem-Hub-BackEnd
npx supabase start                      # levanta Supabase local (Auth, DB propia, Studio)
cd ..

docker compose up -d --build            # levanta Postgres, MinIO, ML, Backend y Frontend
```

Los defaults de `.env.example` ya apuntan al Supabase local que levanta
`npx supabase start` (mismos puertos y URLs fijos de la CLI), así que no hace
falta tocar esas variables salvo que uses Supabase Cloud en su lugar — ver
[`Stem-Hub-BackEnd/README.md`](./Stem-Hub-BackEnd/README.md) y
[`Stem-Hub-BackEnd/supabase/README.md`](./Stem-Hub-BackEnd/supabase/README.md)
para el detalle y cómo crear un usuario de prueba.

El `docker compose up` de arriba ya deja el Frontend disponible en
http://localhost:5173, servido como build estático (sin hot reload). Para
desarrollo activo del Frontend conviene correrlo aparte con Vite en su lugar:

```bash
docker compose stop frontend            # libera el puerto 5173

cd stemhub-frontend
npm install
npm run dev                             # http://localhost:5173, con hot reload
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

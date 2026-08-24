# stemhub-system

Orquestador de los repos de StemHub (backend, frontend, microservicio de IA).

## Requisitos

- Docker y Docker Compose
- Git

## Levantar el proyecto

```bash
./setup.sh                    # clona/actualiza los 3 repos en main
cp .env.example .env          # completar DB_PASSWORD
docker compose up -d --build
```

## Servicios

| Servicio | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend | http://localhost:8080 |
| ML Service | http://localhost:8000 |
| Postgres | localhost:5432 |
| MinIO (API S3) | http://localhost:9000 |
| MinIO (consola) | http://localhost:9001 |

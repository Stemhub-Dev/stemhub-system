# Monitoreo del servidor de producción

```
stemhub-server (prod)                              máquina de cada dev
  node-exporter 127.0.0.1:9100  (host) ──┐
  cAdvisor      127.0.0.1:8098  (contenedores) ──┤ scrape
  Prometheus    127.0.0.1:9090 ◄─────────┘
       ▲ tailscale serve --tcp 9090
       └──────────── tailnet (100.77.160.104:9090) ◄──── Grafana localhost:3000
```

- `server/`: Prometheus (15 días / 2 GB de historia) + node-exporter +
  cAdvisor. Corre en el server con `docker compose`, **fuera de Coolify**,
  para que un redeploy de la app no lo toque. Nada escucha fuera de
  `127.0.0.1`; Prometheus se publica solo a la tailnet.
- `grafana/`: Grafana local con el datasource y dos dashboards provisionados:
  - **StemHub — Servidor** (home): CPU, RAM, swap, presión de memoria/IO
    (PSI) y consumo por contenedor. Los contenedores de Coolify cambian de
    nombre en cada deploy (`backend-<uuid>-<timestamp>`); el dashboard les
    quita ese sufijo para que la serie siga entre deploys.
  - **Node Exporter Full** (grafana.com #1860): detalle completo del host.

## Ver las métricas (cada dev)

Requiere estar en la tailnet con acceso al nodo `stemhub-server`.

```bash
docker compose -f monitoring/grafana/docker-compose.yml up -d
# → http://localhost:3000 (sin login; para editar, admin/admin)
```

Los dashboards salen de los JSON de `grafana/dashboards/`: los cambios
hechos desde la UI no se guardan. Para cambiar uno, exportar el JSON desde
Grafana y commitearlo.

## Instalar / actualizar en el server

```bash
ssh juampi@192.168.1.47 'mkdir -p ~/stemhub-monitoring'
scp monitoring/server/{docker-compose.yml,prometheus.yml} juampi@192.168.1.47:stemhub-monitoring/
ssh juampi@192.168.1.47 'cd ~/stemhub-monitoring && docker compose up -d'
# Una sola vez (persiste): publicar Prometheus a la tailnet.
ssh juampi@192.168.1.47 'tailscale serve --bg --tcp 9090 tcp://localhost:9090'
```

Gotcha: el `~/.docker/config.json` del server tiene una credencial de
`ghcr.io` (la de las imágenes privadas de StemHub) que ghcr rechaza para la
imagen pública de cAdvisor (`denied`). Bajarla sin credenciales:
`DOCKER_CONFIG=$(mktemp -d) docker pull ghcr.io/google/cadvisor:<tag>`.

Chequeo rápido: `curl -s http://100.77.160.104:9090/api/v1/targets` debe
mostrar `node`, `cadvisor` y `prometheus` con `health: up`.

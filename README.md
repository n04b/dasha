# Dasha Dashboard

A self-hosted dashboard that **automatically discovers services from your Docker
Compose files** and renders them as a clean, responsive grid of cards — no manual
configuration required.

Point it at a directory of compose projects; it scans them recursively, extracts
each service, resolves an icon (cached locally from [Iconify](https://iconify.design)),
builds a URL, and continuously checks whether the service is reachable. It rebuilds
itself whenever the compose files change.

## Features

-  **Automatic scanning** — recursively finds `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`.
-  **Zero-config dashboard** — cards are built straight from the compose files.
-  **Local icon cache** — SVGs pulled from Iconify and stored in `/icons`.
-  **Availability checks** — periodic HTTP probes → `Online` / `Offline` / `Timeout`.
-  **Live reload** — file watcher rebuilds on create / change / delete.
-  **Light & dark themes**, fully responsive.
-  **REST API** for integration.
-  **Hardened**: non-root, healthcheck, graceful shutdown, `read_only` root filesystem, multi-arch (arm64 + amd64).

## Quick start

```bash
docker compose up -d --build
```

Then open <http://localhost>. The bundled [`docker-compose.yml`](docker-compose.yml)
mounts the [`examples/`](examples) folder so you see cards immediately. Point the
`/compose` mount at your own projects instead:

```yaml
services:
  dasha:
    image: dasha:latest
    ports:
      - "80:1337"   # host port 80 -> app listens on 1337 inside the container
    environment:
      APP_HOST: server.local   # host your published ports are reachable on
      CHECK_INTERVAL: "30"
      PORT: "1337"
    volumes:
      - /path/to/your/projects:/compose:ro
    tmpfs:
      - /icons:mode=1777   # writable icon cache for the non-root user
    read_only: true
    security_opt:
      - no-new-privileges:true
```

## How services are interpreted

For every service the following fields are extracted:
`name`, `image`, `container_name`, `labels`, `environment`, `ports`, `networks`.

**Card name** — priority:
1. `x-dasha-name` (service-level compose extension)
2. service name

**Card URL** — priority:
1. `x-dasha-port`
2. first published (host) port

The port is combined with `APP_HOST`, e.g. `http://server.local:3000`.

**Icon** — priority (all cached locally under `/icons`):
1. `x-dasha-icon` (a word to search, or an explicit Iconify id like `simple-icons:grafana`)
2. service name
3. image name
4. container name

### Example with overrides

```yaml
services:
  grafana:
    image: grafana/grafana:latest
    x-dasha-name: "Grafana Metrics"
    x-dasha-icon: "simple-icons:grafana"
    x-dasha-port: 3000
    ports:
      - "3000:3000"
```

## Configuration

| Variable         | Default     | Description                                       |
| ---------------- | ----------- | ------------------------------------------------- |
| `APP_HOST`       | `localhost` | Hostname used to build service URLs.              |
| `CHECK_INTERVAL` | `30`        | Availability-check interval, in seconds.          |
| `PORT`           | `1337`      | Port the dashboard listens on.                    |
| `COMPOSE_DIR`    | `/compose`  | Root scanned for compose files (recursive).       |
| `ICONS_DIR`      | `/icons`    | Local icon cache (mount as volume/tmpfs).         |
| `HEALTH_TIMEOUT` | `5000`      | Availability-check request timeout (ms).          |
| `LOG_LEVEL`      | `info`      | `debug` \| `info` \| `warn` \| `error`.           |

## REST API

| Method | Endpoint             | Description                              |
| ------ | -------------------- | ---------------------------------------- |
| `GET`  | `/api/services`      | All discovered services + their status.  |
| `GET`  | `/api/compose/{id}`  | Raw content of a discovered compose file.|
| `POST` | `/api/reload`        | Force a rescan / rebuild.                 |
| `GET`  | `/api/config`        | Public runtime config.                    |
| `GET`  | `/healthz`           | Health endpoint (used by `HEALTHCHECK`). |

## Development

Run the backend and the Vite dev server (with API proxy) separately:

```bash
npm install
COMPOSE_DIR=./examples ICONS_DIR=./.icons node server/src/index.js   # API on :1337

cd web && npm install && npm run dev                                 # UI on :5173
```

## License

MIT

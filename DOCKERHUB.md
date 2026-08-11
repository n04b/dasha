# Dasha

**A self-hosted dashboard that auto-discovers services from your Docker Compose
files** and renders them as a minimalist, Apple Watch-style honeycomb mosaic on a
black background — zero manual configuration.

Point it at a directory of compose projects; it scans them recursively, extracts
each service, resolves and caches an icon, builds a URL, and keeps checking whether
the service is reachable. It rebuilds itself whenever the compose files change.

## Quick start

```bash
docker run -d --name dasha \
  -p 1337:1337 \
  -e APP_HOST=host.local \
  -e CHECK_HOST=host.docker.internal \
  --add-host host.docker.internal:host-gateway \
  -v /path/to/your/compose/projects:/compose:ro \
  --tmpfs /icons:mode=1777 \
  --read-only --security-opt no-new-privileges:true \
  n04b/dasha:latest
```

Open <http://localhost:1337>.

### docker-compose

```yaml
services:
  dasha:
    image: n04b/dasha:latest
    ports:
      - "1337:1337"
    environment:
      APP_HOST: host.local # host your browser reaches services on
      CHECK_HOST: host.docker.internal # host the checker probes services on
      CHECK_INTERVAL: "30"
    extra_hosts:
      - "host.docker.internal:host-gateway" # so probes reach the host on Linux
    volumes:
      - /path/to/your/compose/projects:/compose:ro
    tmpfs:
      - /icons:mode=1777 # writable icon cache for the non-root user
    read_only: true
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped
```

## Configuration

| Variable         | Default     | Description                                                            |
| ---------------- | ----------- | ---------------------------------------------------------------------- |
| `APP_HOST`       | `localhost` | Fallback host in the API payload and default for `CHECK_HOST`. Tile links use the host from your browser's address bar instead. |
| `CHECK_HOST`     | `APP_HOST`  | Host the availability checker probes. In a container set to `host.docker.internal` (or the host IP). |
| `CHECK_INTERVAL` | `30`        | Availability-check interval, in seconds.                              |
| `PORT`           | `1337`      | Port the dashboard listens on inside the container.                    |
| `COMPOSE_DIR`    | `/compose`  | Root scanned for compose files (recursive).                           |
| `ICONS_DIR`      | `/icons`    | Local icon cache (mount as a volume or tmpfs).                        |
| `HIDE_SERVICES`  | `dasha`     | Comma-separated names hidden from the dashboard (service key / container / image). |
| `HEALTH_TIMEOUT` | `5000`      | Availability-check request timeout (ms).                             |
| `LOG_LEVEL`      | `info`      | `debug` \| `info` \| `warn` \| `error`.                              |

## Volumes

| Path       | Mode         | Purpose                                             |
| ---------- | ------------ | --------------------------------------------------- |
| `/compose` | read-only    | Your compose projects, scanned recursively.         |
| `/icons`   | writable     | Cached SVG icons. Use a volume or `tmpfs:mode=1777`.|

## Per-service overrides

Add `x-dasha-*` keys to a service in your compose file:

```yaml
services:
  grafana:
    image: grafana/grafana:latest
    x-dasha-name: "Grafana Metrics"      # display name
    x-dasha-icon: "simple-icons:grafana" # Iconify id or a search term
    x-dasha-port: 3000                   # port used for the link / probe
    ports:
      - "3000:3000"
```

## Notes

- **Services up but shown as Offline?** Checks run *inside* the container, where
  `localhost` is the container itself. Set `CHECK_HOST=host.docker.internal` (and
  add the `host-gateway` entry on Linux). Non-HTTP services (databases, etc.) won't
  answer an HTTP probe and will read as Offline.
- **Hardened:** runs as a non-root user, ships a `HEALTHCHECK`, shuts down
  gracefully, and supports a read-only root filesystem (mount `/icons` writable).
- **No database** — state is held in memory.

## Source & issues

Full documentation and source: **<https://github.com/n04b/dasha>**

## License

MIT

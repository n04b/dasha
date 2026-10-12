# Dasha Dashboard

A self-hosted dashboard that **automatically discovers services from your Docker
Compose files** and renders them as a minimalist, Apple Watch-style honeycomb
mosaic on a black background — no manual configuration required.

Point it at a directory of compose projects; it scans them (one level deep by
default, configurable via `SCAN_DEPTH`), extracts each service, resolves an icon
(cached locally from [Iconify](https://iconify.design)), builds a URL, and —
if you opt in — checks whether the service is reachable. It rebuilds itself
whenever the compose files change.

## Why another dashboard?

I used [Heimdall](https://github.com/linuxserver/Heimdall) and
[Homer](https://github.com/bastienwirtz/homer) for a while, but both expect you
to curate the list of services by hand — adding, editing and re-ordering entries
as your stack changes. I wanted the dashboard to be derived automatically from the
compose files I already maintain, with zero manual bookkeeping, so I (well, actually Claude) wrote my own.

## Features

-  **Automatic scanning** — finds `docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml` (one level deep by default; raise `SCAN_DEPTH` for nested layouts).
-  **Zero-config dashboard** — cards are built straight from the compose files.
-  **Local icon cache** — SVGs pulled from Iconify and stored in `/icons`.
-  **iOS home-screen icon** — a dedicated Apple touch icon, alongside the SVG favicon.
-  **Availability checks** *(opt-in)* — periodic HTTP probes → `Online` / `Offline` / `Timeout`. Off by default; enable with `HEALTH_CHECKS=on` so the dashboard only reaches out to other containers when you ask it to.
-  **TODO/FIXME scanning** — collects `TODO` / `FIXME` comments from the compose files into a TODO widget tile.
-  **Variable interpolation** — `${VAR}` and `.env` files are resolved like Compose does, so variable-driven ports still yield working links.
-  **Live reload** — file watcher rebuilds on create / change / delete.
-  **Minimalist mosaic UI** — circular tiles in a honeycomb on a black background, fully responsive.
-  **Drag to rearrange** — put tiles anywhere in the honeycomb, including free cells; remembered per browser.
-  **Offline & Tailscale fallback** — opens from cache when the server is unreachable, and moves to its Tailscale (MagicDNS) address when that answers instead.
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

The port is combined with **the host you are viewing the dashboard on**: open it
at `http://server.local`, and the tiles link to `http://server.local:3000`; reach
it by IP, and they follow. Nothing to configure, and the links keep working from
every machine. (`APP_HOST` still fills in the `url` field the API returns, and is
the default for `CHECK_HOST`.)

### Variables

`${VAR}` references are substituted before the file is parsed, exactly as
Compose does it, so a port written as a variable still produces a working URL.
Values come from a `.env` file next to the compose file, overridden by the
dashboard's own environment. Editing a `.env` rebuilds the dashboard just like
editing a compose file.

```yaml
services:
  app:
    image: nginx
    ports:
      - "${APP_PORT:-8080}:80"   # .env, the environment, or the default
```

The full syntax is supported: `$VAR`, `${VAR}`, `${VAR:-default}`,
`${VAR-default}`, `${VAR:+alt}`, `${VAR+alt}`, `${VAR:?msg}` and `$$` for a
literal `$`. An unset variable resolves to an empty string and is logged as a
warning.

**Icon** — priority (all cached locally under `/icons`):
1. `x-dasha-icon` (a word to search, or an explicit Iconify id like `simple-icons:grafana`)
2. service name
3. image name
4. container name

**Hidden from the dashboard** — a service with `x-dasha-hide` gets no card:

```yaml
services:
  redis:
    image: redis:7-alpine     # infrastructure, nothing to click through to
    ports:
      - "6379:6379"
    x-dasha-hide: true
```

The value is optional — a bare `x-dasha-hide:` hides the service too — and
`false`, `no`, `off` and `0` turn it back off, so the key can stay in the file
while the card is on. This is the per-service counterpart of `HIDE_SERVICES`,
which hides by name across every compose file at once.

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

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    x-dasha-hide: true
```

## Rearranging the mosaic

Drag a tile wherever you want it in the honeycomb:

- **onto another tile** — the two trade places;
- **onto a free cell touching the mosaic** — the tile moves there and leaves a
  hole behind, so you can spread the cluster out, group tiles, or grow it in any
  direction;
- **anywhere else** — the drop is refused and the tile goes home. Every tile has
  to stay next to another one, or the mosaic would come apart.

The rest of the mosaic stays exactly where it is either way. On a touch screen,
press and hold a tile for a moment before dragging — a plain swipe still scrolls
the page. A drag never opens the service: only a click does.

The layout lives in the browser's `localStorage`, not on the server — the
services themselves come from your compose files, so nothing about your setup
has to change. It follows the profile, not the machine. Notes on what that
means day to day:

- Until you move something, the mosaic packs itself automatically and re-packs
  as the window resizes. The first drag pins every tile down, and from then on
  the arrangement is yours; it no longer re-packs on resize.
- A service added to a compose file later takes the free cell nearest the middle
  of the cluster, rather than reshuffling what you arranged.
- To go back to the automatic layout, clear the site data for the dashboard (or
  run `localStorage.removeItem('dasha.tile-layout.v2')` in the browser console).

## TODO / FIXME scanning

Dasha scans the compose files themselves for `TODO` and `FIXME` comments and
surfaces them as a **TODO widget tile** in the mosaic; clicking it opens a list
grouped by file, each entry with its `:line` location.

- **Multi-line comments count as one entry** — a run of consecutive `#` comment
  lines is collapsed into a single TODO.
- The keyword must open the comment, so prose that merely mentions "TODO" is
  ignored.

```yaml
services:
  # TODO: pin the image to a specific version
  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
```

## Offline access & Tailscale fallback

Dasha keeps working when the home server can't be reached at the address you
opened it on — say, `https://dasha.home.lan` from outside your LAN:

- **The app opens from cache.** A service worker caches the app itself (page,
  bundle, icons) on the first visit. Later, if the server doesn't answer within
  3 seconds, the cached copy loads instead. The API is never cached by it.
- **It finds the server elsewhere.** On start, after any failed refresh and
  whenever the tab comes back into view, the page pings `GET /api/ping`. If its
  own address doesn't answer, it pings the addresses in `FALLBACK_HOST` — such as
  the server's Tailscale MagicDNS name — one at a time, in order, and moves to the
  first one where the dashboard answers, with the same path, query and hash.
- **Or it waits.** If none answers, it shows the last services it saw with a
  *No connection* banner and retries every `RECONNECT_INTERVAL` seconds (and when
  the network or the tab comes back). Once the server answers, the tiles refresh
  in place — no reload needed.

`FALLBACK_HOST` is a list of full URLs — protocol, host and optional port,
separated by commas or spaces. The address the page is on is skipped, so the
list can name every address the server has; then it works both ways, back to
the LAN address too when Tailscale is off at home:

```yaml
    environment:
      FALLBACK_HOST: >-
        https://dasha.home.lan,
        https://homeserver.tail1234.ts.net,
        http://100.101.102.103:1337
```

Things worth knowing:

- **Offline caching needs HTTPS.** Browsers only run service workers on `https://`
  pages (and `localhost`). Over plain HTTP the dashboard still switches to the
  fallback while it is open — leave home with the tab open and it follows you
  onto Tailscale — but it can't open at all while the server is down. A reverse
  proxy with a certificate on the LAN side and
  [`tailscale serve`](https://tailscale.com/kb/1312/serve) on the tailnet side
  (`tailscale serve --bg 1337` → `https://homeserver.tail1234.ts.net`) cover both.
- **An HTTPS page can't probe an HTTP address** — the browser blocks it as mixed
  content — so an HTTPS dashboard skips `http://` entries; list HTTPS ones.
- **Each address costs up to `CONNECT_TIMEOUT` when it doesn't answer**, so put
  the likeliest first.
- **Each address caches on its own.** The cache belongs to the address the
  dashboard was opened on, so open each one online once.
- **No redirect loops.** The page never switches to the address it is on, nor
  back to the one it just came from until its own address has answered at least
  once, and only switches after the target has answered as Dasha. The switch
  replaces the history entry, so Back doesn't bounce you around.
- The last services and config live in the browser's `localStorage`
  (`dasha.services.v1`, `dasha.config.v1`), like the layout.

## Configuration

| Variable         | Default     | Description                                       |
| ---------------- | ----------- | ------------------------------------------------- |
| `APP_HOST`       | `localhost` | Fallback host for the URLs in the API payload, and the default for `CHECK_HOST`. Tile links ignore it — they use the host from your browser's address bar. |
| `HEALTH_CHECKS`  | `off`       | Enable availability probing of services (`on`/`off`). Off by default — without it the dashboard never contacts the other containers, it only links to them. |
| `CHECK_HOST`     | `APP_HOST`  | Host the availability checker probes. In a container set this to `host.docker.internal` (or the host IP). Only used when `HEALTH_CHECKS=on`. |
| `CHECK_INTERVAL` | `30`        | Availability-check interval, in seconds. Only used when `HEALTH_CHECKS=on`. |
| `PORT`           | `1337`      | Port the dashboard listens on.                    |
| `COMPOSE_DIR`    | `/compose`  | Root scanned for compose files (down to `SCAN_DEPTH` levels). May be a directory or a single compose file. |
| `ICONS_DIR`      | `/icons`    | Local icon cache (mount as volume/tmpfs).         |
| `HIDE_SERVICES`  | `dasha`     | Comma-separated names hidden from the dashboard (matched case-insensitively against service key, container name and image base name). Default hides the dashboard's own service. Per-service, use `x-dasha-hide` instead. |
| `SCAN_DEPTH`     | `1`         | Directory levels below `COMPOSE_DIR` to scan and watch. The default `1` fits `COMPOSE_DIR/<project>/compose.yaml` and keeps discovery off deep data dirs; raise it for projects nested further, `0` = only files directly in the root. |
| `IGNORE_DIRS`    | `node_modules,.git,.svn,.hg,volumes` | Directory names never scanned or watched. Bind-mount data (e.g. `volumes/`) holds thousands of files that would exhaust the inotify watch limit (`ENOSPC`); hidden dirs (any starting with `.`) are always ignored on top of this. |
| `FALLBACK_HOST`  | —           | Other addresses of this server, as full URLs (`https://homeserver.tail1234.ts.net`, `http://100.101.102.103:1337`) separated by commas or spaces. When the address the browser is on stops answering, it tries them in order and moves to the first where the dashboard answers. Entries without a protocol, or with a path, are ignored (logged at startup). See [Offline access](#offline-access--tailscale-fallback). |
| `CONNECT_TIMEOUT` | `3000`     | How long the browser waits for the server (or each fallback) to answer a reachability ping, in ms. |
| `RECONNECT_INTERVAL` | `15`    | While neither address answers, how often the browser retries, in seconds. |
| `HEALTH_TIMEOUT` | `5000`      | Availability-check request timeout (ms).          |
| `ICON_TIMEOUT`   | `3000`      | Iconify lookup timeout (ms).                      |
| `ICON_CONCURRENCY` | `6`       | Parallel icon lookups per rebuild.                |
| `LOG_LEVEL`      | `info`      | `debug` \| `info` \| `warn` \| `error`.           |

## Troubleshooting

**Services are up but show as Offline.** The availability checks run *inside* the
container, where `localhost` is the container itself — not the host where the
service ports are published. Set `CHECK_HOST` to a host address the container can
reach (`host.docker.internal` on Docker Desktop, or the host's LAN IP) and add
`extra_hosts: ["host.docker.internal:host-gateway"]` on Linux. The card links
still use `APP_HOST`, so your browser links stay correct. (Note: non-HTTP
services such as databases won't answer an HTTP probe and will still read as
Offline/Timeout.)

## REST API

| Method | Endpoint             | Description                              |
| ------ | -------------------- | ---------------------------------------- |
| `GET`  | `/api/services`      | All discovered services + their status.  |
| `GET`  | `/api/compose/{id}`  | Raw content of a discovered compose file.|
| `POST` | `/api/reload`        | Force a rescan / rebuild.                 |
| `GET`  | `/api/config`        | Public runtime config.                    |
| `GET`  | `/api/ping`          | Reachability probe (`{"app":"dasha"}`), open to any origin (CORS). |
| `GET`  | `/healthz`           | Health endpoint (used by `HEALTHCHECK`). |

## Development

Run the backend and the Vite dev server (with API proxy) separately:

```bash
npm install
COMPOSE_DIR=./examples ICONS_DIR=./.icons node server/src/index.js   # API on :1337

cd web && npm install && npm run dev                                 # UI on :5173
```

### Releasing

Pushing a `v*` tag builds the multi-arch image and publishes it to Docker Hub as
the version tags (`1.2.3`, `1.2`) plus `latest`:

```bash
git tag v1.2.3 && git push origin v1.2.3
```

Any other build is started by hand from **Actions → CI → Run workflow**; run
from `main` to publish `edge`. Both need the repo variable `DOCKERHUB_USERNAME`
and the secret `DOCKERHUB_TOKEN` — without them the publish job is skipped and
only the build checks run.

## License

MIT

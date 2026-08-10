# TODO

- [x] **Scan for TODO comments** — parse the compose files for `TODO` / `FIXME`
      comments and surface them via a TODO widget tile (opens a grouped list).
  - [x] Support multi-line TODO comments (consecutive comment lines) as a single
        TODO entry.
- [x] **Publish to Docker Hub** — set up a multi-arch (amd64 + arm64) build and
      push `dasha:latest` + version tags, ideally automated via CI on git tags.
  - [x] Write the Docker Hub repository description / overview (it is not synced
        automatically from the README). See `DOCKERHUB.md`.
- [x] **Set up GitHub Actions** — CI workflow (`.github/workflows/ci.yml`) builds
      the frontend + syntax-checks the server on every push/PR, and on pushes to
      `main` / `v*` tags builds the multi-arch image and pushes it to Docker Hub
      (plus syncs the Docker Hub description on tags). Needs repo variable
      `DOCKERHUB_USERNAME` and secret `DOCKERHUB_TOKEN`.
- [ ] **Widget system** — pluggable per-card widgets that show extra live info
      (e.g. container stats, uptime, version, custom API values), configurable via
      `x-dasha-*` extensions and rendered on the service card.
  - [ ] Built-in free-memory and free-disk (HDD) widgets.
  - [ ] Standard widget types that pull their data from HTTP endpoints.
  - [ ] Configure widgets via an environment variable.
  - [ ] For a container-scoped widget, configure it via `x-dasha-widget`.
- [ ] **Compose variable interpolation** — resolve `${VAR}` / `.env` substitutions
      when parsing compose files, in particular when a port is defined via a
      variable (e.g. `ports: - "${APP_PORT}:80"`), so URLs are built correctly.
- [x] **Apple Watch-like mosaic layout** — a unified honeycomb mosaic on a black
      background where app icons and widgets share the same round shape (minimalist,
      monochrome masked icons, status dots, hover labels).
  - [ ] Free drag-to-reorder with a persisted layout.
- [x] **Hide services without a URL** — don't render cards for services that have
      no resolvable URL (still returned by the API; just not shown).

## Bugs

- [x] Services are up and running but shown as **Offline** on the dashboard.
      Fixed: health checks now probe `CHECK_HOST` (e.g. `host.docker.internal`)
      separately from the `APP_HOST` used for card links, so probes reach the
      host where ports are published instead of the container's own loopback.
- [ ] `/api/services` and `/api/compose/:id` leak secrets — the full
      `environment` map and raw file contents are exposed to anyone who can
      reach the dashboard. Filter / mask sensitive values.
- [ ] `/api/reload` can hang forever — Express 4 doesn't catch rejected
      promises in async handlers. Add a catch so the request always resolves.
- [ ] Stale health status — a service that loses its `checkUrl` keeps showing
      `online` forever because `replaceAll` copies the old status across. Reset
      to `no-url` when there's nothing to probe.
- [ ] Health-check passes can overlap — if one pass runs longer than
      `checkInterval` the next one starts anyway, doubling probe load. Add a
      re-entrancy guard.
- [ ] HTTP 404/500 are reported as `online` — the checker only distinguishes
      thrown errors vs. timeouts, ignoring the status code.
- [ ] Icon resolution is sequential and unbounded in time — 2 network calls per
      service × up to `healthTimeout` each; a down Iconify API grinds every
      rebuild. Add concurrency limits / timeouts / fallback short-circuit.
- [ ] Long-syntax port ranges (`published: "8000-8001"`) yield `NaN` in the
      parser; short syntax handles ranges but long doesn't.
- [ ] Web: dead error path in `ComposeModal` — `getJson` throws before an error
      body is set, so `file.error` is never truthy and errors render as file
      content with the misleading path `"error"`.
- [ ] Web: no timeout/abort on `fetch` — a hanging `/api/services` leaves the
      UI on "Loading…" forever and out-of-order responses can clobber newer
      data.
- [ ] Web: modal lacks `role="dialog"`, `aria-modal`, accessible name, focus
      trap, and focus restore on close.
- [ ] `parseComposeFile`/`todos` could false-positive on `#` inside a value
      without leading whitespace (a `#` in the middle of a line isn't a YAML
      comment start).

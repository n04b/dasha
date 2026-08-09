# TODO

- [x] **Scan services for TODO comments** — parse source files referenced by a
      service (or its build context) for `TODO` / `FIXME` comments and surface the
      count on the service card.
  - [x] Support multi-line TODO comments (block comments and consecutive
        single-line comments) as a single TODO entry.
- [x] **Publish to Docker Hub** — set up a multi-arch (amd64 + arm64) build and
      push `dasha:latest` + version tags, ideally automated via CI on git tags.
  - [ ] Write the Docker Hub repository description / overview (it is not synced
        automatically from the README).
- [ ] **Set up GitHub Actions** — CI workflow to lint/build on every push and,
      on git tags, build the multi-arch image and push it to Docker Hub.
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
- [ ] **Apple Watch-like mosaic layout** — a unified mosaic for both app icons
      and widgets: every item shares the same round shape, and items can be freely
      arranged in any order (drag-to-reorder, persisted layout).
- [ ] **Hide services without a URL** — don't render cards for services that have
      no resolvable URL.

## Bugs

- [ ] Services are up and running but shown as **Offline** on the dashboard.

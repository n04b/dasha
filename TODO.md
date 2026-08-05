# TODO

- [ ] **Scan services for TODO comments** — parse source files referenced by a
      service (or its build context) for `TODO` / `FIXME` comments and surface the
      count on the service card.
  - [ ] Support multi-line TODO comments (block comments and consecutive
        single-line comments) as a single TODO entry.
- [ ] **Publish to Docker Hub** — set up a multi-arch (amd64 + arm64) build and
      push `dasha:latest` + version tags, ideally automated via CI on git tags.
- [ ] **Set up GitHub Actions** — CI workflow to lint/build on every push and,
      on git tags, build the multi-arch image and push it to Docker Hub.

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [2.6.0]

### Added
- `autoGa: true` in `sanshain.yaml` makes a provide GA whenever the build declares trunk or a tag; `SANSHAIN_GA=false` (the Action's `ga: 'false'`) keeps a build a snapshot. The Action's `ga` input now defaults to empty so `autoGa` can decide.
- `annotations` in `sanshain.yaml` travel with provide (also `--dry-run`), require, bundle and catalog push, their `{{NAME}}` placeholders filled from `--set NAME=value` or `SANSHAIN_SET_NAME` (needs Sanshain Service 2.13.0 or later).

### Changed
- A missing or broken `sanshain.yaml` (unreadable, invalid YAML, 1.x fields, failed validation) under `--best-effort` or `SANSHAIN_BEST_EFFORT` prints the error with the command's prefix (e.g. `Error providing spec: Configuration file not found: <path>`), then `Continuing (best effort)`, and exits 0 without a call, now without the `Warning loading config:` line and the skip notice that followed it. Such a file's own `bestEffort` and `strict` do not count, and `SANSHAIN_STRICT=true` makes it fail also with best effort. Under best effort a file that does not validate no longer fails over unknown fields because of its own `strict: true`. Without best effort a missing file fails, naming it, as before. The `--best-effort` help says so.

### Fixed
- The Action's inputs table in `docs/github-actions.md` now lists `trunk`, `tag`, `tickets` and `note`.
- The examples in `docs/github-actions.md` name the Action `paxel/sanshain-js@summer`, a ref that exists; the ones before did not resolve.
- A require with `apiType: grpc` goes to `/require/grpc` and is saved as `.proto`, and its bundle sends `api_type: proto`; it went to `/require` and was saved as `.yaml`.
- Best effort works the same in provide, require and catalog: a failed provide no longer stops the next `provides` entry.
- A `403` on provide or retire names the releaser role only when the service refused for want of it; any other `403`, such as a read-only token's, shows the service's message alone.
- The require ETag cache in `node_modules/.cache/sanshain/state.json` is kept per output directory: the same endpoint required into two directories is written to both instead of the second getting a `304` and staying empty, and a deleted output file is fetched again instead of being skipped.
- An empty Action input (`ga`, `trunk`, `tag`, `tickets`, `note`) keeps the `SANSHAIN_*` variable the job or workflow set instead of overriding it with an empty value; `trunk` now defaults to empty instead of `'false'`.
- An unknown `requires[].apiType` fails as a configuration error when `sanshain.yaml` is loaded, before any call; it was sent to `/require` as OpenAPI.
- An unknown provide `apiType` fails as a configuration error when `sanshain.yaml` is loaded, before any call; the provide reported success without uploading anything.
- `require --dry-run` writes nothing: neither the output directory nor the file (it wrote the downloaded file).
- `--version` reads the version from `package.json` instead of a copy in the CLI that a version bump could leave behind.
- The build, release and security workflows pin every action to a full commit SHA; they referenced tags.

### Security
- The Action passes its `command` input to the shell as data, so an expression placed in it can no longer inject shell code.

---

Historical changes have been moved to [OLDER_CHANGES.md](OLDER_CHANGES.md).

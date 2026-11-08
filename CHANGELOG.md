# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [2.6.0]

### Added
- `autoGa: true` in `sanshain.yaml` makes a provide GA whenever the build declares trunk or a tag; `SANSHAIN_GA=false` (the Action's `ga: 'false'`) keeps a build a snapshot. The Action's `ga` input now defaults to empty so `autoGa` can decide.
- `annotations` in `sanshain.yaml` travel with provide (also `--dry-run`), require, bundle and catalog push, their `{{NAME}}` placeholders filled from `--set NAME=value` or `SANSHAIN_SET_NAME` (needs Sanshain Service 2.13.0 or later).

### Fixed
- The Action's inputs table in `docs/github-actions.md` now lists `trunk`, `tag`, `tickets` and `note`.
- The examples in `docs/github-actions.md` name the Action `paxel/sanshain-js@summer`, a ref that exists; the ones before did not resolve.
- A require with `apiType: grpc` goes to `/require/grpc` and is saved as `.proto`, and its bundle sends `api_type: proto`; it went to `/require` and was saved as `.yaml`.
- Best effort softens failed calls only, the same in provide, require and catalog: a `sanshain.yaml` that cannot be loaded (missing, unparsable, invalid or with 1.x fields) now fails also with best effort, and a failed provide no longer stops the next `provides` entry.
- A `403` on provide or retire names the releaser role only when the service refused for want of it; any other `403`, such as a read-only token's, shows the service's message alone.
- The require ETag cache in `node_modules/.cache/sanshain/state.json` is kept per output directory: the same endpoint required into two directories is written to both instead of the second getting a `304` and staying empty, and a deleted output file is fetched again instead of being skipped.
- An empty Action input (`ga`, `trunk`, `tag`, `tickets`, `note`) keeps the `SANSHAIN_*` variable the job or workflow set instead of overriding it with an empty value; `trunk` now defaults to empty instead of `'false'`.
- An unknown `requires[].apiType` fails as a configuration error when `sanshain.yaml` is loaded, before any call; it was sent to `/require` as OpenAPI.
- An unknown provide `apiType` fails as a configuration error when `sanshain.yaml` is loaded, also with best effort; the provide reported success without uploading anything.

---

Historical changes have been moved to [OLDER_CHANGES.md](OLDER_CHANGES.md).

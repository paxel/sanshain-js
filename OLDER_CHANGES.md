# Older Changes

This file contains historical changelog entries for sanshain-js.
For recent changes, see [CHANGELOG.md](CHANGELOG.md).

## [2.4.0] - 2026-10-16

### Added
- `sanshain catalog` pushes the Backstage `catalog-info.yaml` named by the new `catalogInfo` field in `sanshain.yaml`, so Sanshain records the Peripheral Resources the system depends on; the GitHub Action accepts `command: catalog`. A file Sanshain cannot read records nothing and is printed as a warning, exiting 0 (failing under strict).
- `catalog` requires Sanshain Service 2.4.0; all other commands work with any 2.x service.
- `format: openapi` on a `requires` entry with `apiType: asyncapi` downloads the pinned channels as an OpenAPI document under the usual file name; needs Sanshain Service 2.4.0.
- Unknown fields in `sanshain.yaml` (typos such as `catalogInf`) are reported once on stderr and ignored; with `strict` the command fails, even under best-effort.

### Changed
- Relative paths in `sanshain.yaml` (`file`, `openApiFile`, `asyncApiFile`, `protoFile`, `outputDirectory`, `catalogInfo`) resolve against the directory containing `sanshain.yaml` instead of the working directory.
- With `strict`, any field no Sanshain client knows now fails the command; a `serviceName` inside a provide entry, silently ignored before, is reported as unknown.
- `provide` uploads every spec file on every run; it no longer skips files whose hash matches the last provide.
- `--force`, `force` and `SANSHAIN_FORCE` are still accepted but have no effect.
- Declaring both trunk and a tag (`--trunk`/`SANSHAIN_TRUNK` and `--tag`/`SANSHAIN_TAG`) no longer fails: it prints `trunk and tag are mutually exclusive - this build is recorded in neither` and sends neither; strict mode fails instead, before any request. In the library, `resolveStream` returns no stream for both instead of throwing; the new `resolveStreamWithWarning` also returns the warning.
- Every warning Sanshain sends with a response (the `Sanshain-Warning` header, e.g. for an unknown sanshain-branch) is printed as `⚠ <text>`, one line per warning; under strict mode it fails the command with `strict: Sanshain warned: <text>`, even with best-effort. The library collects them for `SanshainClient.takeWarnings()`.
- The `SANSHAIN_GA`, `SANSHAIN_TRUNK`, `SANSHAIN_BEST_EFFORT`, `SANSHAIN_STRICT`, `SANSHAIN_FORCE` and `SANSHAIN_COMPRESSION` switches are on for `true` or `1` in any case and with surrounding spaces; most previously accepted only an exact `true`.

### Fixed
- A `provide --dry-run` no longer makes the following real provide skip the upload as "Spec unchanged".
- A `require --dry-run` no longer stores the ETag, so it cannot turn the following real require into a `304` skip.

### Security
- Updated `axios` to 1.20.0 (GHSA-3w6x-2g7m-8v23, GHSA-q8qp-cvcw-x6jj, GHSA-p92q-9vqr-4j8v and further axios advisories up to 1.19.0).

## [2.3.0] - 2026-08-14

### Added
- `--ga` (or `SANSHAIN_GA=true`, or the Action's `ga` input) publishes an immutable GA version; every other provide is a snapshot.
- `--trunk` / `SANSHAIN_TRUNK` and `--tag <branch>` / `SANSHAIN_TAG` (Action inputs `trunk` and `tag`) declare whether a provide or require belongs to the trunk graph or to a sanshain-branch; declaring both fails before any request.
- A `provides` entry marked `retired: true` (with its `apiType`) retires that API family on the next `provide`.
- After an AsyncAPI provide the CLI prints the subscriptions the server harvested; drift or a missing publisher is shown as a warning.
- `--force`, `force` in `sanshain.yaml` or `SANSHAIN_FORCE=true` re-provides spec files the local cache considers unchanged.
- `--best-effort` flag; best-effort now also covers a missing or invalid `sanshain.yaml` (warning, exit 0).
- Clear failure messages: a `409` shows the server's reason and the version to publish as instead, `404` names an unknown producer or version, `410` an absent endpoint, `403` the missing `releaser` role.
- After a failed call the CLI checks `GET /version` once and asks to upgrade a pre-2.0 server.

### Changed
- Speaks Sanshain Service 2.x only: the provided version is read from the spec file (`info.version`, or the `// sanshain-version:` comment for proto), and every `requires` entry must pin an exact `version` (`MAJOR[.MINOR[.PATCH]]`, optionally `v`-prefixed).
- The provide summary names the published version and its stability.
- Spec files are uploaded with LF line endings, so Windows checkouts no longer produce a different content hash.
- The package is named `sanshain` (was `sanshainjs`) and released to npm; the GitHub Action runs `npx sanshain`.
- Licensed under Apache-2.0 instead of AGPL-3.0.

### Removed
- Git branch detection, the `--branch` option and `SANSHAIN_BRANCH`.
- `branch` on provide and require entries, `timeout` (top level and per require entry), `baseVersion` and `SANSHAIN_TIMEOUT`; these fields, and `releaseBranches` or a provide `stability`, are rejected by name with a migration hint.

### Fixed
- `sanshain --version` reports the real version instead of `2.0.0`.
- A missing or invalid `sanshain.yaml` fails with its error message instead of an additional unhandled-exception trace.

## [2.2.0] - 2026-04-25

### Added
- `provide` skips spec files whose SHA-256 hash matches the last provide (cache in `node_modules/.cache/sanshain/state.json`).
- `provide` prints the version the server stored and how many endpoints were added, updated and deleted.
- `require` sends the last `ETag` as `If-None-Match` and skips writing the file on `304 Not Modified`.
- `baseVersion` on a provide entry (defaulting to the version last provided from this checkout) is sent with the provide, so the server rejects concurrent modifications.
- `strict` in `sanshain.yaml` or `SANSHAIN_STRICT=true` turns missing configuration into a failure.

### Changed
- Without `serviceName` (previously a configuration error) or without a provide section (previously exit 1), the commands warn and skip; a missing `requires` section is a warning too.

## [2.1.0] - 2026-04-23

### Added
- Branch detection for GitLab merge request pipelines, Jenkins `BRANCH_NAME`, Bitbucket Pipelines, Azure DevOps, Travis CI and CircleCI.

### Changed
- Failed requests show the HTTP status and the server's response body.
- On GitLab the branch is taken from `CI_COMMIT_BRANCH` instead of `CI_COMMIT_REF_NAME`.

### Fixed
- GitHub Actions pull-request builds use the source branch instead of `<number>/merge`.
- A Jenkins `GIT_BRANCH` of `origin/<branch>` no longer keeps the `origin/` prefix.

## [1.0.0] - 2026-04-22

### Added
- AsyncAPI and proto/gRPC support: a `provides` list whose entries take `file` and `apiType` (`openapi`, `asyncapi`, `proto`), or `asyncApiFile` / `protoFile`; `requires` entries take `apiType`, and proto results are saved as `.proto`.
- `bestEffort` in `sanshain.yaml` or `SANSHAIN_BEST_EFFORT=true` reports failures and exits 0.
- Environment overrides `SANSHAIN_URL`, `SANSHAIN_SERVICE_NAME`, `SANSHAIN_CLIENT_NAME`, `SANSHAIN_TIMEOUT` and `SANSHAIN_COMPRESSION`.

### Changed
- The top-level `serviceName` names the project for both provide and require; `clientName` is still accepted as an alias, and a provide entry no longer needs its own `serviceName`.

## [0.1.0] - 2026-04-21

### Added
- `sanshain provide` uploads the OpenAPI spec named in `sanshain.yaml`.
- `sanshain require` downloads the listed endpoints of each required service into its `outputDirectory`, as one deduplicated bundle when an entry lists several; both commands take `--dry-run`.
- `sanshain.yaml` with `sanshainUrl`, `clientName`, `compression` (gzip), `timeout`, `provide` and `requires`, plus per-entry `branch` and `timeout`.
- Options `--config`, `--url`, `--token` (or `SANSHAIN_TOKEN`), `--branch` and `--insecure`.
- Git branch detection from `SANSHAIN_BRANCH`, CI variables or the local checkout, falling back to `main`.
- GitHub Action with `command`, `token` and `working-directory` inputs.

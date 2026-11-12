# Older Changes

This file contains historical changelog entries for sanshain-js.
For recent changes, see [CHANGELOG.md](CHANGELOG.md).

## [2.6.0] - 2026-11-11

### Added
- `autoGa: true` in `sanshain.yaml` makes a provide GA whenever the build declares trunk or a tag; `SANSHAIN_GA=false` (the Action's `ga: 'false'`) keeps a build a snapshot. The Action's `ga` input now defaults to empty so `autoGa` can decide.
- `annotations` in `sanshain.yaml` travel with provide (also `--dry-run`), require, bundle and catalog push, their `{{NAME}}` placeholders filled from `--set NAME=value` or `SANSHAIN_SET_NAME` (needs Sanshain Service 2.13.0 or later).

### Changed
- The GitHub Action runs one pinned release of the package (`npx --yes --ignore-scripts sanshain@2.5.1`, raised after each release, without install scripts) instead of whatever version npm had newest; a project's own install is used only when it is that version.
- A missing or broken `sanshain.yaml` (unreadable, invalid YAML, 1.x fields, failed validation) under `--best-effort` or `SANSHAIN_BEST_EFFORT` prints the error with the command's prefix (e.g. `Error providing spec: Configuration file not found: <path>`), then `Continuing (best effort)`, and exits 0 without a call, now without the `Warning loading config:` line and the skip notice that followed it. Such a file's own `bestEffort` and `strict` do not count, and `SANSHAIN_STRICT=true` makes it fail also with best effort. Under best effort a file that does not validate no longer fails over unknown fields because of its own `strict: true`. Without best effort a missing file fails, naming it, as before. The `--best-effort` help says so.

### Fixed
- Installing the package, or running it through `npx` and the GitHub Action, no longer downloads TypeScript: it was declared as a runtime dependency although only the build needs it.
- The Action's inputs table in `docs/github-actions.md` now lists `trunk`, `tag`, `tickets` and `note`.
- The examples in `docs/github-actions.md` name the Action `paxel/sanshain-js@summer`, a ref that exists; the ones before did not resolve.
- A require with `apiType: grpc` goes to `/require/grpc` and is saved as `.proto`, and its bundle sends `api_type: proto`; it went to `/require` and was saved as `.yaml`.
- Best effort works the same in provide, require and catalog: a failed provide no longer stops the next `provides` entry.
- A `403` on provide or retire names the releaser role only when the service refused for want of it; any other `403`, such as a read-only token's, shows the service's message alone.
- The require ETag cache in `node_modules/.cache/sanshain/state.json` is kept per output directory: the same endpoint required into two directories is written to both instead of the second getting a `304` and staying empty, and a deleted output file is fetched again instead of being skipped.
- An empty Action input (`ga`, `trunk`, `tag`, `tickets`, `note`) keeps the `SANSHAIN_*` variable the job or workflow set instead of overriding it with an empty value; `trunk` now defaults to empty instead of `'false'`.
- An unknown `requires[].apiType` fails as a configuration error when `sanshain.yaml` is loaded, before any call; it was sent to `/require` as OpenAPI.
- An unknown provide `apiType` fails as a configuration error when `sanshain.yaml` is loaded, before any call; the provide reported success without uploading anything.
- A `sanshain.yaml` that holds no mapping of settings (`~`, a plain string, a list) fails naming the file; it failed with a JavaScript type error such as `Cannot read properties of null`.
- `require --dry-run` writes nothing: neither the output directory nor the file (it wrote the downloaded file).
- `--version` reads the version from `package.json` instead of a copy in the CLI that a version bump could leave behind.
- The build, release and security workflows pin every action to a full commit SHA; they referenced tags.

### Security
- Text the service sends (error messages, `Sanshain-Warning` values, the provide, retire and catalog answers, its version) is printed with every control character but the tab shown as `?`, so it can no longer forge log lines or send terminal escape sequences.
- A user and password in the Sanshain URL are no longer printed: `provide`, `require` and `catalog` and the pre-2.0 server hint show the URL without them. The token was never printed.
- The Action passes its `command` input to the shell as data, so an expression placed in it can no longer inject shell code.
- follow-redirects 1.16.3 (through axios): custom credential headers and cross-realm `sensitiveHeaders` arrays no longer follow a redirect to another origin (GHSA-mrwp-f3q8-3g9p).

## [2.5.1] - 2026-10-25

### Changed
- Dependencies updated, among them js-yaml 5; merge keys (`<<: *anchor`) in `sanshain.yaml` keep working. An empty `sanshain.yaml` now fails with a YAML error naming the problem.

### Security
- follow-redirects 1.16.1 (through axios): credential headers are no longer kept on a redirect to another origin (GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c).

## [2.5.0] - 2026-10-21

### Added
- `provide` sends the origin of the build: `--build-url` and `--change-url` default to the runner's own variables on GitHub Actions, GitLab CI and Jenkins (overridden by `SANSHAIN_BUILD_URL` / `SANSHAIN_CHANGE_URL`), plus `--tickets` / `SANSHAIN_TICKETS` and `--note` / `SANSHAIN_NOTE`; the GitHub Action takes `tickets` and `note` inputs. Sanshain Service 2.9.0 and later stores it with the version and shows it as "why".

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

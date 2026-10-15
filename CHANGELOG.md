# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [2.4.0] - Unreleased

### Added
- `sanshain catalog` pushes the Backstage `catalog-info.yaml` named by the new `catalogInfo` field in `sanshain.yaml`, so Sanshain records the Peripheral Resources the system depends on; the GitHub Action accepts `command: catalog`.
- `catalog` requires Sanshain Service 2.4.0; all other commands work with any 2.x service.
- `format: openapi` on a `requires` entry with `apiType: asyncapi` downloads the pinned channels as an OpenAPI document under the usual file name; needs Sanshain Service 2.4.0.
- Unknown fields in `sanshain.yaml` (typos such as `catalogInf`) are reported once on stderr and ignored; with `strict` the command fails, even under best-effort.

### Changed
- Relative paths in `sanshain.yaml` (`file`, `openApiFile`, `asyncApiFile`, `protoFile`, `outputDirectory`, `catalogInfo`) resolve against the directory containing `sanshain.yaml` instead of the working directory.
- With `strict`, any field no Sanshain client knows now fails the command; a `serviceName` inside a provide entry, silently ignored before, is reported as unknown.
- `provide` uploads every spec file on every run; it no longer skips files whose hash matches the last provide.
- `--force`, `force` and `SANSHAIN_FORCE` are still accepted but have no effect.
- The `SANSHAIN_GA`, `SANSHAIN_TRUNK`, `SANSHAIN_BEST_EFFORT`, `SANSHAIN_STRICT`, `SANSHAIN_FORCE` and `SANSHAIN_COMPRESSION` switches are on for `true` or `1` in any case and with surrounding spaces; most previously accepted only an exact `true`.

### Fixed
- A `provide --dry-run` no longer makes the following real provide skip the upload as "Spec unchanged".
- A `require --dry-run` no longer stores the ETag, so it cannot turn the following real require into a `304` skip.

### Security
- Updated `axios` to 1.20.0 (GHSA-3w6x-2g7m-8v23, GHSA-q8qp-cvcw-x6jj, GHSA-p92q-9vqr-4j8v and further axios advisories up to 1.19.0).

---

Historical changes have been moved to [OLDER_CHANGES.md](OLDER_CHANGES.md).

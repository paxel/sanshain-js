# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [2.4.0] - Unreleased

### Added
- `sanshain catalog` pushes the Backstage `catalog-info.yaml` named by the new `catalogInfo` field in `sanshain.yaml`, so Sanshain records the Peripheral Resources the system depends on; the GitHub Action accepts `command: catalog`.
- `catalog` requires Sanshain Service 2.4.0; all other commands work with any 2.x service.
- Unknown fields in `sanshain.yaml` (typos such as `catalogInf`) are reported once on stderr and ignored; with `strict` the command fails, even under best-effort.

### Changed
- Relative paths in `sanshain.yaml` (`file`, `openApiFile`, `asyncApiFile`, `protoFile`, `outputDirectory`, `catalogInfo`) resolve against the directory containing `sanshain.yaml` instead of the working directory.
- The `SANSHAIN_GA`, `SANSHAIN_TRUNK`, `SANSHAIN_BEST_EFFORT`, `SANSHAIN_STRICT`, `SANSHAIN_FORCE` and `SANSHAIN_COMPRESSION` switches are on for `true` or `1` in any case and with surrounding spaces; most previously accepted only an exact `true`.

---

Historical changes have been moved to [OLDER_CHANGES.md](OLDER_CHANGES.md).

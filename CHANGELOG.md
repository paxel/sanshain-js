# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [2.6.0]

### Added
- `autoGa: true` in `sanshain.yaml` makes a provide GA whenever the build declares trunk or a tag; `SANSHAIN_GA=false` (the Action's `ga: 'false'`) keeps a build a snapshot. The Action's `ga` input now defaults to empty so `autoGa` can decide.
- `annotations` in `sanshain.yaml` travel with provide (also `--dry-run`), require, bundle and catalog push, their `{{NAME}}` placeholders filled from `--set NAME=value` or `SANSHAIN_SET_NAME` (needs Sanshain Service 2.13.0 or later).

### Fixed
- The Action's inputs table in `docs/github-actions.md` now lists `trunk`, `tag`, `tickets` and `note`.

---

Historical changes have been moved to [OLDER_CHANGES.md](OLDER_CHANGES.md).

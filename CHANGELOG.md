# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [2.5.1]

### Changed
- Dependencies updated, among them js-yaml 5; merge keys (`<<: *anchor`) in `sanshain.yaml` keep working. An empty `sanshain.yaml` now fails with a YAML error naming the problem.

### Security
- follow-redirects 1.16.1 (through axios): credential headers are no longer kept on a redirect to another origin (GHSA-q3jh-wrc6-jgq8, GHSA-8r9p-f939-6h3c).

---

Historical changes have been moved to [OLDER_CHANGES.md](OLDER_CHANGES.md).

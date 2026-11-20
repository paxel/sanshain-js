# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).


## [2.7.1]

### Added
- The release on GitHub carries the npm tarball, `sanshain-2.7.1.tgz`, the file npm holds, with a CycloneDX SBOM of the source, a build provenance attestation and its Sigstore bundle; `gh attestation verify <file> -R paxel/sanshain-js` checks a download ([sanjs-1005](https://github.com/paxel/sanshain-js/issues/17)). Apart from the fixes below, the command, the library and the Action behave as in 2.7.0.

### Changed
- The GitHub Action runs `sanshain@2.7.0` (it ran 2.6.0), so a job that uses `paxel/sanshain-js@summer` needs Node.js 22.12 or newer.

### Fixed
- An entry of `provides`, `requires` or `endpoints` in `sanshain.yaml` that is not a mapping, such as an empty `-`, and a mapping where a name, a version or an `apiType` belongs, get the message of the check they fail, for example `Missing serviceName in requires[0]`. They ended in `Cannot read properties of null` or `Cannot convert object to primitive value` ([sanjs-1000](https://github.com/paxel/sanshain-js/issues/12), [sanjs-1003](https://github.com/paxel/sanshain-js/issues/15)).
- A require state file whose content is not a state, such as one with `"requires": 7`, counts as empty. A require used to write its file and then fail when it recorded the ETag ([sanjs-1003](https://github.com/paxel/sanshain-js/issues/15)).

---

Historical changes have been moved to [OLDER_CHANGES.md](OLDER_CHANGES.md).

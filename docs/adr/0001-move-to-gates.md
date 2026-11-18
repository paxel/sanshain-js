# sanshain-js moves to the gates standard

Decided on 2026-11-18.

sanshain-js had its own gates: a build workflow that built and tested on Node 22, 24 and 26,
`npm audit` for the runtime dependencies, a SonarQube Cloud workflow, CodeQL, Scorecard, and
a release that published to npm. No linter and no formatter ran. Every paxel repository had
done so, each differently. [paxel/gates](https://github.com/paxel/gates) is the one standard
that replaces those, as shared workflows a repository calls, and its audit found 19 checks
of it missing here ([issue 11](https://github.com/paxel/sanshain-js/issues/11)).

sanshain-js meets the standard of gates v1.2.0
([sanjs-1000](https://github.com/paxel/sanshain-js/issues/12) to
[sanjs-1007](https://github.com/paxel/sanshain-js/issues/19)). Where the standard decides, it
is followed without a note here: the shared OSV gate, TypeScript gate, SonarQube Cloud job,
CodeQL, Scorecard, fuzz, release gate and provenance workflows, one coverage ratchet, the
lint config, the files and the badge row. What follows is where sanshain-js adds to it, or
had a choice.

**The Node release.** `.nvmrc` names 26, the newest LTS line, which the gate, the fuzz run
and the release build with. `engines` in `package.json` keeps `>=22.12`: that is what a user
is promised, and commander 15 needs it.

**The other Node lines.** The old build workflow tested on every supported line. The shared
TypeScript gate runs on the pinned one. So CI keeps a job of the repository's own that
builds and tests on Node 22.12.0, the floor itself, and on Node 24.

**Lints.** The standard's `eslint.config.mjs` is taken as it is, and the code was changed to
meet it, the tests included. The package is a patch release, so no exported type changed:
the emitted `dist/*.d.ts` is the same as in 2.7.0. A rule is silenced at four kinds of
place, each with its reason at the line. `parseServerJson` returns `any` and `warningsOf`
takes `any`, because both types are exported. `src/cli.ts` reads the version with
`require('../package.json')`, because the file lies outside `src/` and an import would move
the build's output. `bin/sanshain.js`, `jest.config.js` and the fuzz targets are CommonJS
files, where `require` is how a module loads; they also name the globals of Node they use.

**Two compiler configs.** The gate runs `tsc --noEmit` and eslint over everything, so
`tsconfig.json` covers the sources, the tests, `bin/`, the fuzz targets and the Jest config
and emits nothing. `tsconfig.build.json` extends it for `npm run build`, with `src/` alone.
`bin/` and the fuzz targets load the package from `dist/`, which does not exist when the
gate runs; `rootDirs` lays `src` and `dist` over each other, so they are checked against the
sources.

**Format.** prettier checks the code, the JSON and the YAML, with single quotes and 120
columns, which is how the code was written. Markdown is left out: prettier would rewrite the
separator rows of the tables and the aligned comments of the examples, and change nothing
else.

**What the types brought with them.** A list entry of `sanshain.yaml` that is no mapping,
and a mapping in the place of a name, now get the message of the check they fail; they used
to end in a `TypeError` of the runtime. The other changes are in how the code is typed, not
in what it does.

**Dependencies.** `npm audit` is gone from CI and from the weekly run; osv-scanner reads the
whole lockfile, the tools included. The two advisories it had, in glob and minimatch, are
fixed only in their next major releases, which jest, eslint and typescript-eslint do not ask
for yet; `overrides` in `package.json` lifts both, and the tests and the linter run with
them. Twelve packages carry a licence outside the allowlist and are accepted in
`osv-scanner.toml` until 2027-02-18. One is installed with the client: argparse, under
Python's licence, which js-yaml lists for its own command-line tool. The others come with
jest, eslint and the fuzzer: caniuse-lite under CC-BY-4.0 and ten packages under the Blue
Oak Model License.

**Coverage.** One part, `ts`, over every file in `src/`, measured by the gate with
`npm run test:coverage`. The first floor is the measurement on Node 26 minus 0.1.
SonarQube Cloud reads the file the gate measured.

**Fuzz targets.** Four, with the names every Sanshain client uses, as Jazzer.js targets in
`fuzz/`: `config` reads `sanshain.yaml` through `loadConfig`, `annotations` fills the
placeholders of annotation values, `response` reads the body of an answer through
`parseServerJson` and its warning headers through `warningsOf`, `state` reads the require
state file through `SanshainCache`. They are plain CommonJS files that load the built
package, so the fuzz workflow builds it first. The shared workflow passes no seed corpus, so
each target runs its seed inputs once when it loads, and `config` puts one of six beginnings
of a valid file before the fuzzer's bytes, which leads it into the entries of the lists.
Jazzer.js brings its native part prebuilt; it loads without an install script. The first
runs found that a state file whose `requires` is not a mapping made the next write fail;
such a file is now an empty state.

**Accepted findings.** SonarQube Cloud reports four findings that are what the client is
for: it calls the instance the user names and reads and writes the files the user names.
`sonar-project.properties` used to silence them; they are now accepted in
`code-scanning-ignores.toml` until 2027-02-18, beside the three Scorecard findings of a
single maintainer.

**Release.** The workflow first checks that the tag names the version in `package.json`.
The shared release gate checks alerts, findings, vulnerabilities, licences and the changelog
section, and runs no tests; the release runs the tests itself before it packs, because a
version on npm cannot be replaced. The tarball is packed once, into `release/`, since
`dist/` is the compiler's output inside the package.

**What the release attaches.** The npm tarball, `sanshain-<version>.tgz`, with the SBOM of
the source, a build provenance attestation and its Sigstore bundle. That same file is then
published to npm by trusted publishing, with npm's own provenance; a version that is already
on npm is skipped.

**The Action.** `action.yml` runs one released version of the package, named in the file. It
stays on the newest version that is on npm and is raised in a commit after the publish:
raised before, `paxel/sanshain-js@summer` would ask npm for a version that is not there yet.

## Consequences

- A branch gets its CI run through its pull request; pushes run CI only on `summer`.
- SonarQube Cloud analyses pull requests as well as `summer`, and its quality gate now
  fails CI.
- prettier, eslint and `tsc --noEmit` over the tests fail CI; none of them ran before.
- `npm audit` is gone; osv-scanner reads the advisories for every package of the lockfile
  and the licences as well.
- Fuzzing, CodeQL, Scorecard and the weekly Security run come from gates; the weekly run
  also fails on SonarQube Cloud findings and secret alerts.
- The release and the weekly Security run need the secret `GATES_ALERTS_TOKEN`, a
  fine-grained token that can read the repository's alerts
  ([sanjs-1008](https://github.com/paxel/sanshain-js/issues/20)).
- The release's SBOM and Sigstore bundle are named `sanshain-js-<tag>-source.cdx.json` and
  `sanshain-js-<tag>-provenance.sigstore.json`.
- The README badges of SonarQube Cloud's security rating and coverage and of the Node
  version are gone; the fixed row and the npm badge remain.

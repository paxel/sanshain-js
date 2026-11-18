# sanshain-js

The TypeScript client of the [Sanshain Service](https://github.com/paxel/sanshain-service): one
npm package, `sanshain`, that is the command `sanshain`, a library and, through `action.yml`,
a GitHub Action.

| Path            | What it is                                                                     |
|-----------------|--------------------------------------------------------------------------------|
| `src/cli.ts`    | The command: flags, the commands and what they print.                          |
| `src/config.ts` | Reads and validates `sanshain.yaml`; fills the annotation placeholders.        |
| `src/api.ts`    | The calls to the service, the wire payloads and the warnings of an answer.     |
| `src/cache.ts`  | The require state file with the ETag of every require.                         |
| `src/utils.ts`  | Helpers the other modules share.                                               |
| `src/index.ts`  | What the library exports: `api`, `cache`, `config` and `cli`.                  |
| `bin/`          | The script npm installs as `sanshain`; it loads the built package from `dist`. |
| `action.yml`    | The GitHub Action: one step that runs a released `sanshain` through `npx`.     |
| `tests/`        | The Jest tests; `tests/http.ts` holds what they share.                         |
| `fuzz/`         | The Jazzer.js fuzz targets.                                                    |

What users rely on is the command, its flags and variables, what it prints, its exit codes,
`sanshain.yaml`, the state file, the Action's inputs and everything `src/index.ts` exports:
the emitted `dist/*.d.ts` is public API. The user documentation lives on the Sanshain site,
in the repository of the service.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `paxel/sanshain-js`, managed with the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

Default canonical vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Ticket IDs

Prefix `sanjs`, as in `sanjs-1003`. See `docs/agents/ticket-ids.md`.

## Quality gates

The standard sanshain-js is held to is [paxel/gates](https://github.com/paxel/gates);
`docs/adr/0001-move-to-gates.md` says where sanshain-js adds to it and why. The workflows
call gates' shared workflows, pinned by commit; Dependabot moves the pin.

### Before a commit

A change is done only when the format check, the linter, the compiler and the tests are
green, on the Node line `.nvmrc` pins. These are the commands of the shared TypeScript gate:

```sh
npm ci --ignore-scripts
npx --no-install prettier --check .
npx --no-install eslint --max-warnings 0 .
npx --no-install tsc --noEmit
npm run test:coverage
```

`eslint.config.mjs` is the standard's config, typescript-eslint's strict and stylistic sets
with type information. `tsconfig.json` is what the gate checks: the sources, the tests,
`bin/`, the fuzz targets and the Jest config, with the standard's strict compiler settings.
`tsconfig.build.json` is the build, `npm run build`: `src/` to `dist/`. `engines` in
`package.json` is the oldest Node the package runs on, 22.12; CI builds and tests on Node
22.12.0 and on Node 24 in a job of its own. Do not use what Node 22.12 does not have.

### Coverage ratchet

Line coverage may only go up. The TypeScript gate in `ci.yml` fails under the floor in
`coverage-floors.toml`. Every feature ships with tests that hold or raise coverage; a
feature that lowers it is not done. When coverage rises, raise the floor and the badge in
the same pull request, with gates checked out beside the repository:

```sh
npm run test:coverage && cp coverage/lcov.info coverage/ts.lcov
python3 ../gates/scripts/coverage_ratchet.py --floors coverage-floors.toml
```

Never lower the floor.

### Fuzzing

The fuzz targets are the files in `fuzz/`: `config`, `annotations`, `response` and `state`;
`fuzz.yml` runs them weekly. They load the built package, and each runs its seed inputs once
when it loads. One target by hand:
`npm run build && npx jazzer fuzz/config.fuzz.js -- -max_total_time=30`

### Before a release

The commands of the gate, the build and the tests on Node 22.12.0, osv-scanner with gates'
`scripts/osv_gate.py`, the coverage ratchet, and `npm pack --dry-run`, which lists what the
package holds: `dist/`, `bin/`, `action.yml`, `README.md` and `LICENSE`. The version stands
in `package.json` and `package-lock.json`. `action.yml` names the newest version that is on
npm; it is raised after the publish, never before. The release workflow runs the shared
release gate and the tests on the tagged commit before it packs.

### Security rules

The decisions behind these are in `docs/adr/0001-move-to-gates.md`.

- A finding of the linter is fixed in the code. One that must stay is silenced at its line
  with `// eslint-disable-next-line <rule> -- <reason>`, never in `eslint.config.mjs` and
  never without the reason. An exported type does not change to satisfy a rule.
- No dependency's install script runs: every install is `npm ci --ignore-scripts`.
- Every action in `.github/workflows/` is pinned to a full commit SHA with its version in
  a trailing comment. Never reference an action by tag or branch alone.
- Node is pinned in `.nvmrc`; the shared workflows and the release read it from there. A
  bump is a commit of its own.
- Every workflow starts with `permissions: contents: read`; a job that writes widens it
  itself.
- A dependency advisory is fixed by an update. When no fixed release exists, it is accepted
  in `osv-scanner.toml` with the reason sanshain-js is not exposed and an `ignoreUntil` date.
  A licence outside the allowlist is accepted per package with `effectiveUntil`. Never
  ignore without reason and date.
- A code-scanning alert or a SonarQube Cloud finding that stays open is accepted in
  `code-scanning-ignores.toml` with its tool, rule, file, reason and an `ignoreUntil` date.
  Nothing is dismissed in GitHub or marked in SonarQube Cloud.
- The release fails on a known vulnerability, on every open code-scanning alert, secret
  alert and SonarQube Cloud finding that is not accepted, and on a missing `CHANGELOG.md`
  section for the version. The weekly Security run fails on the same, and on unmaintained
  dependencies and passed dates.
- `summer` takes pull requests only.

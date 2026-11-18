# sanshain-js

The TypeScript client of the Sanshain Service. What a producer, a consumer, a provide, a
require, a version, a stability or a stream is, the service decides: see the
[glossary of sanshain-service](https://github.com/paxel/sanshain-service/blob/summer/CONTEXT.md).
The terms below are the client's own.

## Language

**Command**:
The program `sanshain` with its commands `provide`, `require` and `catalog`, installed with
the npm package of the same name.
_Avoid_: CLI tool, binary, script

**Library**:
What the package exports to a program that imports it: the client for the calls to the
service, the reader of `sanshain.yaml` and the state file. The command is built on it.
_Avoid_: SDK, API package

**Action**:
The GitHub Action in `action.yml`: one step that runs a released version of the command
through `npx`. It names the version itself; a project's own install is used only when it is
that version.
_Avoid_: Workflow, plugin

**Strict mode**:
Missing configuration, an unknown field in `sanshain.yaml`, an unfilled placeholder or a
warning of the service fails the command instead of being printed and skipped. Set by
`strict` in the file or by `SANSHAIN_STRICT`, which wins.
_Avoid_: Hard mode, fail-fast

**Best effort**:
A failure is printed as a warning and the command exits successfully, so that a build does
not stop because the service is away. Set by `--best-effort`, `SANSHAIN_BEST_EFFORT` or
`bestEffort` in the file. Where it meets strict mode is listed on the JavaScript client page
of the Sanshain site.
_Avoid_: Soft fail, lenient mode, ignore errors

**Puzzled cat**:
The notice a command prints once when `sanshain.yaml` holds fields no Sanshain client
knows. Under strict mode the command fails after printing it.
_Avoid_: Unknown-field warning, lint

**Warning**:
A line the service sent in a `Sanshain-Warning` response header. The library keeps the lines
until the caller takes them; the command prints each one and, under strict mode, fails after
printing them.
_Avoid_: Notice, message, log line

**Placeholder**:
`{{NAME}}` in the value of an annotation in `sanshain.yaml`, filled from `--set NAME=value`
or the environment variable `SANSHAIN_SET_NAME`. An annotation with an unfilled placeholder
is left out with a warning of the client.
_Avoid_: Variable, template, macro

**Origin**:
Where a build came from, sent with a provide: the build URL, the change URL, tickets and a
note, from flags or `SANSHAIN_` variables. The two URLs are also read from the CI runner's
own variables; nothing is read from git.
_Avoid_: Metadata, build info, provenance (that is the release's attestation)

**State file**:
`node_modules/.cache/sanshain/state.json` under the directory the command runs in. It holds
the ETag of every require, so that an endpoint the service has not changed is not downloaded
again.
_Avoid_: Cache, lockfile, database

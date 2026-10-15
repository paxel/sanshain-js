# sanshain (JS/TS client)

TypeScript/Node.js client and CLI for the [Sanshain Service](https://github.com/paxel/sanshain-service), published on npm as **`sanshain`**.

Sanshain (Japanese for "Sunshine") is a specialized REST service designed to manage, split, and distribute API specifications (OpenAPI, AsyncAPI, gRPC/Proto). `SanshainJS` provides a seamless way for TypeScript-based microservices to publish their API contracts and consume only the specific endpoints they need.

## Compatibility

**Client 2.x speaks Sanshain Service 2.x.** Sanshain 2.0 replaced the branch model with producer-declared versions, and this client is a clean break to match: it talks only the 2.x wire contract.

- **The version lives in the spec file.** OpenAPI/AsyncAPI: `info.version`. Proto: a mandatory `// sanshain-version:` comment. Accepted spellings are `MAJOR[.MINOR[.PATCH]]`, optionally `v`-prefixed — omitted parts are zero (`v2` becomes `2.0.0`) and the stored form is always the full three-part version. No suffixes.
- **Consumers pin exact versions.** Every `requires` entry carries a `version`; there is no fallback and nothing waits.
- **Stability is a switch, not git magic.** Every provide is a `snapshot` unless you explicitly pass `--ga` (or set `SANSHAIN_GA=true`).

`sanshain catalog` and `format: openapi` on a require need **Sanshain Service 2.4.0** or later; everything else works with any 2.x service.

If you point this client at a pre-2.0 Sanshain server, it will detect that (one lazy `GET /version` after a failure) and tell you to upgrade the server.

## Features

- **CLI Tool**: Easy-to-use commands for `provide`, `require` and `catalog` operations.
- **Maven-like Lifecycle**: Easily integrates into `package.json` scripts for automatic build-time updates.
- **Deduplication**: Automatically handles shared DTOs using Sanshain's bundle API.
- **Version Pinning**: `requires` entries pin exact producer versions — builds are reproducible by construction.
- **Stability Switch**: `snapshot` by default; `--ga` / `SANSHAIN_GA=true` for immutable GA publishes (set it on protected-branch pipelines).
- **GZIP Compression**: Efficient data transfer for large specifications.
- **CI/CD Ready**: Built-in support for any CI/CD platform (GitLab, Jenkins, GitHub, etc.).
- **ETag Caching**: Skips require when server spec is unchanged (304 Not Modified).
- **Strict Mode**: Optional strict validation for CI environments.

## How it Works (Data Flow)

SanshainJS acts as a bridge between your microservices. It follows a "Download-then-Generate" pattern:

1.  **Configure**: Define which services you need — and at exactly which version — in `sanshain.yaml`.
2.  **Download**: Run `sanshain require`. The CLI fetches the pinned endpoint snippets from the **Sanshain Service** and saves them as `.yaml` (or `.proto`) files in your local `outputDirectory`.
3.  **Generate**: Use a tool like `openapi-typescript` to turn those local `.yaml` files into `.ts` code.
4.  **Develop**: Your application imports the generated TypeScript code with full autocomplete and type safety.

This ensures your service only knows about the specific endpoints it actually uses, at the exact versions it pinned.

## Installation

```bash
npm install --save-dev sanshain
```

## Configuration (`sanshain.yaml`)

`SanshainJS` uses the standard `sanshain.yaml` configuration file. Create this file in your project root:

```yaml
sanshainUrl: http://localhost:3000
serviceName: my-ts-service
compression: true
catalogInfo: catalog-info.yaml    # optional: Backstage file pushed by `sanshain catalog`

provides:
  - file: src/docs/openapi.yaml   # version is read from the file's info.version

requires:
  - serviceName: auth-service
    version: 1.2.0                # exact pin — MAJOR.MINOR.PATCH, no ranges, no latest
    outputDirectory: src/generated/auth
    endpoints:
      - method: GET
        path: /api/v1/users
      - method: POST
        path: /api/v1/login
```

Every relative path in `sanshain.yaml` (`file`, `openApiFile`, `asyncApiFile`, `protoFile`, `outputDirectory`) is resolved against the directory that contains `sanshain.yaml`, not the current working directory — so `sanshain --config other/dir/sanshain.yaml provide` finds the same files as a run started in `other/dir`. Absolute paths stay as they are.

The provide **version is never configured here** — it is read from the spec file itself (`info.version` for OpenAPI/AsyncAPI, the `// sanshain-version: MAJOR.MINOR.PATCH` comment for proto).

Branch-era fields (`branch`, `timeout`, `baseVersion`, `releaseBranches`) are rejected at parse time with a migration hint. A `requires` entry without a `version` is a hard error — list a producer's available versions with `GET /producers/<name>/versions`.

Any other field the CLI does not know — a typo such as `catalogInf` or `requires[0].outputDirectroy` — is reported once on stderr and ignored:

```
   /\_/\  ?
  ( O_o )   sanshain.yaml: unknown field 'catalogInf' - ignored
 ---U-U---
```

The message comes right after the removed-field checks, before any other validation, so it also shows when a typo leads to a follow-up error (such as a missing `version`). With `strict` on, the same message ends in `rejected (strict)` and the command fails, even under best-effort. Fields that other Sanshain clients support (`insecure`, `combine`) are accepted silently.

### AsyncAPI as OpenAPI (`format`)

A `requires` entry with `apiType: asyncapi` may add `format: openapi` to receive the pinned channels rendered as an OpenAPI document, e.g. for an OpenAPI code generator. It is the only supported combination; any other `format` value, or `format` with another `apiType`, is a configuration error. The file keeps its usual name (`<serviceName>.yaml`, or `<serviceName>_bundle.yaml` for several endpoints). To get both formats, list the entry twice with different `outputDirectory` values:

```yaml
requires:
  - serviceName: notifier
    apiType: asyncapi
    version: 1.2.0
    outputDirectory: src/generated/notifier
    endpoints:
      - method: SUB
        path: user/signup
  - serviceName: notifier
    apiType: asyncapi
    format: openapi
    version: 1.2.0
    outputDirectory: src/generated/notifier-openapi
    endpoints:
      - method: SUB
        path: user/signup
```

`format: openapi` needs Sanshain Service 2.4.0 or later. An older service rejects the single-endpoint request or returns AsyncAPI; the client reports that it needs 2.4.0. It writes nothing and fails with `format: openapi needs Sanshain Service 2.4.0 or later (server is <version>)` (a warning under best-effort).

### Environment Variable Overrides

| Variable                | Description                                                     |
|-------------------------|-----------------------------------------------------------------|
| `SANSHAIN_URL`          | Override `sanshainUrl` (the `--url` flag overrides both)        |
| `SANSHAIN_TOKEN`        | Bearer token for authentication                                 |
| `SANSHAIN_SERVICE_NAME` | Override `serviceName`                                          |
| `SANSHAIN_GA`           | Set to `true` to provide as GA instead of snapshot              |
| `SANSHAIN_TRUNK`        | Set to `true` on trunk CI (same as `--trunk`)                   |
| `SANSHAIN_BEST_EFFORT`  | Set to `true` to continue on errors                             |
| `SANSHAIN_STRICT`       | Set to `true` to fail on missing configuration                  |
| `SANSHAIN_FORCE`        | No effect (accepted for compatibility; every provide uploads)   |
| `SANSHAIN_COMPRESSION`  | Override `compression`                                          |

The URL is taken from the `--url` flag first, then `SANSHAIN_URL`, then `sanshainUrl` in `sanshain.yaml`.
Boolean switches are on for `true` or `1` (trimmed, any case); any other value is off.

## Snapshot vs. GA (the `ga` switch)

Every provide is a **snapshot** by default: overwritable work-in-progress that expires when unused. To publish an immutable **GA** version, flip the switch explicitly:

```bash
sanshain provide --ga
# or
SANSHAIN_GA=true sanshain provide
```

There is no git or branch detection — CI simply sets `SANSHAIN_GA=true` on protected-branch pipelines, and that is the whole mechanism. GA versions permanently claim their number; re-providing a GA version with different content is rejected (see below). Publishing GA requires the `releaser` role — without it the server answers `403` and the error names the role and the snapshot fallback.

## Streams: trunk and release branches

Alongside stability, the pipeline declares which dependency graph its calls belong to. Like the
ga switch this is a property of the invocation and never appears in `sanshain.yaml`:

```bash
sanshain provide --trunk        # trunk CI: maintains the main graph (also SANSHAIN_TRUNK=true)
sanshain provide --tag R1       # release/hotfix pipeline: updates that sanshain-branch (also SANSHAIN_TAG)
```

The same flags apply to `require` — trunk pins feed the main graph. Declaring both records the
build in neither graph: the CLI warns
`trunk and tag are mutually exclusive - this build is recorded in neither` and sends neither
(under strict it fails before any request). An unknown tag is not created and not an error: the
call succeeds, recorded only in the dev graph, and Sanshain sends a warning (see
[Warnings](#warnings)); a releaser must create the branch first.

## Retiring a protocol

Removing a `provides` entry tells Sanshain nothing — it cannot distinguish a dropped protocol
from a pipeline that stopped running. Keep the entry and mark it:

```yaml
provides:
  - apiType: asyncapi
    retired: true
```

The next `provide` retires that family: the capability tag is cleared, it leaves the current
dependency graph, and its AsyncAPI channel contracts are released. Version history and existing
Consumer pins are untouched. Retiring needs the `releaser` role — which a release pipeline
already holds — or a maintainer grant on the Producer.

> ⚠️ **AsyncAPI 2.x perspective.** Sanshain reads 2.x `publish`/`subscribe` from the
> **application's** perspective: `publish` means *this service publishes to the channel*,
> `subscribe` means *this service consumes it*. The AsyncAPI 2.x specification defines those
> keywords from the **client's** perspective — exactly inverted. Sanshain deliberately uses the
> application-perspective reading because it matches the unambiguous 3.x `send`/`receive`
> mapping. A document authored with the spec-literal reading registers its contracts, and has
> its subscriptions harvested, exactly backwards. Harvested subscriptions are printed after
> every AsyncAPI provide; those with drift or no publisher yet are warnings and never fail the
> build.

## Automatic Integration (Recommended)

To make `SanshainJS` behave like the Maven plugin (running automatically during build), add it to your `package.json`:

```json
"scripts": {
  "prebuild": "sanshain require",
  "build": "tsc"
}
```

Now, every time you run `npm run build`, it will first download the pinned OpenAPI specs.

## CLI Usage

### Provide

Upload your service's API specification to Sanshain under the version declared in the spec file:

```bash
sanshain provide          # snapshot (default)
sanshain provide --ga     # immutable GA
```

### Require

Download the pinned endpoint snippets and bundles as defined in `sanshain.yaml`:

```bash
sanshain require
```

### Catalog

Push the system's Backstage `catalog-info.yaml` (the `catalogInfo` field, relative to `sanshain.yaml`) so Sanshain can show the **Peripheral Resources** — databases, buckets, queues — the Component lists under `spec.dependsOn`. Needs Sanshain Service 2.4.0 or later.

```bash
sanshain catalog            # updates the dev graph
sanshain catalog --trunk    # trunk CI: updates the main graph as well
```

On success the CLI prints the recorded resources:

```
Catalog recorded for orders-service (main+dev): 1 resources
  resource:default/orders-db
```

- Without `catalogInfo` the command warns `No catalogInfo in sanshain.yaml - skipping catalog.` and exits 0 (fails under strict).
- A file Sanshain cannot read as this project's Component — usually a `metadata.name` that is not the `serviceName` — records nothing and keeps the previous periphery. The CLI prints Sanshain's reason as a warning and exits 0 (fails under strict).
- A `404` means the service is older than 2.4.0; the CLI checks `GET /version` and names it.
- Under best-effort every failure is a warning and the command exits 0.

Run it once per build as its own CI step, next to `provide`/`require` — see [CI/CD Integration](docs/ci-integration.md).

## Failure Modes

Sanshain 2.0 fails fast and self-service; the CLI surfaces each case distinctly:

- **`404` (Unknown)**: the producer, or the pinned version, does not exist on the server — in either stability. A configuration error; fix the pin (list available versions: `GET /producers/<name>/versions`). Nothing waits for a version to appear.
- **`410` (Absent)**: the pinned version exists but deliberately does not include the requested endpoint(s). For bundles, the whole bundle fails and the server names the missing endpoints.
- **`409` (Version rules)**: the provide was rejected — most commonly "same GA version, different content". The server proposes the next free version, and the CLI prints it prominently:

  ```
  Provide rejected by the version rules (409): version 1.2.0 is GA and immutable
  Publish as 1.3.0 — update info.version in src/docs/openapi.yaml
  ```

  The CLI never modifies your spec files — bump the version yourself and re-run.
- **Pre-2.0 server**: after a failed provide/require the CLI checks `GET /version` once; if the instance is older than 2.0.0 you get a clear "upgrade the server" message instead of a confusing wire error.

## Caching

### Provide always uploads

`sanshain provide` uploads every spec file on every run; Sanshain treats re-providing byte-identical content as an idempotent no-op, so CI re-runs never fight. `--force`, `force: true` and `SANSHAIN_FORCE` are still accepted but have no effect.

### Require-Side ETag Caching

The CLI stores the `ETag` from require responses and sends `If-None-Match` on subsequent runs. On `304 Not Modified`:

```
⏭ user-service spec unchanged (304), skipping code generation.
```

A pin on a GA version can never change content; a pin on a snapshot can — which is exactly what the ETag detects. A `--dry-run` require stores no ETag.

### State File

The local cache is stored at `node_modules/.cache/sanshain/state.json` with the following format:

```json
{
  "requires": {
    "user-service|1.2.0|GET|/api/v1/users": {
      "etag": "\"sha256:def456...\"",
      "last_fetched": "2026-04-25T12:00:00Z"
    }
  }
}
```

A `provides` section written by older clients is ignored.

## Strict Mode

By default, the CLI warns and skips when configuration is incomplete (no `serviceName`, no `provides`, no `requires`, no `catalogInfo`). This makes it safe to include both commands in build scripts even if only one applies.

To fail on missing configuration, enable strict mode:

```yaml
strict: true
```

Or via environment variable:

```bash
export SANSHAIN_STRICT=true
```

When strict mode is enabled:
- Missing `serviceName` → exit with error
- No `provides` configured → exit with error
- No `requires` configured → exit with error
- No `catalogInfo` configured (for `sanshain catalog`, which checks only `serviceName` and `catalogInfo`) → exit with error
- Unknown fields in `sanshain.yaml` → exit with error (best-effort does not soften this)
- Any warning Sanshain sends, and declaring both trunk and a tag → exit with error (best-effort does not soften this)

## Warnings

The dependency graph is informational and never fails a build. Where Sanshain does not record a
call in a graph — an unknown `--tag`, a `catalog-info.yaml` it cannot read — the call succeeds
and Sanshain sends a `Sanshain-Warning` header. The CLI prints each one as `⚠ <text>`, for every
command and for error responses too, and the build carries on. Under strict mode a warning fails
the command after the call with `strict: Sanshain warned: <text>` (the first warning, if there
are several); best-effort does not soften that.

## CI/CD Integration

`SanshainJS` is platform-agnostic. For detailed guides on integrating it into your CI/CD pipeline (GitLab, Jenkins, GitHub Actions, etc.), see:

- [Generic CI/CD Integration Guide](docs/ci-integration.md)
- [GitHub Actions Specific Guide](docs/github-actions.md)

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

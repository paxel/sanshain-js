# SanshainJS

TypeScript/Node.js client and CLI for the [Sanshain Service](https://github.com/paxel/sanshain-service).

Sanshain (Japanese for "Sunshine") is a specialized REST service designed to manage, split, and distribute OpenAPI specifications. `SanshainJS` provides a seamless way for TypeScript-based microservices to publish their API contracts and consume only the specific endpoints they need.

## Features

- **CLI Tool**: Easy-to-use commands for `provide` and `require` operations.
- **Maven-like Lifecycle**: Easily integrates into `package.json` scripts for automatic build-time updates.
- **Deduplication**: Automatically handles shared DTOs using Sanshain's bundle API.
- **Branch Support**: Intelligent Git branch detection and automatic fallback to `main`.
- **GZIP Compression**: Efficient data transfer for large OpenAPI specifications.
- **CI/CD Ready**: Built-in support for any CI/CD platform (GitLab, Jenkins, GitHub, etc.).
- **Content Caching**: Skips provide when spec file is unchanged (SHA-256 hash match).
- **ETag Caching**: Skips require when server spec is unchanged (304 Not Modified).
- **Optimistic Concurrency**: Detects concurrent modifications via `baseVersion`.
- **Strict Mode**: Optional strict validation for CI environments.

## How it Works (Data Flow)

SanshainJS acts as a bridge between your microservices. It follows a "Download-then-Generate" pattern:

1.  **Configure**: Define which services you need in `sanshain.yaml`.
2.  **Download**: Run `sanshain require`. The CLI fetches OpenAPI specs from the **Sanshain Service** and saves them as `.yaml` files in your local `outputDirectory`.
3.  **Generate**: Use a tool like `openapi-typescript` to turn those local `.yaml` files into `.ts` code.
4.  **Develop**: Your application imports the generated TypeScript code with full autocomplete and type safety.

This ensures your service only knows about the specific endpoints it actually uses, kept in sync via your CI/CD pipeline.

## Installation

```bash
npm install --save-dev sanshainjs
```

## Configuration (`sanshain.yaml`)

`SanshainJS` uses the standard `sanshain.yaml` configuration file. Create this file in your project root:

```yaml
sanshainUrl: http://localhost:3000
serviceName: my-ts-service
compression: true

provides:
  - file: src/docs/openapi.yaml
    baseVersion: 5          # optional: optimistic concurrency control

requires:
  - serviceName: auth-service
    outputDirectory: src/generated/auth
    endpoints:
      - method: GET
        path: /api/v1/users
      - method: POST
        path: /api/v1/login
```

### Environment Variable Overrides

| Variable               | Description                                      |
|------------------------|--------------------------------------------------|
| `SANSHAIN_URL`         | Override `sanshainUrl`                            |
| `SANSHAIN_TOKEN`       | Bearer token for authentication                  |
| `SANSHAIN_SERVICE_NAME`| Override `serviceName`                            |
| `SANSHAIN_BRANCH`      | Override auto-detected Git branch                 |
| `SANSHAIN_BEST_EFFORT` | Set to `true` to continue on errors               |
| `SANSHAIN_STRICT`      | Set to `true` to fail on missing configuration    |

## Automatic Integration (Recommended)

To make `SanshainJS` behave like the Maven plugin (running automatically during build), add it to your `package.json`:

```json
"scripts": {
  "prebuild": "sanshain require",
  "build": "tsc"
}
```

Now, every time you run `npm run build`, it will first download the latest required OpenAPI specs.

## CLI Usage

### Provide

Upload your service's OpenAPI specification to Sanshain:

```bash
sanshain provide
```

### Require

Download the required endpoint snippets and bundles as defined in `sanshain.yaml`:

```bash
sanshain require
```

## v0.13.0 Features

### Optimistic Concurrency Control (`baseVersion`)

Add `baseVersion` to your provide configuration to detect concurrent modifications:

```yaml
provides:
  - file: src/docs/openapi.yaml
    baseVersion: 5
```

If the server version has advanced beyond your `baseVersion`, the provide call fails with:

> Concurrent modification detected. Server version has advanced beyond your base_version. Re-run to fetch the latest state.

The CLI automatically tracks the last known version in a local cache, so after the first successful provide, subsequent runs send the correct `base_version` automatically.

### Provide Response Summary

After each successful provide, the CLI logs a human-readable summary:

```
✓ Provided to Sanshain v5: 2 new, 1 updated, 0 deleted endpoints
```

### Client-Side Content Caching (Skip-if-unchanged)

Before uploading, the CLI computes the SHA-256 hash of the spec file and compares it with the cached hash from the last provide. If unchanged:

```
⏭ Spec unchanged (hash match), skipping provide.
```

### Require-Side ETag Caching

The CLI stores the `ETag` from require responses and sends `If-None-Match` on subsequent runs. On `304 Not Modified`:

```
⏭ user-service spec unchanged (304), skipping code generation.
```

### State File

The local cache is stored at `node_modules/.cache/sanshain/state.json` with the following format:

```json
{
  "provides": {
    "openapi.yaml": {
      "content_hash": "sha256:abc123...",
      "version": 5,
      "last_provided": "2026-04-25T12:00:00Z"
    }
  },
  "requires": {
    "user-service|main|GET|/api/v1/users": {
      "etag": "\"sha256:def456...\"",
      "last_fetched": "2026-04-25T12:00:00Z"
    }
  }
}
```

## Strict Mode

By default, the CLI warns and skips when configuration is incomplete (no `serviceName`, no `provides`, no `requires`). This makes it safe to include both commands in build scripts even if only one applies.

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

## CI/CD Integration

`SanshainJS` is platform-agnostic. For detailed guides on integrating it into your CI/CD pipeline (GitLab, Jenkins, GitHub Actions, etc.), see:

- [Generic CI/CD Integration Guide](docs/ci-integration.md)
- [GitHub Actions Specific Guide](docs/github-actions.md)

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

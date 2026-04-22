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

requires:
  - serviceName: auth-service
    outputDirectory: src/generated/auth
    endpoints:
      - method: GET
        path: /api/v1/users
      - method: POST
        path: /api/v1/login
```

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

## CI/CD Integration

`SanshainJS` is platform-agnostic. For detailed guides on integrating it into your CI/CD pipeline (GitLab, Jenkins, GitHub Actions, etc.), see:

- [Generic CI/CD Integration Guide](docs/ci-integration.md)
- [GitHub Actions Specific Guide](docs/github-actions.md)

## License

This project is licensed under the GNU Affero General Public License (AGPL-3.0). See the [LICENSE](LICENSE) file for details.

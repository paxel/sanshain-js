# SanshainJS

TypeScript/Node.js client and CLI for the [Sanshain Service](https://github.com/paxel/sanshain-service).

Sanshain (Japanese for "Sunshine") is a specialized REST service designed to manage, split, and distribute OpenAPI specifications. `SanshainJS` provides a seamless way for TypeScript-based microservices to publish their API contracts and consume only the specific endpoints they need.

## Features

- **CLI Tool**: Easy-to-use commands for `provide` and `require` operations.
- **Deduplication**: Automatically handles shared DTOs using Sanshain's bundle API.
- **Branch Support**: Intelligent Git branch detection and automatic fallback to `main`.
- **GZIP Compression**: Efficient data transfer for large OpenAPI specifications.
- **GitHub Actions Integration**: Designed to be used in CI/CD pipelines.

## Installation

```bash
# Clone the repository
git clone https://github.com/paxel/sanshain.git
cd sanshain/sanshain-js

# Install dependencies and build
npm install
npm run build

# Link the CLI (optional)
npm link
```

## Configuration (`sanshain.yaml`)

`SanshainJS` uses the standard `sanshain.yaml` configuration file. Create this file in your project root:

```yaml
sanshainUrl: http://localhost:3000
clientName: my-ts-service
compression: true

provide:
  serviceName: my-ts-service
  openApiFile: src/docs/openapi.yaml

requires:
  - serviceName: auth-service
    outputDirectory: src/generated/auth
    endpoints:
      - method: GET
        path: /api/v1/users
      - method: POST
        path: /api/v1/login
```

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

## GitHub Actions

For details on how to integrate `SanshainJS` into your GitHub Actions workflows, see [docs/github-actions.md](docs/github-actions.md).

## License

ISC

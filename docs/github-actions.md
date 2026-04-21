# Sanshain GitHub Actions Integration

This guide describes how to integrate the Sanshain CLI into your GitHub Actions workflows for TypeScript/Node.js projects.

## Prerequisites

1. A `sanshain.yaml` file in your repository root.
2. A `SANSHAIN_TOKEN` stored as a GitHub Repository Secret.

## 1. Automatically Publish OpenAPI Spec (`provide`)

Run this workflow whenever changes are merged to the `main` branch to keep the Sanshain Service up to date.

```yaml
name: Publish OpenAPI Spec
on:
  push:
    branches:
      - main

jobs:
  provide:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install Sanshain CLI
        run: npm install -g sanshainjs
      
      - name: Provide Spec
        run: sanshain provide
        env:
          SANSHAIN_TOKEN: ${{ secrets.SANSHAIN_TOKEN }}
```

## 2. Consume OpenAPI Specs and Generate Client (`require`)

Run this workflow during your build process to download required specs and generate type-safe clients.

```yaml
name: Build and Generate Client
on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install Dependencies
        run: npm install
      
      - name: Download Required Specs
        run: npx sanshain require
        env:
          SANSHAIN_TOKEN: ${{ secrets.SANSHAIN_TOKEN }}
      
      - name: Generate TypeScript Client
        run: npx openapi-typescript ./generated/service_bundle.yaml -o ./src/api/client.ts
      
      - name: Build
        run: npm run build
```

## Integration with `openapi-typescript`

The Sanshain CLI is designed to work seamlessly with `openapi-typescript`. Because Sanshain returns a single merged spec with deduplicated schemas (via `/require-bundle`), you can generate a clean, conflict-free client:

1. Define your dependencies in `sanshain.yaml`.
2. Run `sanshain require`.
3. Use `openapi-typescript` on the output file.

Example `sanshain.yaml`:
```yaml
sanshainUrl: https://sanshain.example.com
clientName: my-web-app
requires:
  - serviceName: user-service
    outputDirectory: ./generated
    endpoints:
      - method: GET
        path: /api/v1/users
      - method: POST
        path: /api/v1/users
```

Generated command:
```bash
npx sanshain require
npx openapi-typescript ./generated/user-service_bundle.yaml -o ./src/api/user-client.ts
```

## CI Branch Detection

The CLI automatically detects the current branch using the `GITHUB_REF_NAME` environment variable provided by GitHub Actions. This ensures that when you run `require` on a feature branch, it will first look for endpoints on that same branch in Sanshain, falling back to `main` if not found.

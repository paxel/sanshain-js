# sanshain (JS/TS client)

[![Build and Test](https://github.com/paxel/sanshain-js/actions/workflows/build.yml/badge.svg?branch=summer)](https://github.com/paxel/sanshain-js/actions/workflows/build.yml)
[![Security](https://github.com/paxel/sanshain-js/actions/workflows/security.yml/badge.svg?branch=summer)](https://github.com/paxel/sanshain-js/actions/workflows/security.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=paxel_sanshain-js&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=paxel_sanshain-js)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=paxel_sanshain-js&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=paxel_sanshain-js)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=paxel_sanshain-js&metric=coverage)](https://sonarcloud.io/summary/new_code?id=paxel_sanshain-js)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/paxel/sanshain-js/badge)](https://scorecard.dev/viewer/?uri=github.com/paxel/sanshain-js)
[![npm](https://img.shields.io/npm/v/sanshain)](https://www.npmjs.com/package/sanshain)
[![Node 22.12+](https://img.shields.io/badge/node-22.12%2B-blue)](https://github.com/paxel/sanshain-js/actions/workflows/build.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](https://github.com/paxel/sanshain-js/blob/summer/LICENSE)

TypeScript/Node.js client, CLI and GitHub Action for the [Sanshain Service](https://github.com/paxel/sanshain-service), published on npm as **`sanshain`**. A project provides its API specifications (OpenAPI, AsyncAPI, gRPC/Proto) under the version declared in the spec file, and downloads the endpoint snippets it depends on, pinned to an exact version.

**The documentation lives on the Sanshain site: [JavaScript client](https://paxel.github.io/sanshain-service/developer/clients/javascript.html).** It lists every flag, variable and `sanshain.yaml` field with the version it arrived in, the precedence, the ETag state file, strict mode and best effort, the failure modes, the library exports, [the GitHub Action](https://paxel.github.io/sanshain-service/developer/clients/javascript.html#github-action) and CI recipes. The file itself is described in [`sanshain.yaml`](https://paxel.github.io/sanshain-service/developer/sanshain-yaml.html).

**Compatibility: client 2.x speaks Sanshain Service 2.x.** Node.js 22.12 or later, also for the GitHub Action, which runs on the job's Node.

## Install

```bash
npm install --save-dev sanshain
```

## A minimal example

`sanshain.yaml` in the project root:

```yaml
serviceName: my-ts-service
provides:
  - file: src/docs/openapi.yaml   # the version is read from info.version
requires:
  - serviceName: auth-service
    version: 1.2.0                # an exact pin
    outputDirectory: src/generated/auth
    endpoints:
      - method: GET
        path: /api/v1/users
```

With `SANSHAIN_URL` and `SANSHAIN_TOKEN` in the environment:

```bash
npx sanshain provide          # snapshot (the default)
npx sanshain provide --ga     # immutable GA, from the release pipeline
npx sanshain require          # writes src/generated/auth/auth-service.yaml
```

A `"prebuild": "sanshain require"` script in `package.json` fetches the pinned snippets before every `npm run build`. In GitHub Actions:

```yaml
- uses: paxel/sanshain-js@summer
  with:
    command: provide
    ga: ${{ github.ref == 'refs/heads/main' && 'true' || '' }}
    trunk: ${{ github.ref == 'refs/heads/main' }}
  env:
    SANSHAIN_URL: ${{ vars.SANSHAIN_URL }}
    SANSHAIN_TOKEN: ${{ secrets.SANSHAIN_TOKEN }}
```

## License

Apache License 2.0. See [LICENSE](LICENSE).

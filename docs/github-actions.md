# GitHub Actions Integration

While `SanshainJS` works on any CI platform using standard CLI commands, this guide covers the specific features available for GitHub Actions users.

> **Note**: For general CI/CD concepts (like `package.json` integration), please see the [Generic CI/CD Guide](ci-integration.md).

## 1. Native GitHub Action

If you want a declarative workflow or want to avoid installing the CLI as a dependency, you can use the native Sanshain Action.

### Publish Spec on Merge (GA)

On your protected-branch workflow, set the `ga` input so the publish is an immutable GA version:

```yaml
- name: Provide Spec
  uses: paxel/sanshain/sanshain-js@v3 # Path to the action in this repo
  with:
    command: provide
    token: ${{ secrets.SANSHAIN_TOKEN }}
    ga: 'true'
```

### Publish GA on Trunk with autoGa

With `autoGa: true` in `sanshain.yaml` the `trunk` (or `tag`) input is enough: such a build provides GA, every other build a snapshot. Leave `ga` empty — `ga: 'false'` keeps a snapshot even then. The token's user needs the `releaser` role, and a trunk build that changes the spec without a version bump fails with `409 immutable_ga` and the proposed version.

```yaml
- name: Provide Spec
  uses: paxel/sanshain/sanshain-js@v3
  with:
    command: provide
    token: ${{ secrets.SANSHAIN_TOKEN }}
    trunk: ${{ github.ref == 'refs/heads/main' }}
```

### Publish Snapshot on Feature Branches

Omit `ga` — without `autoGa` the default is always a snapshot:

```yaml
- name: Provide Snapshot
  uses: paxel/sanshain/sanshain-js@v3
  with:
    command: provide
    token: ${{ secrets.SANSHAIN_TOKEN }}
```

### Download Specs during Build

```yaml
- name: Require Specs
  uses: paxel/sanshain/sanshain-js@v3
  with:
    command: require
    token: ${{ secrets.SANSHAIN_TOKEN }}
```

### Push catalog-info.yaml

Needs `catalogInfo` in `sanshain.yaml` and Sanshain Service 2.4.0 or later:

```yaml
- name: Push Catalog
  uses: paxel/sanshain/sanshain-js@v3
  with:
    command: catalog
    token: ${{ secrets.SANSHAIN_TOKEN }}
    trunk: ${{ github.ref == 'refs/heads/main' }}
```

### Annotations

The Action has no input for the `{{NAME}}` placeholders of the `annotations` in `sanshain.yaml`; set `SANSHAIN_SET_NAME` variables on the step instead (needs Sanshain Service 2.13.0 or later):

```yaml
- name: Provide Spec
  uses: paxel/sanshain/sanshain-js@v3
  with:
    command: provide
    token: ${{ secrets.SANSHAIN_TOKEN }}
  env:
    SANSHAIN_SET_AREA: '7'
    SANSHAIN_SET_ID: ${{ vars.REQUIREMENTS_ID }}
```

### Inputs

| Input               | Required | Default   | Description                                                                                                                                         |
|---------------------|----------|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
| `command`           | yes      | —         | `provide`, `require` or `catalog` (needs Sanshain Service 2.4.0).                                                                                   |
| `token`             | no       | —         | Sanshain API token (or set the `SANSHAIN_TOKEN` env/secret).                                                                                        |
| `ga`                | no       | `''`      | `'true'` publishes as immutable GA, `'false'` keeps a snapshot despite `autoGa`; empty lets `autoGa` decide (maps to `SANSHAIN_GA`).                |
| `trunk`             | no       | `'false'` | `'true'` on trunk CI: this build maintains the main graph (maps to `SANSHAIN_TRUNK`).                                                               |
| `tag`               | no       | `''`      | A sanshain-branch name for release/hotfix pipelines (maps to `SANSHAIN_TAG`); setting it with `trunk` records the build in neither, with a warning. |
| `tickets`           | no       | `''`      | Ticket ids this build closes, comma-separated, stored with the version's origin (maps to `SANSHAIN_TICKETS`).                                       |
| `note`              | no       | `''`      | One line of intent for this provide (maps to `SANSHAIN_NOTE`).                                                                                      |
| `working-directory` | no       | `'.'`     | Directory where `sanshain.yaml` is located.                                                                                                         |

---

## Comparison with Maven Plugin

| Feature         | Maven Plugin (Java)               | SanshainJS (TypeScript)          |
|-----------------|-----------------------------------|----------------------------------|
| **Config File** | `sanshain.yaml`                   | `sanshain.yaml`                  |
| **Lifecycle**   | Attached to `initialize` phase    | Attached to `prebuild` script    |
| **Command**     | `mvn sanshain:provide`            | `sanshain provide`               |
| **Auth**        | `settings.xml` or `SANSHAIN_TOKEN`| `SANSHAIN_TOKEN` env var         |
| **GA switch**   | `-Dsanshain.ga=true` or `SANSHAIN_GA` | `--ga` flag or `SANSHAIN_GA` |

## Versions, not Branches

Sanshain 2.x has no branch model, so there is no branch detection in this client. What matters in a workflow:

- **Provide**: the published version is read from the spec file (`info.version`, or the `// sanshain-version:` comment for proto). The workflow only decides *stability* via the `ga` input, or via `trunk`/`tag` with `autoGa: true`.
- **Require**: each `requires` entry in `sanshain.yaml` pins an exact version; the same versions resolve on every branch and every runner.

## How Files are Handled in CI

When you run `sanshain require` in a GitHub Action:
1. The files are downloaded to the GitHub Runner's local disk (the workspace).
2. Any subsequent steps in the same job (like `npm run build` or `openapi-typescript`) see these files exactly as if they were on your own computer.
3. These files are typically NOT committed back to your repository; they are generated on-the-fly during the build.

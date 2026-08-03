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

### Publish Snapshot on Feature Branches

Omit `ga` (or set it to `'false'`) — the default is always a snapshot:

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

### Inputs

| Input               | Required | Default   | Description                                                        |
|---------------------|----------|-----------|--------------------------------------------------------------------|
| `command`           | yes      | —         | `provide` or `require`.                                            |
| `token`             | no       | —         | Sanshain API token (or set the `SANSHAIN_TOKEN` env/secret).       |
| `ga`                | no       | `'false'` | `'true'` publishes as immutable GA (maps to `SANSHAIN_GA`).        |
| `working-directory` | no       | `'.'`     | Directory where `sanshain.yaml` is located.                        |

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

- **Provide**: the published version is read from the spec file (`info.version`, or the `// sanshain-version:` comment for proto). The workflow only decides *stability* via the `ga` input.
- **Require**: each `requires` entry in `sanshain.yaml` pins an exact version; the same versions resolve on every branch and every runner.

## How Files are Handled in CI

When you run `sanshain require` in a GitHub Action:
1. The files are downloaded to the GitHub Runner's local disk (the workspace).
2. Any subsequent steps in the same job (like `npm run build` or `openapi-typescript`) see these files exactly as if they were on your own computer.
3. These files are typically NOT committed back to your repository; they are generated on-the-fly during the build.

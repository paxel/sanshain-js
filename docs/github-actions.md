# GitHub Actions Integration

While `SanshainJS` works on any CI platform using standard CLI commands, this guide covers the specific features available for GitHub Actions users.

> **Note**: For general CI/CD concepts (like `package.json` integration), please see the [Generic CI/CD Guide](ci-integration.md).

## 1. Native GitHub Action

If you want a declarative workflow or want to avoid installing the CLI as a dependency, you can use the native Sanshain Action.

### Publish OpenAPI Spec on Merge

```yaml
- name: Provide Spec
  uses: paxel/sanshain/sanshain-js@v1 # Path to the action in this repo
  with:
    command: provide
    token: ${{ secrets.SANSHAIN_TOKEN }}
```

### Download Specs during Build

```yaml
- name: Require Specs
  uses: paxel/sanshain/sanshain-js@v1
  with:
    command: require
    token: ${{ secrets.SANSHAIN_TOKEN }}
```

---

## Comparison with Maven Plugin

| Feature | Maven Plugin (Java) | SanshainJS (TypeScript) |
|---|---|---|
| **Config File** | `sanshain.yaml` | `sanshain.yaml` |
| **Lifecycle** | Attached to `initialize` phase | Attached to `prebuild` script |
| **Command** | `mvn sanshain:provide` | `sanshain provide` |
| **Auth** | `settings.xml` or `SANSHAIN_TOKEN` | `SANSHAIN_TOKEN` env var |
| **Branch** | Auto-detected from Git | Auto-detected from Git / GitHub Actions |

## CI Branch Detection

The CLI automatically detects the current branch using the `GITHUB_REF_NAME` environment variable provided by GitHub Actions. This ensures that when you run `require` on a feature branch, it will first look for endpoints on that same branch in Sanshain, falling back to `main` if not found.

## How Files are Handled in CI

When you run `sanshain require` in a GitHub Action:
1. The files are downloaded to the GitHub Runner's local disk (the workspace).
2. Any subsequent steps in the same job (like `npm run build` or `openapi-typescript`) see these files exactly as if they were on your own computer.
3. These files are typically NOT committed back to your repository; they are generated on-the-fly during the build.

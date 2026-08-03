# Generic CI/CD Integration

`SanshainJS` is a standard Node.js CLI tool. It is platform-agnostic and works in any CI/CD environment where Node.js is available (e.g., GitLab CI, Jenkins, Bitbucket Pipelines, CircleCI, Azure DevOps).

## 1. Prerequisites

- **Node.js**: Ensure Node.js (v18+) is installed on your CI runner.
- **Authentication**: Set the `SANSHAIN_TOKEN` environment variable in your CI platform's secret management.

## 2. Automatic Integration (Recommended)

The easiest way to use `SanshainJS` is to integrate it into your `package.json` scripts. This makes it part of your build lifecycle, regardless of the CI platform.

### Step A: Update `package.json`

```json
{
  "devDependencies": {
    "sanshainjs": "^3.0.0"
  },
  "scripts": {
    "prebuild": "sanshain require",
    "build": "tsc"
  }
}
```

### Step B: Run Build in CI

In your CI configuration, simply run your standard build command. Ensure `SANSHAIN_TOKEN` is available in the environment.

**Example (GitLab CI):**
```yaml
build:
  image: node:20
  script:
    - npm install
    - npm run build
  variables:
    SANSHAIN_TOKEN: $SANSHAIN_TOKEN # Defined in GitLab CI/CD Secrets
```

**Example (Jenkins Pipeline):**
```groovy
pipeline {
    agent { docker { image 'node:20' } }
    environment {
        SANSHAIN_TOKEN = credentials('sanshain-token')
    }
    stages {
        stage('Build') {
            steps {
                sh 'npm install'
                sh 'npm run build'
            }
        }
    }
}
```

## 3. Manual CLI Usage

If you prefer not to use `package.json` scripts, you can run the CLI directly.

### Provide (Publish Spec)

By default every provide is a **snapshot**. On your release/protected-branch pipeline, flip the GA switch so the publish is an immutable GA version:

```bash
# Ensure SANSHAIN_TOKEN is set
npx sanshain provide                       # snapshot (default, e.g. feature branches)
SANSHAIN_GA=true npx sanshain provide      # GA (protected-branch pipeline)
# or equivalently: npx sanshain provide --ga
```

The version itself is never a CI concern — it is read from the spec file (`info.version`, or the `// sanshain-version:` comment for proto).

### Require (Download Specs)

Typically run before build or code generation:
```bash
npx sanshain require
```

Requires resolve the exact versions pinned in `sanshain.yaml` — the result does not depend on which branch CI is building.

## 4. Environment Variables

| Variable         | Description                                                                    |
|------------------|--------------------------------------------------------------------------------|
| `SANSHAIN_TOKEN` | **Required**. Your authentication token for the Sanshain Service.              |
| `SANSHAIN_GA`    | Optional. Set to `true` to provide as immutable GA instead of the default snapshot. |
| `SANSHAIN_URL`   | Optional. Overrides the `sanshainUrl` in `sanshain.yaml`.                      |

## 5. Snapshot vs. GA in CI

Stability is an explicit switch — there is no git or branch detection. The recommended setup:

- **Feature-branch / PR pipelines**: run `sanshain provide` as-is; publishes overwritable snapshots.
- **Protected-branch (release) pipelines**: set `SANSHAIN_GA=true`; publishes immutable GA versions.

If a GA provide is rejected with `409`, the server proposes the next free version; update the spec file's version and re-run.

## 6. How it Works in CI

1. **Isolation**: Every CI run starts with a clean workspace.
2. **Download**: `sanshain require` downloads the pinned specs to the local disk (as configured in `sanshain.yaml`).
3. **Consumption**: Subsequent build steps (like `tsc` or `openapi-typescript`) use these local files.
4. **Cleanup**: Downloaded files are usually ignored by Git and vanish when the CI runner finishes, keeping your repo clean.

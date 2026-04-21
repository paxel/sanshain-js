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
    "sanshainjs": "^1.0.0"
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

Typically run on your main branch after tests pass:
```bash
# Ensure SANSHAIN_TOKEN is set
npx sanshain provide
```

### Require (Download Specs)

Typically run before build or code generation:
```bash
npx sanshain require
```

## 4. Environment Variables

| Variable | Description |
|---|---|
| `SANSHAIN_TOKEN` | **Required**. Your authentication token for the Sanshain Service. |
| `SANSHAIN_BRANCH` | Optional. Overrides automatic branch detection. |
| `SANSHAIN_URL` | Optional. Overrides the `sanshainUrl` in `sanshain.yaml`. |

## 5. Branch Detection

The CLI automatically detects the current branch using common CI environment variables:
- `GITHUB_REF_NAME` (GitHub)
- `CI_COMMIT_REF_NAME` (GitLab)
- `GIT_BRANCH` (Jenkins/Bitbucket)

If your CI uses a different variable, you can map it manually:
```bash
env SANSHAIN_BRANCH=$MY_CUSTOM_CI_BRANCH npx sanshain require
```

## 6. How it Works in CI

1. **Isolation**: Every CI run starts with a clean workspace.
2. **Download**: `sanshain require` downloads the specs to the local disk (as configured in `sanshain.yaml`).
3. **Consumption**: Subsequent build steps (like `tsc` or `openapi-typescript`) use these local files.
4. **Cleanup**: Downloaded files are usually ignored by Git and vanish when the CI runner finishes, keeping your repo clean.

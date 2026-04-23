import { simpleGit, SimpleGit } from 'simple-git';

export async function getCurrentBranch(): Promise<string | undefined> {
  // 1. Check SANSHAIN_BRANCH env var
  if (process.env.SANSHAIN_BRANCH) {
    return process.env.SANSHAIN_BRANCH;
  }

  // 2. Check CI environment variables
  const ciBranch = detectBranchFromCI();
  if (ciBranch) {
    return ciBranch;
  }

  // 3. Try git
  try {
    const git: SimpleGit = simpleGit();
    const branchSummary = await git.branch();
    const current = branchSummary.current;
    if (current && current !== 'HEAD') {
      return current;
    }
    // Detached HEAD — try to resolve
    if (current === 'HEAD') {
      const resolved = await resolveBranchFromDetachedHead(git);
      if (resolved) {
        return resolved;
      }
    }
  } catch (error) {
    // ignore
  }

  return undefined;
}

function detectBranchFromCI(): string | undefined {
  // GitHub Actions
  if (process.env.GITHUB_HEAD_REF) return process.env.GITHUB_HEAD_REF;
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;

  // GitLab CI
  if (process.env.CI_COMMIT_BRANCH) return process.env.CI_COMMIT_BRANCH;
  if (process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME) return process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME;

  // Jenkins
  const gitBranch = process.env.GIT_BRANCH;
  if (gitBranch) {
    return gitBranch.startsWith('origin/') ? gitBranch.substring('origin/'.length) : gitBranch;
  }
  if (process.env.BRANCH_NAME) return process.env.BRANCH_NAME;

  // Bitbucket Pipelines
  if (process.env.BITBUCKET_BRANCH) return process.env.BITBUCKET_BRANCH;

  // Azure DevOps
  const sourceBranch = process.env.BUILD_SOURCEBRANCH;
  if (sourceBranch) {
    return sourceBranch.startsWith('refs/heads/') ? sourceBranch.substring('refs/heads/'.length) : sourceBranch;
  }

  // Travis CI
  if (process.env.TRAVIS_BRANCH) return process.env.TRAVIS_BRANCH;

  // CircleCI
  if (process.env.CIRCLE_BRANCH) return process.env.CIRCLE_BRANCH;

  return undefined;
}

async function resolveBranchFromDetachedHead(git: SimpleGit): Promise<string | undefined> {
  try {
    const result = await git.raw(['branch', '-a', '--contains', 'HEAD']);
    const lines = result.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('(') || line.startsWith('* (')) continue;
      const cleaned = line.startsWith('* ') ? line.substring(2) : line;
      if (cleaned.startsWith('remotes/origin/')) {
        const candidate = cleaned.substring('remotes/origin/'.length);
        if (candidate !== 'HEAD') return candidate;
        continue;
      }
      return cleaned;
    }
  } catch (error) {
    // ignore
  }
  return undefined;
}

import { simpleGit, SimpleGit } from 'simple-git';

export async function getCurrentBranch(): Promise<string | undefined> {
  // 1. Check SANSHAIN_BRANCH env var
  if (process.env.SANSHAIN_BRANCH) {
    return process.env.SANSHAIN_BRANCH;
  }

  // 2. Check common CI env vars
  const ciBranch = process.env.GITHUB_REF_NAME || 
                   process.env.CI_COMMIT_REF_NAME || 
                   process.env.GIT_BRANCH;
  if (ciBranch) {
    return ciBranch;
  }

  // 3. Try git
  try {
    const git: SimpleGit = simpleGit();
    const branchSummary = await git.branch();
    return branchSummary.current;
  } catch (error) {
    return undefined;
  }
}

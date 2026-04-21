import { getCurrentBranch } from '../src/git';
import { simpleGit } from 'simple-git';

jest.mock('simple-git');

describe('Git branch detection', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    (simpleGit as jest.Mock).mockReturnValue({
      branch: jest.fn().mockResolvedValue({ current: 'test-git-branch' }),
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return SANSHAIN_BRANCH if set', async () => {
    process.env.SANSHAIN_BRANCH = 'env-branch';
    const branch = await getCurrentBranch();
    expect(branch).toBe('env-branch');
  });

  it('should return GITHUB_REF_NAME if set', async () => {
    delete process.env.SANSHAIN_BRANCH;
    process.env.GITHUB_REF_NAME = 'github-branch';
    const branch = await getCurrentBranch();
    expect(branch).toBe('github-branch');
  });

  it('should return git current branch if no env vars', async () => {
    delete process.env.SANSHAIN_BRANCH;
    delete process.env.GITHUB_REF_NAME;
    const branch = await getCurrentBranch();
    expect(branch).toBe('test-git-branch');
  });

  it('should return undefined if git fails and no env vars', async () => {
    delete process.env.SANSHAIN_BRANCH;
    delete process.env.GITHUB_REF_NAME;
    (simpleGit as jest.Mock).mockReturnValue({
      branch: jest.fn().mockRejectedValue(new Error('Git failed')),
    });
    const branch = await getCurrentBranch();
    expect(branch).toBeUndefined();
  });
});

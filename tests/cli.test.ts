/** End-to-end runs of the CLI against a mocked HTTP layer. */
import fs from 'fs';
import os from 'os';
import path from 'path';

jest.mock('axios');

class ExitCalled extends Error {}

interface RunResult {
  exitCode: number | undefined;
  out: string;
  err: string;
  axios: any;
}

/**
 * Run the CLI once, on a freshly loaded module so commander's option state
 * never carries over between runs. `mock` arranges the HTTP answers.
 */
async function runCli(args: string[], mock: (axios: any) => void = () => {}): Promise<RunResult> {
  let cli: any;
  let axios: any;
  jest.isolateModules(() => {
    axios = require('axios');
    cli = require('../src/cli');
  });
  axios.create.mockReturnValue(axios);
  mock(axios);

  let exitCode: number | undefined;
  const out: string[] = [];
  const err: string[] = [];
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    if (exitCode === undefined) exitCode = code ?? 0;
    throw new ExitCalled();
  }) as any);
  const logSpy = jest.spyOn(console, 'log').mockImplementation((...a: any[]) => {
    out.push(a.join(' '));
  });
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...a: any[]) => {
    err.push(a.join(' '));
  });
  const errorSpy = jest.spyOn(console, 'error').mockImplementation((...a: any[]) => {
    err.push(a.join(' '));
  });
  try {
    await cli.program.parseAsync(['node', 'sanshain', ...args]);
  } catch (e) {
    if (!(e instanceof ExitCalled)) throw e;
  } finally {
    exitSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  }
  return { exitCode, out: out.join('\n'), err: err.join('\n'), axios };
}

const PROVIDE_OK = JSON.stringify({
  version: '1.0.0',
  stability: 'snapshot',
  content_hash: 'sha256:abc',
  changes: { inserts: 1, updates: 0, deletes: 0 }
});

const savedEnv = { ...process.env };
const savedCwd = process.cwd();
let workDir: string; // the working directory the CLI runs in
let projectDir: string; // a different folder holding sanshain.yaml

beforeEach(() => {
  process.env = { ...savedEnv };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SANSHAIN_')) delete process.env[key];
  }
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanshain-cwd-'));
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanshain-project-'));
  process.chdir(workDir);
});

afterEach(() => {
  process.chdir(savedCwd);
  process.env = { ...savedEnv };
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});

function writeProject(yaml: string, files: Record<string, string> = {}): string {
  const configPath = path.join(projectDir, 'sanshain.yaml');
  fs.writeFileSync(configPath, yaml);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(projectDir, name)), { recursive: true });
    fs.writeFileSync(path.join(projectDir, name), content);
  }
  return configPath;
}

describe('paths relative to sanshain.yaml', () => {
  it('provide reads the spec file next to the config, not in the working directory', async () => {
    const config = writeProject(
      'sanshainUrl: http://localhost:3000\nserviceName: svc\nprovide:\n  file: api/openapi.yaml\n',
      { 'api/openapi.yaml': 'openapi: 3.0.3\ninfo:\n  version: 1.0.0\n' }
    );

    const run = await runCli(['-c', config, 'provide'], (axios) => {
      axios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.axios.post).toHaveBeenCalledTimes(1);
    expect(run.axios.post.mock.calls[0][1].openapi_yaml).toBe('openapi: 3.0.3\ninfo:\n  version: 1.0.0\n');
  });

  it('provide names the resolved path when the spec file is missing', async () => {
    const config = writeProject('sanshainUrl: http://localhost:3000\nserviceName: svc\nprovide:\n  file: missing.yaml\n');

    const run = await runCli(['-c', config, 'provide']);

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain(path.join(projectDir, 'missing.yaml'));
  });

  it('an absolute spec path stays absolute', async () => {
    const spec = path.join(workDir, 'abs.yaml');
    fs.writeFileSync(spec, 'openapi: 3.0.3\n');
    const config = writeProject(`sanshainUrl: http://localhost:3000\nserviceName: svc\nprovide:\n  file: ${spec}\n`);

    const run = await runCli(['-c', config, 'provide'], (axios) => {
      axios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.axios.post.mock.calls[0][1].openapi_yaml).toBe('openapi: 3.0.3\n');
  });

  it('require writes into the output directory next to the config', async () => {
    const config = writeProject(
      [
        'sanshainUrl: http://localhost:3000',
        'serviceName: svc',
        'requires:',
        '  - serviceName: users',
        '    version: 1.0.0',
        '    outputDirectory: gen/users',
        '    endpoints:',
        '      - method: GET',
        '        path: /users',
        ''
      ].join('\n')
    );

    const run = await runCli(['-c', config, 'require'], (axios) => {
      axios.get.mockResolvedValue({ status: 200, data: Buffer.from('paths: {}'), headers: {} });
    });

    expect(run.exitCode).toBeUndefined();
    expect(fs.readFileSync(path.join(projectDir, 'gen/users/users.yaml'), 'utf8')).toBe('paths: {}');
    expect(fs.existsSync(path.join(workDir, 'gen'))).toBe(false);
  });
});

describe('SANSHAIN_URL precedence', () => {
  const yaml = 'sanshainUrl: http://from-yaml\nserviceName: svc\nprovide:\n  file: openapi.yaml\n';
  const ok = (axios: any) => axios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });
  const baseUrl = (run: RunResult) => run.axios.create.mock.calls[0][0].baseURL;

  it('uses sanshainUrl from the yaml without flag or environment', async () => {
    const config = writeProject(yaml, { 'openapi.yaml': 'openapi: 3.0.3\n' });
    expect(baseUrl(await runCli(['-c', config, 'provide'], ok))).toBe('http://from-yaml');
  });

  it('SANSHAIN_URL overrides the yaml', async () => {
    const config = writeProject(yaml, { 'openapi.yaml': 'openapi: 3.0.3\n' });
    process.env.SANSHAIN_URL = 'http://from-env';
    expect(baseUrl(await runCli(['-c', config, 'provide'], ok))).toBe('http://from-env');
  });

  it('the --url flag overrides SANSHAIN_URL', async () => {
    const config = writeProject(yaml, { 'openapi.yaml': 'openapi: 3.0.3\n' });
    process.env.SANSHAIN_URL = 'http://from-env';
    expect(baseUrl(await runCli(['-c', config, '--url', 'http://from-flag', 'provide'], ok))).toBe('http://from-flag');
  });
});

describe('SANSHAIN_BEST_EFFORT on the command line', () => {
  it.each(['1', 'TRUE', ' true '])('%j turns a failed provide into a warning', async (value) => {
    const config = writeProject('sanshainUrl: http://localhost:3000\nserviceName: svc\nprovide:\n  file: missing.yaml\n');
    process.env.SANSHAIN_BEST_EFFORT = value;
    const run = await runCli(['-c', config, 'provide']);
    expect(run.exitCode).toBeUndefined();
  });

  it('"yes" is off', async () => {
    const config = writeProject('sanshainUrl: http://localhost:3000\nserviceName: svc\nprovide:\n  file: missing.yaml\n');
    process.env.SANSHAIN_BEST_EFFORT = 'yes';
    const run = await runCli(['-c', config, 'provide']);
    expect(run.exitCode).toBe(1);
  });
});

describe('unknown fields on the command line', () => {
  it('without strict: one cat on stderr, then the provide runs normally', async () => {
    const config = writeProject('sanshainUrl: http://localhost:3000\nserviceName: svc\ncatalogInf: x\nprovide:\n  file: openapi.yaml\n', {
      'openapi.yaml': 'openapi: 3.0.3\n'
    });

    const run = await runCli(['-c', config, 'provide'], (axios) => {
      axios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });
    });

    expect(run.exitCode).toBeUndefined();
    expect(run.axios.post).toHaveBeenCalledTimes(1);
    expect(run.err.match(/O_o/g)).toHaveLength(1);
    expect(run.err).toContain("sanshain.yaml: unknown field 'catalogInf' - ignored");
  });

  it('strict fails the command even under best-effort', async () => {
    const config = writeProject(
      'sanshainUrl: http://localhost:3000\nserviceName: svc\nstrict: true\ncatalogInf: x\nprovide:\n  file: openapi.yaml\n',
      { 'openapi.yaml': 'openapi: 3.0.3\n' }
    );

    const run = await runCli(['-c', config, '--best-effort', 'require']);

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain("sanshain.yaml: unknown field 'catalogInf' - rejected (strict)");
    expect(run.err).not.toContain('Continuing (best effort)');
  });
});

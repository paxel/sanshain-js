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

describe('catalog', () => {
  const CATALOG = 'apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: orders-service\n';
  const yaml = (extra = 'catalogInfo: backstage/catalog-info.yaml\n') =>
    `sanshainUrl: http://localhost:3000\nserviceName: orders-service\n${extra}`;
  const recorded = (trunk: boolean) => ({
    status: 200,
    data: JSON.stringify({
      system: 'orders-service',
      trunk,
      resources: ['resource:default/orders-db', 'resource:default/orders-bucket']
    }),
    headers: {}
  });
  const httpError = (status: number, body: unknown) => ({
    response: { status, data: JSON.stringify(body), headers: {} }
  });

  it('a plain build pushes the file relative to sanshain.yaml, without trunk or tag', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const run = await runCli(['-c', config, 'catalog'], (axios) => axios.put.mockResolvedValue(recorded(false)));

    expect(run.exitCode).toBeUndefined();
    expect(run.axios.put).toHaveBeenCalledTimes(1);
    expect(run.axios.put.mock.calls[0][0]).toBe('/catalog/orders-service');
    expect(run.axios.put.mock.calls[0][1]).toEqual({ catalog_info_yaml: CATALOG });
  });

  it('a trunk build sends trunk: true', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const run = await runCli(['-c', config, '--trunk', 'catalog'], (axios) => axios.put.mockResolvedValue(recorded(true)));

    expect(run.axios.put.mock.calls[0][1]).toEqual({ catalog_info_yaml: CATALOG, trunk: true });
  });

  it('SANSHAIN_TRUNK=1 is a trunk build too', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });
    process.env.SANSHAIN_TRUNK = '1';

    const run = await runCli(['-c', config, 'catalog'], (axios) => axios.put.mockResolvedValue(recorded(true)));

    expect(run.axios.put.mock.calls[0][1]).toEqual({ catalog_info_yaml: CATALOG, trunk: true });
  });

  it('a tag build sends neither trunk nor tag', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const run = await runCli(['-c', config, '--tag', 'R1', 'catalog'], (axios) =>
      axios.put.mockResolvedValue(recorded(false))
    );

    expect(run.exitCode).toBeUndefined();
    expect(run.axios.put.mock.calls[0][1]).toEqual({ catalog_info_yaml: CATALOG });
  });

  it('URL-encodes the service name', async () => {
    const config = writeProject(
      'sanshainUrl: http://localhost:3000\nserviceName: team/orders service\ncatalogInfo: c.yaml\n',
      { 'c.yaml': CATALOG }
    );

    const run = await runCli(['-c', config, 'catalog'], (axios) => axios.put.mockResolvedValue(recorded(false)));

    expect(run.axios.put.mock.calls[0][0]).toBe('/catalog/team%2Forders%20service');
  });

  it('gzips the payload when compression is on', async () => {
    const config = writeProject(yaml('catalogInfo: c.yaml\ncompression: true\n'), { 'c.yaml': CATALOG });

    const run = await runCli(['-c', config, 'catalog'], (axios) => axios.put.mockResolvedValue(recorded(false)));

    const [, body, options] = run.axios.put.mock.calls[0];
    expect(options.headers['Content-Encoding']).toBe('gzip');
    expect(JSON.parse(require('zlib').gunzipSync(body).toString('utf8'))).toEqual({ catalog_info_yaml: CATALOG });
  });

  it('prints the recorded resources on 200', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const trunkRun = await runCli(['-c', config, '--trunk', 'catalog'], (axios) =>
      axios.put.mockResolvedValue(recorded(true))
    );
    expect(trunkRun.out).toContain(
      'Catalog recorded for orders-service (main+dev): 2 resources\n  resource:default/orders-db\n  resource:default/orders-bucket'
    );

    const devRun = await runCli(['-c', config, 'catalog'], (axios) => axios.put.mockResolvedValue(recorded(false)));
    expect(devRun.out).toContain('Catalog recorded for orders-service (dev): 2 resources');
  });

  it('fails on 400 naming the file and the metadata.name rule', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const run = await runCli(['-c', config, 'catalog'], (axios) =>
      axios.put.mockRejectedValue(httpError(400, { error: "no Component named 'orders-service'" }))
    );

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain(
      "Sanshain rejected backstage/catalog-info.yaml: no Component named 'orders-service'. " +
        "The Component's metadata.name must equal serviceName 'orders-service'."
    );
  });

  it('best-effort turns a 400 into a warning and exits 0', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const run = await runCli(['-c', config, '--best-effort', 'catalog'], (axios) =>
      axios.put.mockRejectedValue(httpError(400, { error: 'bad' }))
    );

    expect(run.exitCode).toBeUndefined();
    expect(run.err).toContain('Sanshain rejected backstage/catalog-info.yaml: bad.');
    expect(run.err).toContain('Continuing (best effort)');
  });

  it('a 404 says the command needs Sanshain Service 2.4.0, naming the server version', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const run = await runCli(['-c', config, 'catalog'], (axios) => {
      axios.put.mockRejectedValue(httpError(404, { error: 'not found' }));
      axios.get.mockResolvedValue({ status: 200, data: JSON.stringify({ version: '2.3.0' }), headers: {} });
    });

    expect(run.exitCode).toBe(1);
    expect(run.axios.get).toHaveBeenCalledWith('/version', expect.any(Object));
    expect(run.err).toContain('sanshain catalog needs Sanshain Service 2.4.0 or later (server is 2.3.0)');
  });

  it('a 404 with an unknown server version says so', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const run = await runCli(['-c', config, 'catalog'], (axios) => {
      axios.put.mockRejectedValue(httpError(404, {}));
      axios.get.mockRejectedValue(new Error('connection refused'));
    });

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain('sanshain catalog needs Sanshain Service 2.4.0 or later (server version unknown)');
  });

  it('other failures use the normal error mapping', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const run = await runCli(['-c', config, 'catalog'], (axios) => {
      axios.put.mockRejectedValue(httpError(500, { error: 'boom' }));
      axios.get.mockResolvedValue({ status: 200, data: JSON.stringify({ version: '2.4.0' }), headers: {} });
    });

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain('Request failed with status 500');
  });

  it('without catalogInfo: warns and exits 0, sending nothing', async () => {
    const config = writeProject(yaml(''));

    const run = await runCli(['-c', config, 'catalog']);

    expect(run.exitCode).toBeUndefined();
    expect(run.err).toContain('No catalogInfo in sanshain.yaml - skipping catalog.');
    expect(run.axios.put).not.toHaveBeenCalled();
  });

  it('without catalogInfo under strict: fails', async () => {
    const config = writeProject(yaml('strict: true\n'));

    const run = await runCli(['-c', config, 'catalog']);

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain('strict: sanshain.yaml has no catalogInfo');
  });

  it('strict does not ask for provides or requires', async () => {
    const config = writeProject(yaml('catalogInfo: c.yaml\nstrict: true\n'), { 'c.yaml': CATALOG });

    const run = await runCli(['-c', config, 'catalog'], (axios) => axios.put.mockResolvedValue(recorded(false)));

    expect(run.exitCode).toBeUndefined();
    expect(run.axios.put).toHaveBeenCalledTimes(1);
  });

  it('a missing file fails naming the resolved path', async () => {
    const config = writeProject(yaml());

    const run = await runCli(['-c', config, 'catalog']);

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain(path.join(projectDir, 'backstage/catalog-info.yaml'));
    expect(run.axios.put).not.toHaveBeenCalled();
  });

  it('a missing file under best-effort warns and exits 0', async () => {
    const config = writeProject(yaml());
    process.env.SANSHAIN_BEST_EFFORT = 'true';

    const run = await runCli(['-c', config, 'catalog']);

    expect(run.exitCode).toBeUndefined();
    expect(run.err).toContain(path.join(projectDir, 'backstage/catalog-info.yaml'));
  });
});

describe('version', () => {
  it('--version reports the package version', () => {
    const { program } = require('../src/cli');
    expect(program.version()).toBe(require('../package.json').version);
  });
});

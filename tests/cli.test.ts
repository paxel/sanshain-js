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
  // The automocked axios is shared between isolated registries: start clean.
  jest.clearAllMocks();
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

describe('the origin of a provide', () => {
  it('sends --tickets and --note and omits what is unknown', async () => {
    const saved = { ...process.env };
    for (const k of ['GITHUB_SERVER_URL', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_REF', 'CI_JOB_URL',
      'CI_MERGE_REQUEST_PROJECT_URL', 'CI_MERGE_REQUEST_IID', 'BUILD_URL', 'CHANGE_URL',
      'SANSHAIN_BUILD_URL', 'SANSHAIN_CHANGE_URL', 'SANSHAIN_TICKETS', 'SANSHAIN_NOTE']) {
      delete process.env[k];
    }
    try {
      const config = writeProject(
        'sanshainUrl: http://localhost:3000\nserviceName: svc\nprovide:\n  file: openapi.yaml\n',
        { 'openapi.yaml': 'openapi: 3.0.3\ninfo:\n  version: 1.0.0\n' }
      );
      const run = await runCli(['-c', config, '--tickets', 'ORD-7,ORD-9', '--note', 'Adds users', 'provide'], (axios) => {
        axios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });
      });
      expect(run.exitCode).toBeUndefined();
      const payload = run.axios.post.mock.calls[0][1];
      expect(payload.tickets).toEqual(['ORD-7', 'ORD-9']);
      expect(payload.note).toBe('Adds users');
      expect('build_url' in payload).toBe(false);
      expect('change_url' in payload).toBe(false);
    } finally {
      process.env = saved;
    }
  });
});

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
  it('the cat shows on the best-effort fallback when a later validation error follows', async () => {
    const config = writeProject(
      [
        'sanshainUrl: http://localhost:3000',
        'serviceName: svc',
        'requires:',
        '  - serviceName: users',
        '    verison: 1.0.0',
        '    outputDirectory: gen',
        '    endpoints:',
        '      - method: GET',
        '        path: /users',
        ''
      ].join('\n')
    );

    const run = await runCli(['-c', config, '--best-effort', 'require']);

    expect(run.exitCode).toBeUndefined();
    expect(run.err).toContain("sanshain.yaml: unknown field 'requires[0].verison' - ignored");
    expect(run.err).toContain("missing 'version'");
  });

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

  it('a 400 (only an old pre-release service sends one) uses the normal error mapping', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const run = await runCli(['-c', config, 'catalog'], (axios) => {
      axios.put.mockRejectedValue(httpError(400, { error: 'bad' }));
      axios.get.mockResolvedValue({ status: 200, data: JSON.stringify({ version: '2.4.0' }), headers: {} });
    });

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain('Request failed with status 400');
  });

  it('best-effort turns that 400 into a warning and exits 0', async () => {
    const config = writeProject(yaml(), { 'backstage/catalog-info.yaml': CATALOG });

    const run = await runCli(['-c', config, '--best-effort', 'catalog'], (axios) => {
      axios.put.mockRejectedValue(httpError(400, { error: 'bad' }));
      axios.get.mockResolvedValue({ status: 200, data: JSON.stringify({ version: '2.4.0' }), headers: {} });
    });

    expect(run.exitCode).toBeUndefined();
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

describe('no provide skip, no dry-run caching', () => {
  const PROVIDE_YAML = 'sanshainUrl: http://localhost:3000\nserviceName: svc\nprovide:\n  file: openapi.yaml\n';
  // The server answers the real content hash, which is what the old local
  // skip compared against.
  const SPEC = 'openapi: 3.0.3\n';
  const ok = (axios: any) =>
    axios.post.mockResolvedValue({
      status: 202,
      data: JSON.stringify({
        ...JSON.parse(PROVIDE_OK),
        content_hash: 'sha256:' + require('crypto').createHash('sha256').update(SPEC, 'utf8').digest('hex')
      }),
      headers: {}
    });
  const statePath = () => path.join(workDir, 'node_modules/.cache/sanshain/state.json');

  it('a dry-run provide does not stop the following real provide from uploading', async () => {
    const config = writeProject(PROVIDE_YAML, { 'openapi.yaml': 'openapi: 3.0.3\n' });

    const dry = await runCli(['-c', config, 'provide', '--dry-run'], ok);
    expect(dry.axios.post).toHaveBeenCalledTimes(1);
    expect(dry.axios.post.mock.calls[0][1].dry_run).toBe(true);

    const real = await runCli(['-c', config, 'provide'], ok);
    expect(real.exitCode).toBeUndefined();
    expect(real.axios.post).toHaveBeenCalledTimes(1);
    expect(real.axios.post.mock.calls[0][1].dry_run).toBe(false);
    expect(real.out).not.toContain('unchanged');
  });

  it('two consecutive provides of the same file both upload', async () => {
    const config = writeProject(PROVIDE_YAML, { 'openapi.yaml': 'openapi: 3.0.3\n' });

    const first = await runCli(['-c', config, 'provide'], ok);
    expect(first.axios.post).toHaveBeenCalledTimes(1);

    const second = await runCli(['-c', config, 'provide'], ok);
    expect(second.axios.post).toHaveBeenCalledTimes(1);
  });

  it('a provides entry left in an old state.json is ignored', async () => {
    const config = writeProject(PROVIDE_YAML, { 'openapi.yaml': 'openapi: 3.0.3\n' });
    fs.mkdirSync(path.dirname(statePath()), { recursive: true });
    fs.writeFileSync(
      statePath(),
      JSON.stringify({
        provides: { 'openapi.yaml': { content_hash: 'sha256:' + require('crypto').createHash('sha256').update(SPEC, 'utf8').digest('hex'), version: '1.0.0', last_provided: '2026-01-01T00:00:00Z' } },
        requires: {}
      })
    );

    const run = await runCli(['-c', config, 'provide'], ok);

    expect(run.exitCode).toBeUndefined();
    expect(run.axios.post).toHaveBeenCalledTimes(1);
  });

  const REQUIRE_YAML = [
    'sanshainUrl: http://localhost:3000',
    'serviceName: svc',
    'requires:',
    '  - serviceName: users',
    '    version: 1.0.0',
    '    outputDirectory: gen',
    '    endpoints:',
    '      - method: GET',
    '        path: /users',
    ''
  ].join('\n');
  const withEtag = (axios: any) =>
    axios.get.mockResolvedValue({ status: 200, data: Buffer.from('paths: {}'), headers: { etag: '"sha256:e1"' } });
  const sentEtag = (run: RunResult) => run.axios.get.mock.calls[0][1].headers['If-None-Match'];

  it('a dry-run require records no ETag', async () => {
    const config = writeProject(REQUIRE_YAML);

    const dry = await runCli(['-c', config, 'require', '--dry-run'], withEtag);
    expect(dry.exitCode).toBeUndefined();
    expect(fs.existsSync(statePath())).toBe(false);

    const real = await runCli(['-c', config, 'require'], withEtag);
    expect(sentEtag(real)).toBeUndefined();
  });

  it('a normal require still sends the stored ETag as If-None-Match', async () => {
    const config = writeProject(REQUIRE_YAML);

    const first = await runCli(['-c', config, 'require'], withEtag);
    expect(sentEtag(first)).toBeUndefined();
    const second = await runCli(['-c', config, 'require'], (axios) =>
      axios.get.mockResolvedValue({ status: 304, data: Buffer.from(''), headers: {} })
    );

    expect(sentEtag(second)).toBe('"sha256:e1"');
    expect(second.out).toContain('unchanged (304)');
  });
});

describe('format: openapi on asyncapi requires', () => {
  const OPENAPI = 'openapi: 3.0.3\npaths: {}\n';
  const ASYNCAPI = 'asyncapi: 2.6.0\nchannels: {}\n';
  const entry = (extra: string, endpoints = 1) =>
    [
      'sanshainUrl: http://localhost:3000',
      'serviceName: svc',
      'requires:',
      '  - serviceName: events',
      '    version: 1.0.0',
      '    outputDirectory: gen',
      extra,
      '    endpoints:',
      ...Array.from({ length: endpoints }, (_, i) => `      - method: SUB\n        path: user/signup${i}`),
      ''
    ]
      .filter((line) => line !== '')
      .join('\n') + '\n';
  const answer = (body: string, etag?: string) => ({
    status: 200,
    data: Buffer.from(body),
    headers: etag ? { etag } : {}
  });
  const output = (name: string) => path.join(projectDir, 'gen', name);

  it('the single-endpoint call carries format=openapi and writes the usual file', async () => {
    const config = writeProject(entry('    apiType: asyncapi\n    format: openapi'));

    const run = await runCli(['-c', config, 'require'], (axios) => axios.get.mockResolvedValue(answer(OPENAPI)));

    expect(run.exitCode).toBeUndefined();
    expect(run.err).not.toContain('O_o');
    expect(run.axios.get.mock.calls[0][0]).toBe('/require/asyncapi');
    expect(run.axios.get.mock.calls[0][1].params.format).toBe('openapi');
    expect(fs.readFileSync(output('events.yaml'), 'utf8')).toBe(OPENAPI);
  });

  it('the bundle call carries format=openapi as a query parameter', async () => {
    const config = writeProject(entry('    apiType: asyncapi\n    format: openapi', 2));

    const run = await runCli(['-c', config, 'require'], (axios) => axios.post.mockResolvedValue(answer(OPENAPI)));

    expect(run.exitCode).toBeUndefined();
    const [url, body, options] = run.axios.post.mock.calls[0];
    expect(url).toBe('/require-bundle');
    expect(options.params).toEqual({ format: 'openapi' });
    expect(body).not.toHaveProperty('format');
    expect(fs.readFileSync(output('events_bundle.yaml'), 'utf8')).toBe(OPENAPI);
  });

  it('without format nothing is sent', async () => {
    const single = writeProject(entry('    apiType: asyncapi'));
    const run = await runCli(['-c', single, 'require'], (axios) => axios.get.mockResolvedValue(answer(ASYNCAPI)));
    expect(run.exitCode).toBeUndefined();
    expect(run.axios.get.mock.calls[0][1].params).not.toHaveProperty('format');

    const bundle = writeProject(entry('    apiType: asyncapi', 2));
    const bundleRun = await runCli(['-c', bundle, 'require'], (axios) => axios.post.mockResolvedValue(answer(ASYNCAPI)));
    expect(bundleRun.exitCode).toBeUndefined();
    expect(bundleRun.axios.post.mock.calls[0][2]).not.toHaveProperty('params');
  });

  it('format with another apiType is rejected before any call', async () => {
    const config = writeProject(entry('    apiType: openapi\n    format: openapi'));

    const run = await runCli(['-c', config, 'require']);

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain("requires[0] (events): format 'openapi' with apiType 'openapi' is not supported");
    expect(run.err).toContain("'format: openapi' with 'apiType: asyncapi'");
    expect(run.axios.get).not.toHaveBeenCalled();
    expect(run.axios.post).not.toHaveBeenCalled();
  });

  it('format without apiType is rejected too', async () => {
    const config = writeProject(entry('    format: openapi'));
    const run = await runCli(['-c', config, 'require']);
    expect(run.exitCode).toBe(1);
    expect(run.err).toContain("requires[0] (events): format 'openapi' with apiType 'openapi' is not supported");
  });

  it('an unknown format value is rejected before any call', async () => {
    const config = writeProject(entry('    apiType: asyncapi\n    format: proto'));

    const run = await runCli(['-c', config, 'require']);

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain("requires[0] (events): format 'proto' with apiType 'asyncapi' is not supported");
    expect(run.axios.get).not.toHaveBeenCalled();
  });

  it('a non-OpenAPI answer means the service is too old, naming its version', async () => {
    const config = writeProject(entry('    apiType: asyncapi\n    format: openapi'));

    const run = await runCli(['-c', config, 'require'], (axios) =>
      axios.get.mockImplementation(async (url: string) =>
        url === '/version'
          ? { status: 200, data: JSON.stringify({ version: '2.3.0' }), headers: {} }
          : answer(ASYNCAPI)
      )
    );

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain('format: openapi needs Sanshain Service 2.4.0 or later (server is 2.3.0)');
    expect(fs.existsSync(output('events.yaml'))).toBe(false);
  });

  it('a non-OpenAPI answer with an unknown server version says so', async () => {
    const config = writeProject(entry('    apiType: asyncapi\n    format: openapi', 2));

    const run = await runCli(['-c', config, 'require'], (axios) => {
      axios.post.mockResolvedValue(answer(ASYNCAPI));
      axios.get.mockRejectedValue(new Error('connection refused'));
    });

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain('format: openapi needs Sanshain Service 2.4.0 or later (server version unknown)');
    expect(fs.existsSync(output('events_bundle.yaml'))).toBe(false);
  });

  it('best-effort turns the non-OpenAPI answer into a warning and writes nothing', async () => {
    const config = writeProject(entry('    apiType: asyncapi\n    format: openapi'));

    const run = await runCli(['-c', config, '--best-effort', 'require'], (axios) =>
      axios.get.mockImplementation(async (url: string) =>
        url === '/version'
          ? { status: 200, data: JSON.stringify({ version: '2.3.0' }), headers: {} }
          : answer(ASYNCAPI)
      )
    );

    expect(run.exitCode).toBeUndefined();
    expect(run.err).toContain('format: openapi needs Sanshain Service 2.4.0 or later (server is 2.3.0)');
    expect(run.err).toContain('Continuing (best effort)');
    expect(fs.existsSync(output('events.yaml'))).toBe(false);
  });

  const rejectFormat = (serverVersion: string | null, error: string) => (axios: any) =>
    axios.get.mockImplementation(async (url: string) => {
      if (url === '/version') {
        if (serverVersion === null) throw new Error('connection refused');
        return { status: 200, data: JSON.stringify({ version: serverVersion }), headers: {} };
      }
      throw { response: { status: 400, data: JSON.stringify({ error }), headers: {} } };
    });

  it('a 400 on the single route from a pre-2.4.0 service means it needs 2.4.0', async () => {
    const config = writeProject(entry('    apiType: asyncapi\n    format: openapi'));

    const run = await runCli(['-c', config, 'require'], rejectFormat('2.3.0', 'unknown field `format`'));

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain('format: openapi needs Sanshain Service 2.4.0 or later (server is 2.3.0)');
    expect(run.err).not.toContain('unknown field');
    expect(fs.existsSync(output('events.yaml'))).toBe(false);
  });

  it('the same 400 with /version failing says the server version is unknown', async () => {
    const config = writeProject(entry('    apiType: asyncapi\n    format: openapi'));

    const run = await runCli(['-c', config, 'require'], rejectFormat(null, 'unknown field `format`'));

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain('format: openapi needs Sanshain Service 2.4.0 or later (server version unknown)');
  });

  it("a 2.4.0 service's own 400 passes through unchanged", async () => {
    const config = writeProject(entry('    apiType: asyncapi\n    format: openapi'));
    const conversion = 'cannot render format openapi: message payload is Avro';

    const run = await runCli(['-c', config, 'require'], rejectFormat('2.4.0', conversion));

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain(conversion);
    expect(run.err).not.toContain('needs Sanshain Service 2.4.0');
  });

  it('best-effort turns the old-service 400 into a warning and writes nothing', async () => {
    const config = writeProject(entry('    apiType: asyncapi\n    format: openapi'));

    const run = await runCli(['-c', config, '--best-effort', 'require'], rejectFormat('2.3.0', 'unknown field `format`'));

    expect(run.exitCode).toBeUndefined();
    expect(run.err).toContain('format: openapi needs Sanshain Service 2.4.0 or later (server is 2.3.0)');
    expect(run.err).toContain('Continuing (best effort)');
    expect(fs.existsSync(output('events.yaml'))).toBe(false);
  });

  it('the ETag is kept per format', async () => {
    const withFormat = entry('    apiType: asyncapi\n    format: openapi');
    const without = entry('    apiType: asyncapi');
    const sent = (run: RunResult) => run.axios.get.mock.calls[0][1].headers['If-None-Match'];

    const first = await runCli(['-c', writeProject(withFormat), 'require'], (axios) =>
      axios.get.mockResolvedValue(answer(OPENAPI, '"openapi-etag"'))
    );
    expect(sent(first)).toBeUndefined();

    const plain = await runCli(['-c', writeProject(without), 'require'], (axios) =>
      axios.get.mockResolvedValue(answer(ASYNCAPI, '"asyncapi-etag"'))
    );
    expect(sent(plain)).toBeUndefined();

    const again = await runCli(['-c', writeProject(withFormat), 'require'], (axios) =>
      axios.get.mockResolvedValue({ status: 304, data: Buffer.from(''), headers: {} })
    );
    expect(sent(again)).toBe('"openapi-etag"');

    const plainAgain = await runCli(['-c', writeProject(without), 'require'], (axios) =>
      axios.get.mockResolvedValue({ status: 304, data: Buffer.from(''), headers: {} })
    );
    expect(sent(plainAgain)).toBe('"asyncapi-etag"');
  });
});

describe('Sanshain-Warning', () => {
  const NO_BRANCH = "no sanshain-branch 'R9' - this build was not recorded in a release graph";
  const BOTH = 'trunk and tag are mutually exclusive - this build is recorded in neither';
  const PROVIDE_YAML = 'sanshainUrl: http://localhost:3000\nserviceName: svc\nprovide:\n  file: openapi.yaml\n';
  const SPEC = { 'openapi.yaml': 'openapi: 3.0.3\n' };
  const warned = (warning: string | string[], data = PROVIDE_OK, status = 202) => ({
    status,
    data,
    headers: { 'sanshain-warning': warning }
  });

  it('provide prints a single warning and exits 0', async () => {
    const config = writeProject(PROVIDE_YAML, SPEC);

    const run = await runCli(['-c', config, '--tag', 'R9', 'provide'], (axios) =>
      axios.post.mockResolvedValue(warned(NO_BRANCH))
    );

    expect(run.exitCode).toBeUndefined();
    expect(run.err).toContain(`⚠ ${NO_BRANCH}`);
    expect(run.out).toContain('Successfully provided spec(s).');
  });

  it('prints every header line once, never splitting one on its commas', async () => {
    const config = writeProject(PROVIDE_YAML, SPEC);

    const run = await runCli(['-c', config, 'provide'], (axios) =>
      axios.post.mockResolvedValue(warned(['first, with a comma', 'second']))
    );

    expect(run.exitCode).toBeUndefined();
    expect(run.err.split('\n').filter((l) => l.startsWith('⚠'))).toEqual(['⚠ first, with a comma', '⚠ second']);
  });

  it('strict fails after the call with the first warning', async () => {
    const config = writeProject(`${PROVIDE_YAML}strict: true\n`, SPEC);

    const run = await runCli(['-c', config, 'provide'], (axios) =>
      axios.post.mockResolvedValue(warned([NO_BRANCH, 'second']))
    );

    expect(run.exitCode).toBe(1);
    expect(run.axios.post).toHaveBeenCalledTimes(1);
    expect(run.err).toContain('⚠ second');
    expect(run.err).toContain(`strict: Sanshain warned: ${NO_BRANCH}`);
    expect(run.err).not.toContain('Continuing (best effort)');
  });

  it('best-effort does not soften strict', async () => {
    const config = writeProject(`${PROVIDE_YAML}strict: true\n`, SPEC);

    const run = await runCli(['-c', config, '--best-effort', 'provide'], (axios) =>
      axios.post.mockResolvedValue(warned(NO_BRANCH))
    );

    expect(run.exitCode).toBe(1);
    expect(run.err).toContain(`strict: Sanshain warned: ${NO_BRANCH}`);
  });

  it('an error response carrying a warning prints it, and under strict the error before the strict failure', async () => {
    const config = writeProject(PROVIDE_YAML, SPEC);
    const failing = (axios: any) => {
      axios.post.mockRejectedValue({
        response: { status: 500, data: JSON.stringify({ error: 'boom' }), headers: { 'sanshain-warning': 'a, b' } }
      });
      axios.get.mockResolvedValue({ status: 200, data: JSON.stringify({ version: '2.4.0' }), headers: {} });
    };

    const plain = await runCli(['-c', config, 'provide'], failing);
    expect(plain.exitCode).toBe(1);
    expect(plain.err).toContain('⚠ a, b');
    expect(plain.err).toContain('Error providing spec: Request failed with status 500');

    writeProject(`${PROVIDE_YAML}strict: true\n`, SPEC);
    const strict = await runCli(['-c', config, 'provide'], failing);
    expect(strict.exitCode).toBe(1);
    const error = strict.err.indexOf('Request failed with status 500');
    const failure = strict.err.indexOf('strict: Sanshain warned: a, b');
    expect(error).toBeGreaterThanOrEqual(0);
    expect(failure).toBeGreaterThan(error);
  });

  it('retire prints the warning too', async () => {
    const config = writeProject(
      'sanshainUrl: http://localhost:3000\nserviceName: svc\nprovides:\n  - apiType: asyncapi\n    retired: true\n'
    );

    const run = await runCli(['-c', config, 'provide'], (axios) =>
      axios.post.mockResolvedValue(warned('retire warning', JSON.stringify({ trunk_pins_closed: 0, contracts_released: 0 })))
    );

    expect(run.exitCode).toBeUndefined();
    expect(run.err).toContain('⚠ retire warning');
  });

  describe('on require', () => {
    const requireYaml = (endpoints: string, extra = '') =>
      'sanshainUrl: http://localhost:3000\nserviceName: svc\nrequires:\n  - serviceName: up\n    version: 1.0.0\n' +
      `    outputDirectory: out\n    endpoints:\n${endpoints}${extra}`;
    const ONE = '      - method: GET\n        path: /a\n';
    const TWO = `${ONE}      - method: GET\n        path: /b\n`;

    it('the single require prints the warning and writes the file', async () => {
      const config = writeProject(requireYaml(ONE));

      const run = await runCli(['-c', config, '--tag', 'R9', 'require'], (axios) =>
        axios.get.mockResolvedValue(warned(NO_BRANCH, Buffer.from('paths: {}') as any, 200))
      );

      expect(run.exitCode).toBeUndefined();
      expect(run.err).toContain(`⚠ ${NO_BRANCH}`);
      expect(fs.existsSync(path.join(projectDir, 'out/up.yaml'))).toBe(true);
    });

    it('the bundle under strict and best-effort fails and writes nothing', async () => {
      const config = writeProject(requireYaml(TWO, 'strict: true\nbestEffort: true\n'));

      const run = await runCli(['-c', config, '--tag', 'R9', 'require'], (axios) =>
        axios.post.mockResolvedValue(warned(NO_BRANCH, Buffer.from('paths: {}') as any, 200))
      );

      expect(run.exitCode).toBe(1);
      expect(run.err).toContain(`strict: Sanshain warned: ${NO_BRANCH}`);
      expect(fs.existsSync(path.join(projectDir, 'out/up_bundle.yaml'))).toBe(false);
    });
  });

  describe('local trunk and tag', () => {
    it('warns, sends neither and exits 0', async () => {
      const config = writeProject(PROVIDE_YAML, SPEC);

      const run = await runCli(['-c', config, '--trunk', '--tag', 'R1', 'provide'], (axios) =>
        axios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} })
      );

      expect(run.exitCode).toBeUndefined();
      expect(run.err).toContain(`⚠ ${BOTH}`);
      const sent = run.axios.post.mock.calls[0][1];
      expect(sent).not.toHaveProperty('trunk');
      expect(sent).not.toHaveProperty('tag');
    });

    it('from the environment as well', async () => {
      const config = writeProject(PROVIDE_YAML, SPEC);
      process.env.SANSHAIN_TRUNK = 'true';
      process.env.SANSHAIN_TAG = 'R1';

      const run = await runCli(['-c', config, 'provide'], (axios) =>
        axios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} })
      );

      expect(run.exitCode).toBeUndefined();
      expect(run.err).toContain(`⚠ ${BOTH}`);
      expect(run.axios.post.mock.calls[0][1]).not.toHaveProperty('trunk');
    });

    it('under strict fails before any request, even with best-effort', async () => {
      const config = writeProject(`${PROVIDE_YAML}strict: true\nbestEffort: true\n`, SPEC);

      const run = await runCli(['-c', config, '--trunk', '--tag', 'R1', 'provide']);

      expect(run.exitCode).toBe(1);
      expect(run.err).toContain(`strict: ${BOTH}`);
      expect(run.err).not.toContain('Sanshain warned');
      expect(run.axios.post).not.toHaveBeenCalled();
    });
  });

  describe('on catalog', () => {
    const CATALOG_YAML = 'sanshainUrl: http://localhost:3000\nserviceName: orders-service\ncatalogInfo: c.yaml\n';
    const FILES = { 'c.yaml': 'kind: Component\n' };
    const notRecorded = (headers: Record<string, unknown> = {}) => ({
      status: 200,
      data: JSON.stringify({ system: 'orders-service', trunk: false, resources: [], recorded: false }),
      headers
    });
    const REASON = "no Component named 'orders-service'";

    it('recorded: false prints the reason from the header and exits 0', async () => {
      const config = writeProject(CATALOG_YAML, FILES);

      const run = await runCli(['-c', config, 'catalog'], (axios) =>
        axios.put.mockResolvedValue(notRecorded({ 'sanshain-warning': REASON }))
      );

      expect(run.exitCode).toBeUndefined();
      expect(run.err).toContain(`⚠ ${REASON}`);
      expect(run.out).not.toContain('Catalog recorded');
    });

    it('recorded: false without a header still warns', async () => {
      const config = writeProject(CATALOG_YAML, FILES);

      const run = await runCli(['-c', config, 'catalog'], (axios) => axios.put.mockResolvedValue(notRecorded()));

      expect(run.exitCode).toBeUndefined();
      expect(run.err).toContain(`⚠ Sanshain did not record ${path.join(projectDir, 'c.yaml')}`);
    });

    it('recorded: false under strict fails', async () => {
      const config = writeProject(`${CATALOG_YAML}strict: true\n`, FILES);

      const run = await runCli(['-c', config, 'catalog'], (axios) =>
        axios.put.mockResolvedValue(notRecorded({ 'sanshain-warning': REASON }))
      );

      expect(run.exitCode).toBe(1);
      expect(run.err).toContain(`strict: Sanshain warned: ${REASON}`);
    });

    it('recorded missing counts as recorded', async () => {
      const config = writeProject(CATALOG_YAML, FILES);

      const run = await runCli(['-c', config, 'catalog'], (axios) =>
        axios.put.mockResolvedValue({
          status: 200,
          data: JSON.stringify({ system: 'orders-service', trunk: false, resources: ['resource:default/db'] }),
          headers: {}
        })
      );

      expect(run.exitCode).toBeUndefined();
      expect(run.out).toContain('Catalog recorded for orders-service (dev): 1 resources');
      expect(run.err).not.toContain('⚠');
    });
  });
});

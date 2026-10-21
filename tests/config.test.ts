import { UnknownFieldsError, envFlag, loadConfig, resolveOrigin, resolveStability, resolveStream } from '../src/config';
import fs from 'fs';
import path from 'path';

describe('Configuration parsing', () => {
  const testYamlPath = path.resolve(__dirname, 'test-sanshain.yaml');

  const writeConfig = (yamlContent: string) => {
    fs.writeFileSync(testYamlPath, yamlContent);
  };

  afterEach(() => {
    if (fs.existsSync(testYamlPath)) {
      fs.unlinkSync(testYamlPath);
    }
  });

  it('should parse a valid 2.0 sanshain.yaml', () => {
    writeConfig(`
sanshainUrl: http://localhost:3000
serviceName: test-service
compression: true
provide:
  openApiFile: spec.yaml
requires:
  - serviceName: other-service
    version: 1.2.0
    outputDirectory: gen
    endpoints:
      - method: GET
        path: /api
`);

    const config = loadConfig(testYamlPath);
    expect(config.sanshainUrl).toBe('http://localhost:3000');
    expect(config.serviceName).toBe('test-service');
    expect(config.compression).toBe(true);
    expect(config.provide?.openApiFile).toBe('spec.yaml');
    expect(config.requires?.[0].serviceName).toBe('other-service');
    expect(config.requires?.[0].version).toBe('1.2.0');
  });

  it('should throw error on missing required field', () => {
    writeConfig(`
serviceName: test-service
`);

    expect(() => loadConfig(testYamlPath)).toThrow('Missing required field: sanshainUrl');
  });

  it('should reject a requires entry without a version pin, with a migration hint', () => {
    writeConfig(`
sanshainUrl: http://localhost:3000
serviceName: test-service
requires:
  - serviceName: user-service
    outputDirectory: gen
    endpoints:
      - method: GET
        path: /api
`);

    expect(() => loadConfig(testYamlPath)).toThrow(
      "requires[0] (user-service): missing 'version' — Sanshain 2.0 pins exact versions; add e.g. version: 1.2.0 (list available: GET /producers/user-service/versions)"
    );
  });

  it('should reject a non-exact version pin', () => {
    writeConfig(`
sanshainUrl: http://localhost:3000
serviceName: test-service
requires:
  - serviceName: user-service
    version: latest
    outputDirectory: gen
    endpoints:
      - method: GET
        path: /api
`);

    expect(() => loadConfig(testYamlPath)).toThrow(
      "requires[0] (user-service): version 'latest' is not a version — pin MAJOR[.MINOR[.PATCH]], optionally v-prefixed (no ranges, no 'latest')"
    );
  });

  it('should reject a branch field in requires by name, with a migration hint', () => {
    writeConfig(`
sanshainUrl: http://localhost:3000
serviceName: test-service
requires:
  - serviceName: user-service
    branch: main
    version: 1.2.0
    outputDirectory: gen
    endpoints:
      - method: GET
        path: /api
`);

    expect(() => loadConfig(testYamlPath)).toThrow(
      "requires[0] (user-service): 'branch' is no longer supported — the branch model was removed in Sanshain 2.0; replace with an exact 'version' pin"
    );
  });

  it('should reject a timeout field in requires by name', () => {
    writeConfig(`
sanshainUrl: http://localhost:3000
serviceName: test-service
requires:
  - serviceName: user-service
    version: 1.2.0
    timeout: 30
    outputDirectory: gen
    endpoints:
      - method: GET
        path: /api
`);

    expect(() => loadConfig(testYamlPath)).toThrow(
      "requires[0] (user-service): 'timeout' is no longer supported — Sanshain 2.0 resolves immediately (no long-polling); remove it"
    );
  });

  it('should reject a top-level timeout by name', () => {
    writeConfig(`
sanshainUrl: http://localhost:3000
serviceName: test-service
timeout: 60
`);

    expect(() => loadConfig(testYamlPath)).toThrow(
      "'timeout' is no longer supported — Sanshain 2.0 resolves immediately (no long-polling); remove it"
    );
  });

  it('should reject a baseVersion field in provide by name, with a migration hint', () => {
    writeConfig(`
sanshainUrl: http://localhost:3000
serviceName: test-service
provide:
  file: spec.yaml
  baseVersion: 5
`);

    expect(() => loadConfig(testYamlPath)).toThrow(
      "provide: 'baseVersion' is no longer supported — Sanshain 2.0 removed optimistic concurrency; the version is read from the spec file (info.version); remove it"
    );
  });

  it('should reject a branch field in provides by name', () => {
    writeConfig(`
sanshainUrl: http://localhost:3000
serviceName: test-service
provides:
  - file: spec.yaml
    branch: main
`);

    expect(() => loadConfig(testYamlPath)).toThrow(
      "provides[0]: 'branch' is no longer supported — the branch model was removed in Sanshain 2.0; remove it"
    );
  });

  it('should reject releaseBranches by name, pointing at the ga switch', () => {
    writeConfig(`
sanshainUrl: http://localhost:3000
serviceName: test-service
releaseBranches:
  - main
`);

    expect(() => loadConfig(testYamlPath)).toThrow(
      "'releaseBranches' is no longer supported — stability is 'snapshot' by default; pass --ga or set SANSHAIN_GA=true for GA builds"
    );
  });

  it('should reject a stability field in provide, pointing at the ga switch', () => {
    writeConfig(`
sanshainUrl: http://localhost:3000
serviceName: test-service
provide:
  file: spec.yaml
  stability: ga
`);

    expect(() => loadConfig(testYamlPath)).toThrow(
      "provide: 'stability' does not belong in sanshain.yaml — the default is 'snapshot'; pass --ga or set SANSHAIN_GA=true for GA builds"
    );
  });
});

describe('Stability resolution (ga switch)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.SANSHAIN_GA;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to snapshot', () => {
    expect(resolveStability()).toBe('snapshot');
    expect(resolveStability(false)).toBe('snapshot');
  });

  it('returns ga when the --ga flag is set', () => {
    expect(resolveStability(true)).toBe('ga');
  });

  it('returns ga when SANSHAIN_GA=true', () => {
    process.env.SANSHAIN_GA = 'true';
    expect(resolveStability(false)).toBe('ga');
  });

  it('reads SANSHAIN_GA as trimmed, case-insensitive true or 1', () => {
    for (const on of ['1', 'TRUE', ' true ', 'True']) {
      process.env.SANSHAIN_GA = on;
      expect(resolveStability()).toBe('ga');
    }
    for (const off of ['false', 'yes', '0', '']) {
      process.env.SANSHAIN_GA = off;
      expect(resolveStability()).toBe('snapshot');
    }
  });

  it('the flag wins regardless of the environment', () => {
    process.env.SANSHAIN_GA = 'false';
    expect(resolveStability(true)).toBe('ga');
  });
});

describe('SANSHAIN_* boolean switches', () => {
  const originalEnv = process.env;
  const testYamlPath = path.resolve(__dirname, 'test-switches-sanshain.yaml');

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SANSHAIN_')) delete process.env[key];
    }
    fs.writeFileSync(testYamlPath, 'sanshainUrl: http://localhost:3000\nserviceName: svc\n');
  });

  afterEach(() => {
    fs.unlinkSync(testYamlPath);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('envFlag: 1, TRUE and " true " are on; yes, false and unset are off', () => {
    expect(envFlag('SANSHAIN_X')).toBe(false);
    for (const on of ['1', 'TRUE', ' true ']) {
      process.env.SANSHAIN_X = on;
      expect(envFlag('SANSHAIN_X')).toBe(true);
    }
    for (const off of ['yes', 'false', '0', 'on']) {
      process.env.SANSHAIN_X = off;
      expect(envFlag('SANSHAIN_X')).toBe(false);
    }
  });

  it('SANSHAIN_TRUNK follows the same rule', () => {
    for (const on of ['1', 'TRUE', ' true ']) {
      process.env.SANSHAIN_TRUNK = on;
      expect(resolveStream()).toEqual({ trunk: true });
    }
    process.env.SANSHAIN_TRUNK = 'yes';
    expect(resolveStream()).toEqual({});
  });

  it.each([
    ['SANSHAIN_STRICT', 'strict'],
    ['SANSHAIN_BEST_EFFORT', 'bestEffort'],
    ['SANSHAIN_FORCE', 'force'],
    ['SANSHAIN_COMPRESSION', 'compression']
  ])('%s follows the same rule in the loaded config', (name, field) => {
    for (const on of ['1', 'TRUE', ' true ']) {
      process.env[name] = on;
      expect((loadConfig(testYamlPath) as any)[field]).toBe(true);
    }
    process.env[name] = 'yes';
    expect((loadConfig(testYamlPath) as any)[field]).toBe(false);
  });
});

describe('unknown fields (the puzzled cat)', () => {
  const originalEnv = process.env;
  const testYamlPath = path.resolve(__dirname, 'test-unknown-sanshain.yaml');
  let stderr: jest.SpyInstance;

  // Written out literally, not built from the source, so an escaping slip shows.
  const cat = (line: string) => String.raw`   /\_/\  ?` + '\n' + `  ( O_o )   ${line}` + '\n' + ' ---U-U---';

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SANSHAIN_')) delete process.env[key];
    }
    stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    stderr.mockRestore();
    if (fs.existsSync(testYamlPath)) fs.unlinkSync(testYamlPath);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  const load = (yaml: string) => {
    fs.writeFileSync(testYamlPath, yaml);
    return loadConfig(testYamlPath);
  };

  it('prints the cat once for a single unknown field and carries on', () => {
    const config = load('sanshainUrl: http://localhost:3000\nserviceName: svc\ncatalogInf: catalog-info.yaml\n');

    expect(config.serviceName).toBe('svc');
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0][0]).toBe(cat("sanshain.yaml: unknown field 'catalogInf' - ignored"));
  });

  it('names several unknown fields in file order, with nested paths', () => {
    load(
      [
        'sanshainUrl: http://localhost:3000',
        'serviceName: svc',
        'catalogInf: catalog-info.yaml',
        'provide:',
        '  file: a.yaml',
        '  fiel: b.yaml',
        'provides:',
        '  - file: c.yaml',
        '  - file: d.yaml',
        '    verison: 1',
        'requires:',
        '  - serviceName: users',
        '    version: 1.0.0',
        '    outputDirectory: gen',
        '    outputDirectroy: gen2',
        '    endpoints:',
        '      - method: GET',
        '        path: /a',
        '      - method: GET',
        '        path: /b',
        '      - methd: GET',
        '        method: GET',
        '        path: /c',
        ''
      ].join('\n')
    );

    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0][0]).toBe(
      cat(
        "sanshain.yaml: unknown fields 'catalogInf', 'provide.fiel', 'provides[1].verison', " +
          "'requires[0].outputDirectroy', 'requires[0].endpoints[2].methd' - ignored"
      )
    );
  });

  it('strict fails with the cat saying rejected (strict)', () => {
    expect(() => load('sanshainUrl: http://localhost:3000\nserviceName: svc\nstrict: true\ncatalogInf: x\n')).toThrow(
      UnknownFieldsError
    );
    expect(stderr.mock.calls[0][0]).toBe(cat("sanshain.yaml: unknown field 'catalogInf' - rejected (strict)"));
  });

  it('SANSHAIN_STRICT makes it strict too', () => {
    process.env.SANSHAIN_STRICT = '1';
    expect(() => load('sanshainUrl: http://localhost:3000\nserviceName: svc\ncatalogInf: x\n')).toThrow(
      "sanshain.yaml: unknown field 'catalogInf' - rejected (strict)"
    );
  });

  const typoedVersion = [
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
  ].join('\n');

  it('the cat shows before a validation error the typo causes', () => {
    expect(() => load(typoedVersion)).toThrow("requires[0] (users): missing 'version'");
    expect(stderr).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls[0][0]).toBe(cat("sanshain.yaml: unknown field 'requires[0].verison' - ignored"));
  });

  it('under strict, unknown fields fail before any other validation', () => {
    expect(() => load(`strict: true\n${typoedVersion}`)).toThrow(
      "sanshain.yaml: unknown field 'requires[0].verison' - rejected (strict)"
    );
  });

  it('the cat shows even when sanshainUrl is missing', () => {
    expect(() => load('serviceName: svc\nsanshainUrll: http://x\n')).toThrow('Missing required field: sanshainUrl');
    expect(stderr.mock.calls[0][0]).toBe(cat("sanshain.yaml: unknown field 'sanshainUrll' - ignored"));
  });

  it('a legacy field in requires errors by name, before any cat', () => {
    expect(() =>
      load(typoedVersion.replace('    verison: 1.0.0', '    verison: 1.0.0\n    branch: main'))
    ).toThrow("requires[0] (users): 'branch' is no longer supported");
    expect(stderr).not.toHaveBeenCalled();
  });

  it('a legacy field still errors by name, before any cat', () => {
    expect(() =>
      load('sanshainUrl: http://localhost:3000\nserviceName: svc\ncatalogInf: x\nprovide:\n  file: a.yaml\n  baseVersion: 5\n')
    ).toThrow("provide: 'baseVersion' is no longer supported");
    expect(stderr).not.toHaveBeenCalled();
  });

  it('fields known to other clients but unused here give no cat', () => {
    load(
      [
        'sanshainUrl: http://localhost:3000',
        'serviceName: svc',
        'insecure: true',
        'combine: true',
        'catalogInfo: catalog-info.yaml',
        'provides:',
        '  - file: a.yaml',
        '    combine: true',
        ''
      ].join('\n')
    );
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe('Origin resolution (why this build provides)', () => {
  it('knows nothing without options, SANSHAIN_* or runner variables', () => {
    expect(resolveOrigin({}, {})).toEqual({});
  });

  it('prefers the option over SANSHAIN_* over the runner, trims and dedupes tickets', () => {
    const env = {
      SANSHAIN_BUILD_URL: 'https://ci/env',
      SANSHAIN_CHANGE_URL: 'https://git/env',
      SANSHAIN_TICKETS: 'ENV-1',
      SANSHAIN_NOTE: 'env',
      BUILD_URL: 'https://jenkins/7',
    };
    expect(
      resolveOrigin({ buildUrl: ' https://ci/opt ', changeUrl: 'https://git/opt', tickets: 'A-1, A-2 ,A-1,', note: ' opt ' }, env),
    ).toEqual({ build_url: 'https://ci/opt', change_url: 'https://git/opt', tickets: ['A-1', 'A-2'], note: 'opt' });
    expect(resolveOrigin({}, env)).toEqual({
      build_url: 'https://ci/env',
      change_url: 'https://git/env',
      tickets: ['ENV-1'],
      note: 'env',
    });
  });

  it('reads the build and change URL from GitHub Actions, GitLab CI and Jenkins', () => {
    expect(
      resolveOrigin({}, {
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'acme/orders',
        GITHUB_RUN_ID: '123',
        GITHUB_REF: 'refs/pull/42/merge',
      }),
    ).toEqual({
      build_url: 'https://github.com/acme/orders/actions/runs/123',
      change_url: 'https://github.com/acme/orders/pull/42',
    });
    expect(
      resolveOrigin({}, {
        CI_JOB_URL: 'https://gitlab/acme/orders/-/jobs/7',
        CI_MERGE_REQUEST_PROJECT_URL: 'https://gitlab/acme/orders',
        CI_MERGE_REQUEST_IID: '12',
      }),
    ).toEqual({
      build_url: 'https://gitlab/acme/orders/-/jobs/7',
      change_url: 'https://gitlab/acme/orders/-/merge_requests/12',
    });
    expect(resolveOrigin({}, { BUILD_URL: 'https://jenkins/job/7/', CHANGE_URL: 'https://bitbucket/pr/5' })).toEqual({
      build_url: 'https://jenkins/job/7/',
      change_url: 'https://bitbucket/pr/5',
    });
    // A push build belongs to no change.
    expect(
      resolveOrigin({}, { GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'a/b', GITHUB_REF: 'refs/heads/main' }),
    ).toEqual({});
  });
});

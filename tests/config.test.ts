import { loadConfig, resolveStability } from '../src/config';
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
      "requires[0] (user-service): version 'latest' must be an exact MAJOR.MINOR.PATCH pin — no ranges, no 'latest'"
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

  it('stays snapshot when SANSHAIN_GA is anything but "true"', () => {
    process.env.SANSHAIN_GA = 'false';
    expect(resolveStability()).toBe('snapshot');
    process.env.SANSHAIN_GA = '1';
    expect(resolveStability()).toBe('snapshot');
  });

  it('the flag wins regardless of the environment', () => {
    process.env.SANSHAIN_GA = 'false';
    expect(resolveStability(true)).toBe('ga');
  });
});

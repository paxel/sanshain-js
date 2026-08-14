import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { Stability, Stream } from './api';

export interface EndpointConfig {
  method: string;
  path: string;
}

export interface RequireConfig {
  serviceName: string;
  apiType?: string;
  version: string;
  outputDirectory: string;
  endpoints: EndpointConfig[];
}

export interface ProvideConfig {
  file?: string;
  apiType?: string;
  /**
   * The project no longer provides this family. Deleting the entry says
   * nothing — Sanshain cannot tell a dropped protocol from a pipeline that
   * merely stopped running — so keeping it and marking it retired is the
   * explicit act. The provide command turns this into a retire call.
   */
  retired?: boolean;
  // Backward compatibility
  openApiFile?: string;
  asyncApiFile?: string;
  protoFile?: string;
  serviceName?: string; // removed from top level in doc, but keeping for compatibility
}

export interface SanshainConfig {
  sanshainUrl: string;
  serviceName: string;
  clientName?: string; // alias
  compression?: boolean;
  bestEffort?: boolean;
  force?: boolean;
  strict?: boolean;
  provide?: ProvideConfig;
  provides?: ProvideConfig[];
  requires?: RequireConfig[];
}

/**
 * Decide the stability of a Provide. Always 'snapshot' unless explicitly
 * switched to 'ga' via the --ga CLI flag or the SANSHAIN_GA=true environment
 * variable (typically set by CI on protected-branch pipelines). There is no
 * git or branch magic, and no stability field in sanshain.yaml.
 */
export function resolveStability(gaFlag?: boolean): Stability {
  if (gaFlag || process.env.SANSHAIN_GA === 'true') {
    return 'ga';
  }
  return 'snapshot';
}

/**
 * Resolve which dependency graph this build's calls belong to, preferring the
 * explicit flags over SANSHAIN_TRUNK / SANSHAIN_TAG. Declaring both throws:
 * the server would answer 400, and naming the misconfiguration locally beats
 * spending a round trip on it.
 */
export function resolveStream(trunkFlag?: boolean, tagFlag?: string): Stream {
  const env = process.env.SANSHAIN_TRUNK;
  const trunk = Boolean(trunkFlag) || env === 'true' || env === '1';
  const tag = (tagFlag || process.env.SANSHAIN_TAG || '').trim() || undefined;
  if (trunk && tag) {
    throw new Error(
      `this build declares both trunk and tag '${tag}' — a build belongs to the trunk stream ` +
        'or to one sanshain-branch, never both; set only one of --trunk / SANSHAIN_TRUNK and ' +
        '--tag / SANSHAIN_TAG'
    );
  }
  return trunk ? { trunk: true } : tag ? { tag } : {};
}

export function loadConfig(configPath: string = 'sanshain.yaml'): SanshainConfig {
  const fullPath = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Configuration file not found: ${fullPath}`);
  }

  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const config = yaml.load(fileContents) as SanshainConfig;

  applyEnvOverrides(config);
  validateConfig(config);

  return config;
}

function applyEnvOverrides(config: SanshainConfig): void {
  if (process.env.SANSHAIN_URL) {
    config.sanshainUrl = process.env.SANSHAIN_URL;
  }
  if (process.env.SANSHAIN_SERVICE_NAME) {
    config.serviceName = process.env.SANSHAIN_SERVICE_NAME;
  }
  if (process.env.SANSHAIN_CLIENT_NAME) {
    config.clientName = process.env.SANSHAIN_CLIENT_NAME;
  }
  if (process.env.SANSHAIN_COMPRESSION) {
    config.compression = process.env.SANSHAIN_COMPRESSION === 'true';
  }
  if (process.env.SANSHAIN_BEST_EFFORT) {
    config.bestEffort = process.env.SANSHAIN_BEST_EFFORT === 'true';
  }
  if (process.env.SANSHAIN_FORCE) {
    config.force = process.env.SANSHAIN_FORCE === 'true';
  }
  if (process.env.SANSHAIN_STRICT) {
    config.strict = process.env.SANSHAIN_STRICT === 'true';
  }
}

// What the server will accept: MAJOR[.MINOR[.PATCH]], optionally v-prefixed.
// Deliberately no normalization here — the server canonicalizes to three parts
// and answers with the canonical form; a second normalizer could only ever
// disagree with it about what 'v2.1' means.
const PINNABLE_VERSION = /^v?\d+(\.\d+){0,2}$/;

const BRANCH_HINT =
  "'branch' is no longer supported — the branch model was removed in Sanshain 2.0";
const TIMEOUT_HINT =
  "'timeout' is no longer supported — Sanshain 2.0 resolves immediately (no long-polling); remove it";
const BASE_VERSION_HINT =
  "'baseVersion' is no longer supported — Sanshain 2.0 removed optimistic concurrency; the version is read from the spec file (info.version); remove it";
const RELEASE_BRANCHES_HINT =
  "'releaseBranches' is no longer supported — stability is 'snapshot' by default; pass --ga or set SANSHAIN_GA=true for GA builds";

function validateConfig(config: any): void {
  if (!config.sanshainUrl) {
    throw new Error('Missing required field: sanshainUrl');
  }
  if (!config.serviceName && config.clientName) {
    config.serviceName = config.clientName;
  }

  // Branch-era fields at the top level are hard errors, by name.
  if ('releaseBranches' in config) {
    throw new Error(RELEASE_BRANCHES_HINT);
  }
  if ('branch' in config) {
    throw new Error(`${BRANCH_HINT}; remove it`);
  }
  if ('timeout' in config) {
    throw new Error(TIMEOUT_HINT);
  }

  const validateProvide = (p: any, index?: number) => {
    const context = index !== undefined ? `provides[${index}]` : 'provide';
    if ('branch' in p) {
      throw new Error(`${context}: ${BRANCH_HINT}; remove it — the version is read from the spec file (info.version, or the '// sanshain-version:' comment for proto)`);
    }
    if ('baseVersion' in p) {
      throw new Error(`${context}: ${BASE_VERSION_HINT}`);
    }
    if ('stability' in p) {
      throw new Error(`${context}: 'stability' does not belong in sanshain.yaml — the default is 'snapshot'; pass --ga or set SANSHAIN_GA=true for GA builds`);
    }
    // A retired entry names its family via apiType alone: the project no
    // longer provides it, so demanding a spec file would force a dead file to
    // stay on disk forever.
    if (p.retired) {
      return;
    }
    if (!p.file && !p.openApiFile && !p.asyncApiFile && !p.protoFile) {
      throw new Error(`At least one of file, openApiFile, asyncApiFile, or protoFile must be specified in ${context}`);
    }
  };

  if (config.provide) {
    validateProvide(config.provide);
  }
  if (config.provides) {
    if (!Array.isArray(config.provides)) {
      throw new Error('Field provides must be an array');
    }
    config.provides.forEach((p: any, index: number) => validateProvide(p, index));
  }

  if (config.requires) {
    if (!Array.isArray(config.requires)) {
      throw new Error('Field requires must be an array');
    }
    config.requires.forEach((req: any, index: number) => {
      if (!req.serviceName) {
        throw new Error(`Missing serviceName in requires[${index}]`);
      }
      const context = `requires[${index}] (${req.serviceName})`;
      if ('branch' in req) {
        throw new Error(`${context}: ${BRANCH_HINT}; replace with an exact 'version' pin`);
      }
      if ('timeout' in req) {
        throw new Error(`${context}: ${TIMEOUT_HINT}`);
      }
      if (req.version === undefined || req.version === null || req.version === '') {
        throw new Error(
          `${context}: missing 'version' — Sanshain 2.0 pins exact versions; add e.g. version: 1.2.0 (list available: GET /producers/${req.serviceName}/versions)`
        );
      }
      req.version = String(req.version);
      if (!PINNABLE_VERSION.test(req.version)) {
        throw new Error(
          `${context}: version '${req.version}' is not a version — pin MAJOR[.MINOR[.PATCH]], optionally v-prefixed (no ranges, no 'latest')`
        );
      }
      if (!req.outputDirectory) {
        throw new Error(`Missing outputDirectory in requires[${index}]`);
      }
      if (!req.endpoints || !Array.isArray(req.endpoints) || req.endpoints.length === 0) {
        throw new Error(`Missing or empty endpoints in requires[${index}]`);
      }
      req.endpoints.forEach((endpoint: any, endpointIndex: number) => {
        if (!endpoint.method) {
          throw new Error(`Missing method in requires[${index}].endpoints[${endpointIndex}]`);
        }
        if (!endpoint.path) {
          throw new Error(`Missing path in requires[${index}].endpoints[${endpointIndex}]`);
        }
      });
    });
  }
}

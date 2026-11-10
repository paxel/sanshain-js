import fs from 'fs';
import path from 'path';
import { load, CORE_SCHEMA, mergeTag } from 'js-yaml';
import { Annotation, Stability, Stream, Origin } from './api';

export interface EndpointConfig {
  method: string;
  path: string;
}

export interface RequireConfig {
  serviceName: string;
  apiType?: string;
  /** Only 'openapi', only with apiType asyncapi: the channel rendered as OpenAPI. */
  format?: 'openapi';
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
  /**
   * A provide is GA whenever the build declares a stream (trunk or a tag),
   * unless the --ga flag or SANSHAIN_GA says otherwise.
   */
  autoGa?: boolean;
  /** Annotations as written, `{{NAME}}` placeholders unfilled (see fillAnnotations). */
  annotations?: Annotation[];
  /** Path to the Backstage catalog-info.yaml the catalog command pushes. */
  catalogInfo?: string;
  provide?: ProvideConfig;
  provides?: ProvideConfig[];
  requires?: RequireConfig[];
}

/**
 * Read a SANSHAIN_* boolean switch: trimmed, case-insensitive `true` or `1`
 * means on; anything else — including unset — means off.
 */
export function envFlag(name: string): boolean {
  const value = (process.env[name] ?? '').trim().toLowerCase();
  return value === 'true' || value === '1';
}

/**
 * Decide the stability of a Provide. The first of these that is set decides:
 *  1. the --ga flag (it can only say true; false or absent is unset);
 *  2. SANSHAIN_GA when not blank, read like every switch, so an explicit
 *     `false` counts;
 *  3. `autoGa: true` in sanshain.yaml on a build that declares a stream
 *     (trunk, a tag, or both — see streamDeclared);
 *  4. otherwise 'snapshot'.
 * There is no git or branch detection: CI declares trunk and tag on its
 * protected pipelines, so only those builds become GA through autoGa.
 */
export function resolveStability(gaFlag?: boolean, autoGa: boolean = false, streamIsDeclared: boolean = false): Stability {
  if (gaFlag) {
    return 'ga';
  }
  if ((process.env.SANSHAIN_GA ?? '').trim() !== '') {
    return envFlag('SANSHAIN_GA') ? 'ga' : 'snapshot';
  }
  return autoGa && streamIsDeclared ? 'ga' : 'snapshot';
}

/** The first value that is not blank, trimmed; undefined when there is none. */
function firstOf(...values: (string | undefined)[]): string | undefined {
  for (const v of values) {
    const t = (v ?? '').trim();
    if (t) return t;
  }
  return undefined;
}

/** Where this build ran, from the runner's own variables (GitHub Actions, GitLab CI, Jenkins). */
function runnerBuildUrl(env: NodeJS.ProcessEnv): string | undefined {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = env;
  if (server?.trim() && repo?.trim() && run?.trim()) {
    return `${server.trim()}/${repo.trim()}/actions/runs/${run.trim()}`;
  }
  return firstOf(env.CI_JOB_URL, env.BUILD_URL);
}

/** The pull or merge request this build belongs to, from the runner's own variables. */
function runnerChangeUrl(env: NodeJS.ProcessEnv): string | undefined {
  const server = env.GITHUB_SERVER_URL?.trim();
  const repo = env.GITHUB_REPOSITORY?.trim();
  const ref = env.GITHUB_REF?.trim() ?? '';
  if (server && repo && ref.startsWith('refs/pull/')) {
    const number = ref.split('/')[2];
    if (number) return `${server}/${repo}/pull/${number}`;
  }
  const project = env.CI_MERGE_REQUEST_PROJECT_URL?.trim();
  const iid = env.CI_MERGE_REQUEST_IID?.trim();
  if (project && iid) return `${project}/-/merge_requests/${iid}`;
  return firstOf(env.CHANGE_URL);
}

/**
 * Resolve the origin of this build: an explicit option first, then
 * SANSHAIN_BUILD_URL / SANSHAIN_CHANGE_URL / SANSHAIN_TICKETS / SANSHAIN_NOTE,
 * and for the build and change URL the runner's own variables. Tickets and the
 * note are human intent and never come from the runner. Nothing is read from git.
 * Only the fields that are known are present.
 */
export function resolveOrigin(
  options: { buildUrl?: string; changeUrl?: string; tickets?: string; note?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): Origin {
  const origin: Origin = {};
  const buildUrl = firstOf(options.buildUrl, env.SANSHAIN_BUILD_URL, runnerBuildUrl(env));
  const changeUrl = firstOf(options.changeUrl, env.SANSHAIN_CHANGE_URL, runnerChangeUrl(env));
  const note = firstOf(options.note, env.SANSHAIN_NOTE);
  const tickets: string[] = [];
  for (const raw of (firstOf(options.tickets, env.SANSHAIN_TICKETS) ?? '').split(',')) {
    const id = raw.trim();
    if (id && !tickets.includes(id)) tickets.push(id);
  }
  if (buildUrl) origin.build_url = buildUrl;
  if (changeUrl) origin.change_url = changeUrl;
  if (tickets.length) origin.tickets = tickets;
  if (note) origin.note = note;
  return origin;
}

/** The environment variables that fill annotation placeholders: SANSHAIN_SET_ID fills {{ID}} when no --set ID=… does. */
export const SET_ENV_PREFIX = 'SANSHAIN_SET_';

// {{NAME}} with NAME of ASCII letters, digits and _ only; anything else
// between double braces ({{ A }}, {{a-b}}, {{}}) is literal text.
const PLACEHOLDER = /\{\{([A-Za-z0-9_]+)\}\}/g;

/** One `--set NAME=value`, split at the first `=` so the value may hold more. */
export function parseSet(arg: string): [string, string] {
  const at = arg.indexOf('=');
  if (at <= 0) {
    throw new Error(`expected NAME=value, got '${arg}'`);
  }
  return [arg.slice(0, at), arg.slice(at + 1)];
}

/**
 * Fill the `{{NAME}}` placeholders of the annotations in sanshain.yaml: the
 * --set value for NAME first, else the environment variable SANSHAIN_SET_NAME
 * (exact case). A placeholder counts as filled only with a non-empty value; an
 * empty --set does not fall through to the environment. An entry with an
 * unfilled placeholder is left out, with a warning naming it and its first
 * unfilled placeholder; the others are kept, in order.
 */
export function fillAnnotations(
  declared: Annotation[] | undefined,
  sets: ReadonlyMap<string, string> = new Map(),
  env: NodeJS.ProcessEnv = process.env
): { annotations: Annotation[]; warnings: string[] } {
  const annotations: Annotation[] = [];
  const warnings: string[] = [];
  for (const entry of declared ?? []) {
    let missing: string | undefined;
    const value = entry.value.replace(PLACEHOLDER, (_match, name: string) => {
      const flag = sets.get(name);
      const found = flag !== undefined ? flag : (env[SET_ENV_PREFIX + name] ?? '');
      if (found === '' && missing === undefined) missing = name;
      return found;
    });
    if (missing !== undefined) {
      warnings.push(
        `annotation '${entry.name}' left out: {{${missing}}} is not set (--set ${missing}=… or ${SET_ENV_PREFIX}${missing})`
      );
      continue;
    }
    // Exactly the three fields: an extra key in sanshain.yaml is only reported as unknown.
    annotations.push({ scope: entry.scope, name: entry.name, value });
  }
  return { annotations, warnings };
}

/** What a build declaring both trunk and a tag is told; it sends neither. */
export const TRUNK_AND_TAG_WARNING = 'trunk and tag are mutually exclusive - this build is recorded in neither';

/**
 * Resolve which dependency graph this build's calls belong to, preferring the
 * explicit flags over SANSHAIN_TRUNK / SANSHAIN_TAG. Declaring both is no
 * error: the graph is informational and never fails a build, so the build is
 * recorded in neither and the warning says so (strict mode makes it fatal).
 */
export function resolveStreamWithWarning(trunkFlag?: boolean, tagFlag?: string): { stream: Stream; warning?: string } {
  const { trunk, tag } = declaredStream(trunkFlag, tagFlag);
  if (trunk && tag) {
    return { stream: {}, warning: TRUNK_AND_TAG_WARNING };
  }
  return { stream: trunk ? { trunk: true } : tag ? { tag } : {} };
}

/** Trunk and the tag as this build declares them, the flags before SANSHAIN_TRUNK / SANSHAIN_TAG. */
function declaredStream(trunkFlag?: boolean, tagFlag?: string): { trunk: boolean; tag?: string } {
  const trunk = Boolean(trunkFlag) || envFlag('SANSHAIN_TRUNK');
  const tag = (tagFlag || process.env.SANSHAIN_TAG || '').trim() || undefined;
  return { trunk, tag };
}

/**
 * Whether the build declares a stream: trunk, a tag, or both — which sends
 * neither (with the warning) but still declared one. This is what makes a
 * provide GA under `autoGa: true`.
 */
export function streamDeclared(trunkFlag?: boolean, tagFlag?: string): boolean {
  const { trunk, tag } = declaredStream(trunkFlag, tagFlag);
  return trunk || tag !== undefined;
}

/** The stream alone, as resolveStreamWithWarning resolves it: both trunk and a tag give neither. */
export function resolveStream(trunkFlag?: boolean, tagFlag?: string): Stream {
  return resolveStreamWithWarning(trunkFlag, tagFlag).stream;
}

/**
 * The directory every relative path in sanshain.yaml resolves against: the one
 * holding the config file, never the working directory — so a build pointed at
 * another config via --config finds the same files as one started next to it.
 */
export function configBaseDir(configPath: string = 'sanshain.yaml'): string {
  return path.dirname(path.resolve(process.cwd(), configPath));
}

/**
 * Load and validate sanshain.yaml. `bestEffort` is best effort from outside
 * the file (--best-effort or SANSHAIN_BEST_EFFORT): under it a file that does
 * not validate is broken and its own `strict: true` does not count, so its
 * unknown fields are only reported and the validation error is thrown.
 * SANSHAIN_STRICT still counts. Unknown fields rejected by strict in a file
 * that otherwise validates throw UnknownFieldsError, which nothing softens.
 */
export function loadConfig(configPath: string = 'sanshain.yaml', bestEffort: boolean = false): SanshainConfig {
  const fullPath = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Configuration file not found: ${fullPath}`);
  }

  const fileContents = fs.readFileSync(fullPath, 'utf8');
  // js-yaml 5 reads YAML 1.2 without merge keys; `<<` is added back so a
  // sanshain.yaml that shares settings through anchors keeps working.
  const config = load(fileContents, { schema: CORE_SCHEMA.withTags(mergeTag) }) as SanshainConfig;
  if (!isObject(config)) {
    throw new Error(`${fullPath} must be a mapping of settings, such as sanshainUrl: <url>`);
  }

  applyEnvOverrides(config);
  // Order matters: removed fields fail by name first, then unknown fields get
  // the cat (so it shows even when a later validation error follows, e.g. a
  // misspelt required field), and only then the validation error is thrown.
  rejectLegacyFields(config);
  let invalid: unknown;
  try {
    validateConfig(config);
  } catch (error) {
    invalid = error;
  }
  const broken = invalid !== undefined;
  // Without SANSHAIN_STRICT, strict can only have come from the broken file.
  const strict = Boolean(config.strict) && !(bestEffort && broken && !envFlag('SANSHAIN_STRICT'));
  reportUnknownFields(config, strict);
  if (broken) throw invalid;

  return config;
}

/** Strict mode refuses a sanshain.yaml with unknown fields; best-effort does not soften it. */
export class UnknownFieldsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownFieldsError';
  }
}

// Every field any Sanshain client knows. A field another client supports but
// this one does not is still known: one sanshain.yaml serves every client.
const KNOWN_TOP = new Set([
  'sanshainUrl', 'serviceName', 'clientName', 'compression', 'bestEffort', 'strict', 'force',
  'insecure', 'combine', 'catalogInfo', 'autoGa', 'annotations', 'provide', 'provides', 'requires'
]);
const KNOWN_PROVIDE = new Set(['file', 'apiType', 'retired', 'openApiFile', 'asyncApiFile', 'protoFile', 'combine']);
const KNOWN_REQUIRE = new Set(['serviceName', 'apiType', 'version', 'outputDirectory', 'endpoints', 'format']);
const KNOWN_ENDPOINT = new Set(['method', 'path']);
const KNOWN_ANNOTATION = new Set(['scope', 'name', 'value']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The paths of all unknown fields, in file order (js-yaml keeps key order). */
export function findUnknownFields(config: unknown): string[] {
  const unknown: string[] = [];
  const scan = (node: unknown, known: Set<string>, prefix: string, nested?: (key: string, value: unknown, at: string) => void) => {
    if (!isObject(node)) return;
    for (const [key, value] of Object.entries(node)) {
      const at = prefix ? `${prefix}.${key}` : key;
      if (!known.has(key)) {
        unknown.push(at);
      } else if (nested) {
        nested(key, value, at);
      }
    }
  };
  scan(config, KNOWN_TOP, '', (key, value, at) => {
    if (key === 'provide') {
      scan(value, KNOWN_PROVIDE, at);
    } else if (key === 'annotations' && Array.isArray(value)) {
      value.forEach((entry, i) => scan(entry, KNOWN_ANNOTATION, `${at}[${i}]`));
    } else if ((key === 'provides' || key === 'requires') && Array.isArray(value)) {
      value.forEach((entry, i) => {
        const entryAt = `${at}[${i}]`;
        if (key === 'provides') {
          scan(entry, KNOWN_PROVIDE, entryAt);
        } else {
          scan(entry, KNOWN_REQUIRE, entryAt, (reqKey, reqValue, reqAt) => {
            if (reqKey === 'endpoints' && Array.isArray(reqValue)) {
              reqValue.forEach((endpoint, j) => scan(endpoint, KNOWN_ENDPOINT, `${reqAt}[${j}]`));
            }
          });
        }
      });
    }
  });
  return unknown;
}

/** The one-line verdict on unknown fields, e.g. "sanshain.yaml: unknown field 'x' - ignored". */
export function unknownFieldsLine(fields: string[], strict: boolean): string {
  const names = fields.map((f) => `'${f}'`).join(', ');
  const noun = fields.length === 1 ? 'field' : 'fields';
  return `sanshain.yaml: unknown ${noun} ${names} - ${strict ? 'rejected (strict)' : 'ignored'}`;
}

/** The puzzled cat around that verdict, printed once to stderr. */
export function puzzledCat(line: string): string {
  return ['   /\\_/\\  ?', `  ( O_o )   ${line}`, ' ---U-U---'].join('\n');
}

function reportUnknownFields(config: SanshainConfig, strict: boolean): void {
  const fields = findUnknownFields(config);
  if (fields.length === 0) return;
  const line = unknownFieldsLine(fields, strict);
  console.error(puzzledCat(line));
  if (strict) {
    throw new UnknownFieldsError(line);
  }
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
    config.compression = envFlag('SANSHAIN_COMPRESSION');
  }
  if (process.env.SANSHAIN_BEST_EFFORT) {
    config.bestEffort = envFlag('SANSHAIN_BEST_EFFORT');
  }
  if (process.env.SANSHAIN_FORCE) {
    config.force = envFlag('SANSHAIN_FORCE');
  }
  if (process.env.SANSHAIN_STRICT) {
    config.strict = envFlag('SANSHAIN_STRICT');
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
  "'releaseBranches' is no longer supported — stability is 'snapshot' by default; pass --ga or set SANSHAIN_GA=true for GA builds, or set autoGa: true to make trunk and tag builds GA";

/** Branch-era fields are hard errors, by name, before any other check. */
function rejectLegacyFields(config: any): void {
  if (!isObject(config)) return;
  if ('releaseBranches' in config) {
    throw new Error(RELEASE_BRANCHES_HINT);
  }
  if ('branch' in config) {
    throw new Error(`${BRANCH_HINT}; remove it`);
  }
  if ('timeout' in config) {
    throw new Error(TIMEOUT_HINT);
  }

  const rejectInProvide = (p: unknown, index?: number) => {
    if (!isObject(p)) return;
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
  };
  rejectInProvide(config.provide);
  if (Array.isArray(config.provides)) {
    config.provides.forEach((p, index) => rejectInProvide(p, index));
  }

  if (Array.isArray(config.requires)) {
    config.requires.forEach((req, index) => {
      if (!isObject(req)) return;
      const context = req.serviceName ? `requires[${index}] (${req.serviceName})` : `requires[${index}]`;
      if ('branch' in req) {
        throw new Error(`${context}: ${BRANCH_HINT}; replace with an exact 'version' pin`);
      }
      if ('timeout' in req) {
        throw new Error(`${context}: ${TIMEOUT_HINT}`);
      }
    });
  }
}

/** The apiType spellings provides and requires take; grpc means proto. */
const API_TYPES: unknown[] = ['openapi', 'asyncapi', 'proto', 'grpc'];

function unsupportedApiType(apiType: unknown): string {
  return `unsupported apiType '${apiType}' — use openapi, asyncapi or proto (grpc means proto)`;
}

function validateConfig(config: any): void {
  if (!config.sanshainUrl) {
    throw new Error('Missing required field: sanshainUrl');
  }
  if (!config.serviceName && config.clientName) {
    config.serviceName = config.clientName;
  }

  const validateProvide = (p: any, index?: number) => {
    const context = index !== undefined ? `provides[${index}]` : 'provide';
    if (p.apiType !== undefined && !API_TYPES.includes(p.apiType)) {
      throw new Error(`${context}: ${unsupportedApiType(p.apiType)}`);
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

  validateAnnotations(config.annotations);

  if (config.requires) {
    if (!Array.isArray(config.requires)) {
      throw new Error('Field requires must be an array');
    }
    config.requires.forEach((req: any, index: number) => {
      if (!req.serviceName) {
        throw new Error(`Missing serviceName in requires[${index}]`);
      }
      const context = `requires[${index}] (${req.serviceName})`;
      if (req.apiType !== undefined && !API_TYPES.includes(req.apiType)) {
        throw new Error(`${context}: ${unsupportedApiType(req.apiType)}`);
      }
      if (req.format !== undefined && (req.format !== 'openapi' || req.apiType !== 'asyncapi')) {
        throw new Error(
          `${context}: format '${req.format}' with apiType '${req.apiType ?? 'openapi'}' is not supported — ` +
            "the only combination is 'format: openapi' with 'apiType: asyncapi'"
        );
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

/**
 * Every annotations entry has the strings scope (version or system), name and
 * value; a violation names its entry. Wrong types are errors, never converted.
 * The size limits are the service's to check, and an extra key is an unknown
 * field, not an error.
 */
function validateAnnotations(annotations: unknown): void {
  if (annotations === undefined || annotations === null) return;
  if (!Array.isArray(annotations)) {
    throw new Error('Field annotations must be an array of entries with scope, name and value');
  }
  annotations.forEach((entry: unknown, index: number) => {
    if (!isObject(entry)) {
      throw new Error(`annotations[${index}]: must be an entry with scope, name and value`);
    }
    const context = typeof entry.name === 'string' ? `annotations[${index}] (${entry.name})` : `annotations[${index}]`;
    for (const field of KNOWN_ANNOTATION) {
      if (entry[field] === undefined || entry[field] === null) {
        throw new Error(`${context}: missing '${field}'`);
      }
      if (typeof entry[field] !== 'string') {
        throw new Error(`${context}: '${field}' must be a string`);
      }
    }
    if (entry.scope !== 'version' && entry.scope !== 'system') {
      throw new Error(`${context}: scope '${entry.scope}' is not supported — use version or system`);
    }
  });
}

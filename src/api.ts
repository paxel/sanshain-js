import axios, { AxiosInstance, AxiosResponse } from 'axios';
import https from 'https';
import { load } from 'js-yaml';
import { compress, decompress, displayUrl, normalizeLineEndings, parseServerJson, printable, sanitize } from './utils';

export type Stability = 'snapshot' | 'ga';

/**
 * Which dependency graph a build's calls belong to: trunk, one sanshain-branch
 * (tag), or neither. A property of the invocation, never of sanshain.yaml —
 * the same checkout is built by trunk CI and on a developer's laptop, and the
 * trunk pin store is last-writer-wins, so inferring the stream would let a
 * local build overwrite what CI recorded. Mutually exclusive: a call carrying
 * both is recorded in neither, with a `Sanshain-Warning`.
 */
export interface Stream {
  trunk?: boolean;
  tag?: string;
}

/** The stream as payload/query fields — absent when undeclared, never false/null. */
function streamFields(stream?: Stream): { trunk?: boolean; tag?: string } {
  if (stream?.trunk) return { trunk: true };
  if (stream?.tag) return { tag: stream.tag };
  return {};
}

/**
 * What the pipeline knows about why a provide runs: where the build ran, the
 * pull or merge request behind it, the tickets it closes and one line of
 * intent. Sanshain stores it with the version (the latest provide that carries
 * any of it wins; a byte-identical re-provide only fills an empty one). Every
 * field is absent when unknown — the server refuses explicit nulls.
 */
export interface Origin {
  build_url?: string;
  change_url?: string;
  tickets?: string[];
  note?: string;
}

const ORIGIN_FIELDS = ['build_url', 'change_url', 'tickets', 'note'] as const;

/** What every provide payload has in common, whatever document it carries. */
type ProvideDraft = Origin & { annotations?: Annotation[] } & Record<string, unknown>;

function hasOrigin(payload: ProvideDraft): boolean {
  return ORIGIN_FIELDS.some((name) => name in payload);
}

function withoutOrigin(payload: ProvideDraft): ProvideDraft {
  const origin: readonly string[] = ORIGIN_FIELDS;
  return Object.fromEntries(Object.entries(payload).filter(([name]) => !origin.includes(name)));
}

/** `value || fallback` for text: an empty text counts as none. */
function textOr(value: string | undefined, fallback: string): string {
  return value === undefined || value === '' ? fallback : value;
}

/** `value?.[key]` for a value of unknown shape: undefined when there is nothing to read from. */
function field(value: unknown, key: string): unknown {
  return value === undefined || value === null ? undefined : (value as Record<string, unknown>)[key];
}

/** The answer an HTTP failure carries. */
interface FailedResponse {
  status?: number;
  data?: unknown;
  headers?: unknown;
}

/** The answer of the service inside a failed call; undefined when the call got none. */
function failedResponse(error: unknown): FailedResponse | undefined {
  const response = field(error, 'response');
  if (!response) return undefined;
  return response;
}

/** An error response body as text, whatever form the HTTP layer handed it over in. */
function bodyText(body: unknown): string {
  return typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body ?? '');
}

/** Whether a 422 body names one of the origin fields as unknown (a service before 2.9.0). */
export function namesOriginField(body: unknown): boolean {
  const text = bodyText(body);
  return ORIGIN_FIELDS.some((field) => text.includes(`unknown field \`${field}\``));
}

/**
 * One annotation from sanshain.yaml, its placeholders filled: a named value
 * Sanshain stores with the provided version (`version`) or with the system
 * (`system`). Needs Sanshain Service 2.13.0 or later; the service checks the
 * limits (20 per scope, name and value length) and answers 400 naming the entry.
 */
export interface Annotation {
  scope: 'version' | 'system';
  name: string;
  value: string;
}

/** Printed once per client when an older service refused the annotations and the call was repeated without them. */
export const ANNOTATIONS_DROPPED_WARNING =
  'Sanshain Service before 2.13.0 does not take annotations; sending without them';

/**
 * Whether a refusal names annotations as the unknown field (a service before
 * 2.13.0). Matched exactly: the refusal of a 2.9–2.12 service lists every
 * field it knows after "expected one of", so a bare field name is not enough.
 */
export function namesAnnotationsField(body: unknown): boolean {
  return bodyText(body).includes('unknown field `annotations`');
}

export interface ProvidePayload extends Origin {
  producername: string;
  openapi_yaml: string;
  stability: Stability;
  dry_run?: boolean;
  trunk?: boolean;
  tag?: string;
  /** Every annotation of the build, both scopes; omitted when none. */
  annotations?: Annotation[];
}

export interface ProvideAsyncApiPayload extends Origin {
  producername: string;
  asyncapi_yaml: string;
  stability: Stability;
  dry_run?: boolean;
  trunk?: boolean;
  tag?: string;
  annotations?: Annotation[];
}

export interface ProvideProtoPayload extends Origin {
  producername: string;
  proto_content: string;
  stability: Stability;
  dry_run?: boolean;
  trunk?: boolean;
  tag?: string;
  annotations?: Annotation[];
}

/**
 * One AsyncAPI subscribe operation harvested from a provide as a version-less
 * consumer edge, checked against the publishing Producer's GA channel
 * contract. Expecting a field the contract does not guarantee is drift —
 * reported here on a snapshot, refused with 409 on a GA provide.
 */
export interface HarvestedSubscription {
  channel: string;
  message_name: string;
  /** The Producer owning the channel's PUB contract; absent while none does. */
  owner?: string;
  /** Why the expectation is not satisfiable by the current contract. */
  drift?: string;
}

/** Drift, or no publisher at all: worth a warning rather than an info line. */
export function isAdvisory(sub: HarvestedSubscription): boolean {
  return Boolean(sub.drift) || !sub.owner;
}

/** The one-line build-log form of a harvested subscription. */
export function describeSubscription(sub: HarvestedSubscription): string {
  let line = `${sub.channel} / ${sub.message_name}`;
  line += sub.owner ? ` <- ${sub.owner}` : ' <- (no publisher yet)';
  if (sub.drift) line += ` — ${sub.drift}`;
  return line;
}

/**
 * What retiring an API family shed. A retire publishes no version, so it
 * reports none; every count is zero under dry_run.
 */
export interface RetiredProtocol {
  /** The capability tag removed (messaging/grpc); absent for OpenAPI. */
  tag_cleared?: string | null;
  trunk_pins_closed: number;
  contracts_released: number;
}

export interface ProvideResponseBody {
  version: string;
  stability: Stability;
  content_hash: string;
  changes: { inserts: number; updates: number; deletes: number };
  /**
   * Present only for AsyncAPI provides whose document declared subscribe
   * operations.
   */
  harvested_subscriptions?: HarvestedSubscription[];
}

/**
 * A require's apiType as the service's contract spells it: `grpc`, which a
 * provide accepts too, is `proto` on the wire.
 */
function wireApiType(apiType?: string): string | undefined {
  return apiType === 'grpc' ? 'proto' : apiType;
}

/** The only conversion a require can ask for: an AsyncAPI channel rendered as OpenAPI. */
export type RequireFormat = 'openapi';

export interface RequireResult {
  content: string | null;
  etag: string | null;
  notModified: boolean;
}

export interface RequireBundleEndpoint {
  path: string;
  method: string;
}

/**
 * The bundle endpoint reads the stream from the BODY — the server's handler
 * has no query extractor, so query parameters would be silently dropped and a
 * trunk build would record no trunk pins. The single-endpoint GET /require is
 * the opposite: its stream rides the query string.
 */
export interface RequireBundlePayload {
  consumername: string;
  producername: string;
  version: string;
  endpoints: RequireBundleEndpoint[];
  api_type?: string;
  dry_run?: boolean;
  trunk?: boolean;
  tag?: string;
  /** The requiring Consumer's annotations; only the system ones are sent. */
  annotations?: Annotation[];
}

/**
 * 409 — the Provide was rejected by the version rules. The server proposes
 * the next free version to publish as instead.
 */
export class VersionConflictError extends Error {
  proposedVersion?: string;

  constructor(message: string, proposedVersion?: string) {
    super(message);
    this.name = 'VersionConflictError';
    if (proposedVersion !== undefined) this.proposedVersion = proposedVersion;
  }
}

/** 404 — the Producer, or the pinned version, does not exist on the server. */
export class UnknownVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownVersionError';
  }
}

/** 410 — the pinned version exists but deliberately lacks the endpoint(s). */
export class AbsentEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AbsentEndpointError';
  }
}

/** `PUT /catalog/{systemname}` — the system's Backstage catalog-info.yaml. */
export interface CatalogPushPayload {
  catalog_info_yaml: string;
  /** Only on a trunk build; absent otherwise. Never a tag: the server refuses unknown fields. */
  trunk?: boolean;
  /** The system's annotations, system scope only; omitted when none. */
  annotations?: Annotation[];
}

/** The periphery the server now records for the system. */
export interface CatalogPushResponse {
  system: string;
  trunk: boolean;
  resources: string[];
  /**
   * False when Sanshain could not read the file and recorded nothing (the
   * previous periphery stays); the reason rides a `Sanshain-Warning` header.
   * Absent from an older 2.4.0 pre-release service, which counts as true.
   */
  recorded?: boolean;
}

/**
 * The `Sanshain-Warning` values of a response, one per header line. Node
 * joins repeated headers with ", " in `headers`, and a warning may itself
 * contain a comma, so the separate lines are read from the raw response when
 * it is there; a joined value is never split.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the parameter type is public API: any response object is taken
export function warningsOf(response: any): string[] {
  const distinct = field(field(field(field(response, 'request'), 'res'), 'headersDistinct'), 'sanshain-warning');
  if (Array.isArray(distinct)) return (distinct as unknown[]).map((v) => printable(String(v)));
  const value = field(field(response, 'headers'), 'sanshain-warning');
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? (value as unknown[]) : [value]).map((v) => printable(String(v)));
}

/** The text of the service's 403 when the caller lacks the releaser role. */
const RELEASER_REFUSAL = "requires the 'releaser' role";

interface ErrorBody {
  error?: string;
  proposed_version?: string;
}

/** Whether a server version string is older than MAJOR.MINOR. */
function versionBelow(version: string, major: number, minor: number): boolean {
  const [maj, min = 0] = version
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10));
  if (maj === undefined || Number.isNaN(maj)) return false;
  return maj < major || (maj === major && (Number.isNaN(min) ? 0 : min) < minor);
}

export class SanshainClient {
  private axiosInstance: AxiosInstance;
  private token?: string;
  private baseUrl: string;
  private serverVersionChecked = false;
  private oldServerMessage: string | null = null;
  private serverVersion: string | null = null;
  private warnings: string[] = [];
  /** Set once the service refused annotations: later calls send none. */
  private annotationsRefused = false;

  constructor(baseUrl: string, token?: string, insecure = false) {
    if (token !== undefined) this.token = token;
    this.baseUrl = baseUrl;
    this.axiosInstance = axios.create({
      baseURL: baseUrl,
      validateStatus: (status) => status >= 200 && status < 300,
      responseType: 'arraybuffer',
    });

    if (this.token) {
      this.axiosInstance.interceptors.request.use((config) => {
        config.headers.Authorization = `Bearer ${this.token ?? ''}`;
        return config;
      });
    }

    // Insecure support if needed (similar to Maven's -Dsanshain.insecure)
    if (insecure) {
      // For Node.js, this typically means process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
      // but that's global. A better way would be using a custom httpsAgent.
      this.axiosInstance.defaults.httpsAgent = new https.Agent({
        rejectUnauthorized: false,
      });
    }
  }

  /**
   * The `Sanshain-Warning`s received since the last call, in order — for
   * error responses too — and forgets them. Sanshain sends one where it
   * did not record a call in a graph (an unknown tag, an unreadable catalog
   * file); the call itself still succeeded.
   */
  takeWarnings(): string[] {
    const taken = this.warnings;
    this.warnings = [];
    return taken;
  }

  private collectWarnings(response: unknown): void {
    this.warnings.push(...warningsOf(response));
  }

  /**
   * What a call may send of the annotations: all of them on a provide, only
   * the system ones on any other call (the service refuses a version one
   * there), and none once the service refused them.
   */
  private annotationsToSend(annotations: Annotation[] | undefined, provide: boolean): Annotation[] {
    if (this.annotationsRefused || !annotations) return [];
    return provide ? annotations : annotations.filter((a) => a.scope === 'system');
  }

  /** The payload carrying what it may send of its annotations; without the field when that is none. */
  private withAnnotations<T extends { annotations?: Annotation[] }>(payload: T, provide: boolean): T {
    const { annotations, ...rest } = payload;
    const send = this.annotationsToSend(annotations, provide);
    return (send.length > 0 ? { ...rest, annotations: send } : rest) as T;
  }

  /**
   * Whether a failed call that sent annotations was an older service refusing
   * them by name with the given status. From then on this client sends none;
   * the first refusal prints the warning, a plain log line strict mode does
   * not fail on (like the origin fallback).
   */
  private refusedAnnotations(sent: Annotation[] | undefined, error: unknown, status: number): boolean {
    const response = failedResponse(error);
    if (!sent?.length || response?.status !== status || !namesAnnotationsField(response.data)) {
      return false;
    }
    if (!this.annotationsRefused) {
      this.annotationsRefused = true;
      console.warn(`⚠ ${ANNOTATIONS_DROPPED_WARNING}`);
    }
    return true;
  }

  private async decodeBody(response: { data?: unknown; headers?: unknown }): Promise<string> {
    const body = response.data;
    if (body instanceof Buffer || body instanceof Uint8Array) {
      if (field(response.headers, 'content-encoding') === 'gzip') {
        try {
          return (await decompress(Buffer.from(body))).toString('utf8');
        } catch {
          return Buffer.from(body).toString('utf8');
        }
      }
      return Buffer.from(body).toString('utf8');
    }
    if (typeof body === 'string') return body;
    try {
      return JSON.stringify(body);
    } catch {
      return String(body);
    }
  }

  private parseErrorBody(body: string): ErrorBody {
    try {
      const parsed: unknown = parseServerJson(body);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // not JSON
    }
    return {};
  }

  /**
   * Wrong-server diagnosis: on a failed provide/require, do ONE lazy
   * GET /version. If the instance reports a version < 2.0.0 the original
   * (confusing) error is replaced by an upgrade hint. The check runs at most
   * once per client instance.
   */
  private async diagnoseOldServer(): Promise<string | null> {
    if (this.serverVersionChecked) {
      return this.oldServerMessage;
    }
    this.serverVersionChecked = true;
    try {
      const response = await this.axiosInstance.get<unknown>('/version', {
        responseType: 'arraybuffer',
        validateStatus: (status) => status === 200,
      });
      const body = await this.decodeBody(response);
      const serverVersion = field(parseServerJson(body), 'version');
      if (typeof serverVersion === 'string' && serverVersion) {
        this.serverVersion = serverVersion;
        const major = Number.parseInt(serverVersion.split('.')[0] ?? '', 10);
        if (!Number.isNaN(major) && major < 2) {
          this.oldServerMessage = `Sanshain server at ${displayUrl(this.baseUrl)} is ${serverVersion}; this client requires Sanshain 2.x — upgrade the server.`;
        }
      }
    } catch {
      // /version unreachable or unparseable — keep the original error
    }
    return this.oldServerMessage;
  }

  private async translateError(error: unknown): Promise<Error> {
    const response = failedResponse(error);
    if (!response) {
      // No answer of the service: the failure is handed back as it came.
      return error as Error;
    }

    const status = response.status;
    const bodyText = await this.decodeBody(response);
    const errorBody = this.parseErrorBody(bodyText);

    const oldServer = await this.diagnoseOldServer();
    if (oldServer) {
      return new Error(oldServer);
    }

    const serverMessage = textOr(errorBody.error, sanitize(bodyText));

    if (status === 409) {
      return new VersionConflictError(serverMessage, errorBody.proposed_version);
    }
    if (status === 404) {
      return new UnknownVersionError(
        `Unknown producer or version (404): ${serverMessage} — check the pinned version in sanshain.yaml.`,
      );
    }
    if (status === 410) {
      return new AbsentEndpointError(
        `Absent endpoint (410): ${serverMessage} — the pinned version exists but deliberately does not include the requested endpoint(s).`,
      );
    }
    // Only the refusal for want of the role gets the hint: both service
    // messages (GA provide, retire) contain this text. Any other 403, such as
    // a read-only token's, already says what to do.
    if (status === 403 && serverMessage.includes(RELEASER_REFUSAL)) {
      // The remedy is a role grant — nothing the Producer can change in its
      // own repository — so the message has to name it.
      return new Error(
        `Refused (403): ${serverMessage}\n` +
          "Publishing GA requires the 'releaser' role; retiring requires it too, or a maintainer " +
          'grant on the Producer. Grant the role to the user or token this build authenticates as ' +
          '(administrators and root always hold it), or publish as a snapshot by leaving ' +
          '--ga / SANSHAIN_GA unset and autoGa off (or setting SANSHAIN_GA=false).',
      );
    }
    if (status === 403) {
      return new Error(`Refused (403): ${serverMessage}`);
    }
    return new Error(`Request failed with status ${String(status)}: ${sanitize(bodyText)}`);
  }

  async provide(payload: ProvidePayload, compression = false): Promise<ProvideResponseBody | null> {
    return this.postProvide(
      '/provide',
      { ...payload, openapi_yaml: normalizeLineEndings(payload.openapi_yaml) },
      compression,
    );
  }

  async provideAsyncApi(payload: ProvideAsyncApiPayload, compression = false): Promise<ProvideResponseBody | null> {
    return this.postProvide(
      '/provide/asyncapi',
      { ...payload, asyncapi_yaml: normalizeLineEndings(payload.asyncapi_yaml) },
      compression,
    );
  }

  async provideProto(payload: ProvideProtoPayload, compression = false): Promise<ProvideResponseBody | null> {
    return this.postProvide(
      '/provide/grpc',
      { ...payload, proto_content: normalizeLineEndings(payload.proto_content) },
      compression,
    );
  }

  /**
   * Declare that the Producer no longer provides an API family — an ordinary
   * provide call for that family carrying `retired: true` and no document. It
   * deliberately has no way to carry a body, a stability, a stream or
   * annotations, which the server refuses alongside `retired` with 400. Gated like releasing:
   * the caller needs the 'releaser' role — which a release pipeline already
   * holds — or a maintainer grant on this Producer, or the server answers 403.
   */
  async retire(producername: string, apiType?: string, dryRun?: boolean): Promise<RetiredProtocol | null> {
    let url = '/provide';
    if (apiType === 'asyncapi') {
      url = '/provide/asyncapi';
    } else if (apiType === 'proto' || apiType === 'grpc') {
      url = '/provide/grpc';
    }
    const payload: Record<string, unknown> = { producername, retired: true };
    if (dryRun) payload.dry_run = true;

    let response: AxiosResponse<unknown>;
    try {
      response = await this.axiosInstance.post<unknown>(url, payload, {
        headers: { 'Content-Type': 'application/json' },
      });
      this.collectWarnings(response);
    } catch (error) {
      this.collectWarnings(failedResponse(error));
      throw await this.translateError(error);
    }
    try {
      return parseServerJson(await this.decodeBody(response)) as RetiredProtocol;
    } catch {
      return null;
    }
  }

  /**
   * Push the system's catalog-info.yaml. Needs Sanshain Service 2.4.0: an
   * older server answers 404, which the same lazy GET /version check turns
   * into an upgrade hint naming the server's version.
   */
  async pushCatalog(
    systemname: string,
    catalogInfoYaml: string,
    stream?: Stream,
    compression = false,
    annotations?: Annotation[],
  ): Promise<CatalogPushResponse> {
    const draft: CatalogPushPayload = { catalog_info_yaml: catalogInfoYaml };
    if (stream?.trunk) draft.trunk = true;
    if (annotations) draft.annotations = annotations;
    const payload = this.withAnnotations(draft, false);

    let data: CatalogPushPayload | Buffer = payload;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (compression) {
      data = await compress(JSON.stringify(payload));
      headers['Content-Encoding'] = 'gzip';
    }

    let response: AxiosResponse<unknown>;
    try {
      response = await this.axiosInstance.put<unknown>(`/catalog/${encodeURIComponent(systemname)}`, data, {
        headers,
      });
      this.collectWarnings(response);
    } catch (error) {
      this.collectWarnings(failedResponse(error));
      if (this.refusedAnnotations(payload.annotations, error, 422)) {
        return this.pushCatalog(systemname, catalogInfoYaml, stream, compression);
      }
      if (failedResponse(error)?.status === 404) {
        await this.diagnoseOldServer();
        const server = this.serverVersion ? `server is ${this.serverVersion}` : 'server version unknown';
        throw new Error(`sanshain catalog needs Sanshain Service 2.4.0 or later (${server})`, { cause: error });
      }
      throw await this.translateError(error);
    }
    const pushed = parseServerJson(await this.decodeBody(response)) as CatalogPushResponse;
    return { ...pushed, recorded: pushed.recorded !== false };
  }

  private async postProvide(
    url: string,
    draft: ProvideDraft,
    compression = false,
  ): Promise<ProvideResponseBody | null> {
    const payload = this.withAnnotations(draft, true);
    let data: ProvideDraft | Buffer = payload;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (compression) {
      const json = JSON.stringify(payload);
      data = await compress(json);
      headers['Content-Encoding'] = 'gzip';
    }

    let response: AxiosResponse<unknown>;
    try {
      response = await this.axiosInstance.post<unknown>(url, data, { headers });
      this.collectWarnings(response);
    } catch (error) {
      const refusal = failedResponse(error);
      this.collectWarnings(refusal);
      // An older service refuses a field it does not know by name, one field
      // per answer: annotations before 2.13.0, the origin before 2.9.0. The
      // provide must not fail for a fact the service cannot store, so it is
      // repeated without that field; a 2.8 service refuses both, in either
      // order. Annotations first: the refusal of a 2.9–2.12 service lists the
      // origin fields among those it expects.
      if (this.refusedAnnotations(payload.annotations, error, 422)) {
        return this.postProvide(url, payload, compression);
      }
      if (refusal?.status === 422 && hasOrigin(payload) && namesOriginField(refusal.data)) {
        console.warn("⚠ Sanshain Service before 2.9.0 does not take the build's origin; providing without it");
        return this.postProvide(url, withoutOrigin(payload), compression);
      }
      throw await this.translateError(error);
    }
    try {
      return parseServerJson(await this.decodeBody(response)) as ProvideResponseBody;
    } catch {
      return null;
    }
  }

  async require(
    consumername: string,
    producername: string,
    version: string,
    path: string,
    method: string,
    dry_run?: boolean,
    api_type?: string,
    etag?: string,
    stream?: Stream,
    format?: RequireFormat,
    annotations?: Annotation[],
  ): Promise<RequireResult> {
    let url = '/require';
    const type = wireApiType(api_type);
    if (type === 'asyncapi') {
      url = '/require/asyncapi';
    } else if (type === 'proto') {
      url = '/require/grpc';
    }

    // Unlike the bundle, the single-endpoint require reads its stream from
    // the query string — and its annotations, as a JSON array.
    const sentAnnotations = this.annotationsToSend(annotations, false);
    const params = {
      consumername,
      producername,
      version,
      path,
      method,
      dry_run,
      ...streamFields(stream),
      ...(format ? { format } : {}),
      ...(sentAnnotations.length > 0 ? { annotations: JSON.stringify(sentAnnotations) } : {}),
    };

    const headers: Record<string, string> = {};
    if (etag) {
      headers['If-None-Match'] = etag;
    }

    let response: AxiosResponse<unknown>;
    try {
      response = await this.axiosInstance.get<unknown>(url, {
        params,
        headers,
        responseType: 'arraybuffer',
        validateStatus: (status) => status === 200 || status === 304,
      });
      this.collectWarnings(response);
    } catch (error) {
      const refusal = failedResponse(error);
      this.collectWarnings(refusal);
      // A service before 2.13.0 refuses the unknown annotations parameter
      // with 400 — checked before the format refusal, since it lists format
      // among the fields it expects.
      if (this.refusedAnnotations(sentAnnotations, error, 400)) {
        return this.require(consumername, producername, version, path, method, dry_run, api_type, etag, stream, format);
      }
      // A service older than 2.4.0 refuses the unknown query field with 400.
      if (format && refusal?.status === 400) {
        const bodyText = await this.decodeBody(refusal);
        const message = textOr(this.parseErrorBody(bodyText).error, bodyText);
        if (/format/i.test(message)) {
          await this.diagnoseOldServer();
          if (!this.serverVersion || versionBelow(this.serverVersion, 2, 4)) {
            throw this.formatNeedsServerError();
          }
        }
      }
      throw await this.translateError(error);
    }

    return this.checkFormat(await this.toRequireResult(response), format);
  }

  private formatNeedsServerError(): Error {
    const server = this.serverVersion ? `server is ${this.serverVersion}` : 'server version unknown';
    return new Error(`format: openapi needs Sanshain Service 2.4.0 or later (${server})`);
  }

  async requireBundle(
    payload: RequireBundlePayload,
    compression = false,
    etag?: string,
    format?: RequireFormat,
  ): Promise<RequireResult> {
    const dataWithFallback = this.withAnnotations(
      {
        ...payload,
        api_type: textOr(wireApiType(payload.api_type), 'openapi'),
      },
      false,
    );
    let data: RequireBundlePayload | Buffer = dataWithFallback;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (etag) {
      headers['If-None-Match'] = etag;
    }

    if (compression) {
      const json = JSON.stringify(dataWithFallback);
      data = await compress(json);
      headers['Content-Encoding'] = 'gzip';
    }

    let response: AxiosResponse<unknown>;
    try {
      response = await this.axiosInstance.post<unknown>('/require-bundle', data, {
        // The bundle reads its stream from the body, but format from the query.
        ...(format ? { params: { format } } : {}),
        headers,
        responseType: 'arraybuffer',
        validateStatus: (status) => status === 200 || status === 304,
      });
      this.collectWarnings(response);
    } catch (error) {
      this.collectWarnings(failedResponse(error));
      if (this.refusedAnnotations(dataWithFallback.annotations, error, 422)) {
        return this.requireBundle(payload, compression, etag, format);
      }
      throw await this.translateError(error);
    }

    return this.checkFormat(await this.toRequireResult(response), format);
  }

  /**
   * With format: openapi the answer must be an OpenAPI document. A service
   * older than 2.4.0 ignores the parameter and answers AsyncAPI, which would
   * otherwise be written silently under the OpenAPI expectation.
   */
  private async checkFormat(result: RequireResult, format?: RequireFormat): Promise<RequireResult> {
    if (format !== 'openapi' || result.notModified) return result;
    let isOpenApi = false;
    try {
      const doc = load(result.content ?? '');
      isOpenApi = typeof doc === 'object' && doc !== null && 'openapi' in doc;
    } catch {
      // not parseable — not OpenAPI
    }
    if (isOpenApi) return result;
    await this.diagnoseOldServer();
    throw this.formatNeedsServerError();
  }

  private async toRequireResult(response: AxiosResponse<unknown>): Promise<RequireResult> {
    if (response.status === 304) {
      return { content: null, etag: null, notModified: true };
    }

    // The calls ask for the bytes of the answer (responseType: 'arraybuffer').
    let body = response.data as Buffer;
    if (field(response.headers, 'content-encoding') === 'gzip') {
      body = await decompress(Buffer.from(body));
    }
    const content = Buffer.from(body).toString('utf8');
    const etag = field(response.headers, 'etag');
    return { content, etag: typeof etag === 'string' && etag ? etag : null, notModified: false };
  }
}

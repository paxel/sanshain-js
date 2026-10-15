import axios, { AxiosInstance, AxiosResponse } from 'axios';
import yaml from 'js-yaml';
import { compress, decompress, normalizeLineEndings, sanitize } from './utils';

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

export interface ProvidePayload {
  producername: string;
  openapi_yaml: string;
  stability: Stability;
  dry_run?: boolean;
  trunk?: boolean;
  tag?: string;
}

export interface ProvideAsyncApiPayload {
  producername: string;
  asyncapi_yaml: string;
  stability: Stability;
  dry_run?: boolean;
  trunk?: boolean;
  tag?: string;
}

export interface ProvideProtoPayload {
  producername: string;
  proto_content: string;
  stability: Stability;
  dry_run?: boolean;
  trunk?: boolean;
  tag?: string;
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
    this.proposedVersion = proposedVersion;
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
export function warningsOf(response: any): string[] {
  const distinct = response?.request?.res?.headersDistinct?.['sanshain-warning'];
  if (Array.isArray(distinct)) return distinct.map(String);
  const value = response?.headers?.['sanshain-warning'];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

interface ErrorBody {
  error?: string;
  proposed_version?: string;
}

/** Whether a server version string is older than MAJOR.MINOR. */
function versionBelow(version: string, major: number, minor: number): boolean {
  const [maj, min] = version.replace(/^v/, '').split('.').map((part) => parseInt(part, 10));
  if (isNaN(maj)) return false;
  return maj < major || (maj === major && (isNaN(min) ? 0 : min) < minor);
}

export class SanshainClient {
  private axiosInstance: AxiosInstance;
  private token?: string;
  private baseUrl: string;
  private serverVersionChecked = false;
  private oldServerMessage: string | null = null;
  private serverVersion: string | null = null;
  private warnings: string[] = [];

  constructor(baseUrl: string, token?: string, insecure: boolean = false) {
    this.token = token;
    this.baseUrl = baseUrl;
    this.axiosInstance = axios.create({
      baseURL: baseUrl,
      validateStatus: (status) => status >= 200 && status < 300,
      responseType: 'arraybuffer'
    });

    if (this.token) {
      this.axiosInstance.interceptors.request.use((config) => {
        config.headers['Authorization'] = `Bearer ${this.token}`;
        return config;
      });
    }

    // Insecure support if needed (similar to Maven's -Dsanshain.insecure)
    if (insecure) {
      // For Node.js, this typically means process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
      // but that's global. A better way would be using a custom httpsAgent.
      const https = require('https');
      this.axiosInstance.defaults.httpsAgent = new https.Agent({
        rejectUnauthorized: false
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

  private collectWarnings(response: any): void {
    this.warnings.push(...warningsOf(response));
  }

  private async decodeBody(response: { data: any; headers?: any }): Promise<string> {
    let body = response.data;
    if (response.headers?.['content-encoding'] === 'gzip' && (body instanceof Buffer || body instanceof Uint8Array)) {
      try {
        body = (await decompress(Buffer.from(body))).toString('utf8');
      } catch {
        body = Buffer.from(body).toString('utf8');
      }
    } else if (body instanceof Buffer || body instanceof Uint8Array) {
      body = Buffer.from(body).toString('utf8');
    } else if (typeof body !== 'string') {
      try {
        body = JSON.stringify(body);
      } catch {
        body = String(body);
      }
    }
    return body;
  }

  private parseErrorBody(body: string): ErrorBody {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object') {
        return parsed as ErrorBody;
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
      const response = await this.axiosInstance.get('/version', {
        responseType: 'arraybuffer',
        validateStatus: (status) => status === 200
      });
      const body = await this.decodeBody(response);
      const parsed = JSON.parse(body);
      const serverVersion: string | undefined = parsed?.version;
      if (serverVersion) {
        this.serverVersion = serverVersion;
        const major = parseInt(serverVersion.split('.')[0], 10);
        if (!isNaN(major) && major < 2) {
          this.oldServerMessage = `Sanshain server at ${this.baseUrl} is ${serverVersion}; this client requires Sanshain 2.x — upgrade the server.`;
        }
      }
    } catch {
      // /version unreachable or unparseable — keep the original error
    }
    return this.oldServerMessage;
  }

  private async translateError(error: any): Promise<Error> {
    if (!error.response) {
      return error;
    }

    const status: number = error.response.status;
    const bodyText = await this.decodeBody(error.response);
    const errorBody = this.parseErrorBody(bodyText);

    const oldServer = await this.diagnoseOldServer();
    if (oldServer) {
      return new Error(oldServer);
    }

    const serverMessage = errorBody.error || sanitize(bodyText);

    if (status === 409) {
      return new VersionConflictError(serverMessage, errorBody.proposed_version);
    }
    if (status === 404) {
      return new UnknownVersionError(
        `Unknown producer or version (404): ${serverMessage} — check the pinned version in sanshain.yaml.`
      );
    }
    if (status === 410) {
      return new AbsentEndpointError(
        `Absent endpoint (410): ${serverMessage} — the pinned version exists but deliberately does not include the requested endpoint(s).`
      );
    }
    if (status === 403) {
      // The remedy is a role grant — nothing the Producer can change in its
      // own repository — so the message has to name it.
      return new Error(
        `Refused (403): ${serverMessage}\n` +
          "Publishing GA requires the 'releaser' role; retiring requires it too, or a maintainer " +
          'grant on the Producer. Grant the role to the user or token this build authenticates as ' +
          '(administrators and root always hold it), or publish as a snapshot by leaving ' +
          '--ga / SANSHAIN_GA unset.'
      );
    }
    return new Error(`Request failed with status ${status}: ${sanitize(bodyText)}`);
  }

  async provide(payload: ProvidePayload, compression: boolean = false): Promise<ProvideResponseBody | null> {
    return this.postProvide('/provide', { ...payload, openapi_yaml: normalizeLineEndings(payload.openapi_yaml) }, compression);
  }

  async provideAsyncApi(payload: ProvideAsyncApiPayload, compression: boolean = false): Promise<ProvideResponseBody | null> {
    return this.postProvide('/provide/asyncapi', { ...payload, asyncapi_yaml: normalizeLineEndings(payload.asyncapi_yaml) }, compression);
  }

  async provideProto(payload: ProvideProtoPayload, compression: boolean = false): Promise<ProvideResponseBody | null> {
    return this.postProvide('/provide/grpc', { ...payload, proto_content: normalizeLineEndings(payload.proto_content) }, compression);
  }

  /**
   * Declare that the Producer no longer provides an API family — an ordinary
   * provide call for that family carrying `retired: true` and no document. It
   * deliberately has no way to carry a body, a stability or a stream, which
   * the server refuses alongside `retired` with 400. Gated like releasing:
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

    let response: AxiosResponse;
    try {
      response = await this.axiosInstance.post(url, payload, {
        headers: { 'Content-Type': 'application/json' }
      });
      this.collectWarnings(response);
    } catch (error: any) {
      this.collectWarnings(error?.response);
      throw await this.translateError(error);
    }
    try {
      return JSON.parse(await this.decodeBody(response)) as RetiredProtocol;
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
    compression: boolean = false
  ): Promise<CatalogPushResponse> {
    const payload: CatalogPushPayload = { catalog_info_yaml: catalogInfoYaml };
    if (stream?.trunk) payload.trunk = true;

    let data: any = payload;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (compression) {
      data = await compress(JSON.stringify(payload));
      headers['Content-Encoding'] = 'gzip';
    }

    let response: AxiosResponse;
    try {
      response = await this.axiosInstance.put(`/catalog/${encodeURIComponent(systemname)}`, data, { headers });
      this.collectWarnings(response);
    } catch (error: any) {
      this.collectWarnings(error?.response);
      if (error?.response?.status === 404) {
        await this.diagnoseOldServer();
        const server = this.serverVersion ? `server is ${this.serverVersion}` : 'server version unknown';
        throw new Error(`sanshain catalog needs Sanshain Service 2.4.0 or later (${server})`);
      }
      throw await this.translateError(error);
    }
    const pushed = JSON.parse(await this.decodeBody(response)) as CatalogPushResponse;
    return { ...pushed, recorded: pushed.recorded !== false };
  }

  private async postProvide(url: string, payload: any, compression: boolean = false): Promise<ProvideResponseBody | null> {
    let data: any = payload;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (compression) {
      const json = JSON.stringify(payload);
      data = await compress(json);
      headers['Content-Encoding'] = 'gzip';
    }

    let response: AxiosResponse;
    try {
      response = await this.axiosInstance.post(url, data, { headers });
      this.collectWarnings(response);
    } catch (error: any) {
      this.collectWarnings(error?.response);
      throw await this.translateError(error);
    }
    try {
      const body = await this.decodeBody(response);
      if (typeof body === 'string') {
        return JSON.parse(body) as ProvideResponseBody;
      }
      return body as ProvideResponseBody;
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
    format?: RequireFormat
  ): Promise<RequireResult> {
    let url = '/require';
    if (api_type === 'asyncapi') {
      url = '/require/asyncapi';
    } else if (api_type === 'proto') {
      url = '/require/grpc';
    }

    // Unlike the bundle, the single-endpoint require reads its stream from
    // the query string.
    const params = {
      consumername,
      producername,
      version,
      path,
      method,
      dry_run,
      ...streamFields(stream),
      ...(format ? { format } : {})
    };

    const headers: Record<string, string> = {};
    if (etag) {
      headers['If-None-Match'] = etag;
    }

    let response: AxiosResponse;
    try {
      response = await this.axiosInstance.get(url, {
        params,
        headers,
        responseType: 'arraybuffer',
        validateStatus: (status) => status === 200 || status === 304
      });
      this.collectWarnings(response);
    } catch (error: any) {
      this.collectWarnings(error?.response);
      // A service older than 2.4.0 refuses the unknown query field with 400.
      if (format && error?.response?.status === 400) {
        const bodyText = await this.decodeBody(error.response);
        const message = this.parseErrorBody(bodyText).error || bodyText;
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
    compression: boolean = false,
    etag?: string,
    format?: RequireFormat
  ): Promise<RequireResult> {
    const dataWithFallback = {
      ...payload,
      api_type: payload.api_type || 'openapi'
    };
    let data: any = dataWithFallback;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (etag) {
      headers['If-None-Match'] = etag;
    }

    if (compression) {
      const json = JSON.stringify(dataWithFallback);
      data = await compress(json);
      headers['Content-Encoding'] = 'gzip';
    }

    let response: AxiosResponse;
    try {
      response = await this.axiosInstance.post('/require-bundle', data, {
        // The bundle reads its stream from the body, but format from the query.
        ...(format ? { params: { format } } : {}),
        headers,
        responseType: 'arraybuffer',
        validateStatus: (status) => status === 200 || status === 304
      });
      this.collectWarnings(response);
    } catch (error: any) {
      this.collectWarnings(error?.response);
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
      const doc = yaml.load(result.content ?? '');
      isOpenApi = typeof doc === 'object' && doc !== null && 'openapi' in doc;
    } catch {
      // not parseable — not OpenAPI
    }
    if (isOpenApi) return result;
    await this.diagnoseOldServer();
    throw this.formatNeedsServerError();
  }

  private async toRequireResult(response: AxiosResponse): Promise<RequireResult> {
    if (response.status === 304) {
      return { content: null, etag: null, notModified: true };
    }

    let body = response.data;
    if (response.headers?.['content-encoding'] === 'gzip') {
      body = await decompress(Buffer.from(body));
    }
    const content = Buffer.from(body).toString('utf8');
    const responseEtag = response.headers?.['etag'] || null;
    return { content, etag: responseEtag, notModified: false };
  }
}

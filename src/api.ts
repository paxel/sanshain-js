import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { compress, decompress, sanitize } from './utils';

export type Stability = 'snapshot' | 'ga';

export interface ProvidePayload {
  producername: string;
  openapi_yaml: string;
  stability: Stability;
  dry_run?: boolean;
}

export interface ProvideAsyncApiPayload {
  producername: string;
  asyncapi_yaml: string;
  stability: Stability;
  dry_run?: boolean;
}

export interface ProvideProtoPayload {
  producername: string;
  proto_content: string;
  stability: Stability;
  dry_run?: boolean;
}

export interface ProvideResponseBody {
  version: string;
  stability: Stability;
  content_hash: string;
  changes: { inserts: number; updates: number; deletes: number };
}

export interface RequireResult {
  content: string | null;
  etag: string | null;
  notModified: boolean;
}

export interface RequireBundleEndpoint {
  path: string;
  method: string;
}

export interface RequireBundlePayload {
  consumername: string;
  producername: string;
  version: string;
  endpoints: RequireBundleEndpoint[];
  api_type?: string;
  dry_run?: boolean;
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

interface ErrorBody {
  error?: string;
  proposed_version?: string;
}

export class SanshainClient {
  private axiosInstance: AxiosInstance;
  private token?: string;
  private baseUrl: string;
  private serverVersionChecked = false;
  private oldServerMessage: string | null = null;

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
    return new Error(`Request failed with status ${status}: ${sanitize(bodyText)}`);
  }

  async provide(payload: ProvidePayload, compression: boolean = false): Promise<ProvideResponseBody | null> {
    return this.postProvide('/provide', payload, compression);
  }

  async provideAsyncApi(payload: ProvideAsyncApiPayload, compression: boolean = false): Promise<ProvideResponseBody | null> {
    return this.postProvide('/provide/asyncapi', payload, compression);
  }

  async provideProto(payload: ProvideProtoPayload, compression: boolean = false): Promise<ProvideResponseBody | null> {
    return this.postProvide('/provide/grpc', payload, compression);
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
    } catch (error: any) {
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
    etag?: string
  ): Promise<RequireResult> {
    let url = '/require';
    if (api_type === 'asyncapi') {
      url = '/require/asyncapi';
    } else if (api_type === 'proto') {
      url = '/require/grpc';
    }

    const params = {
      consumername,
      producername,
      version,
      path,
      method,
      dry_run
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
    } catch (error: any) {
      throw await this.translateError(error);
    }

    return this.toRequireResult(response);
  }

  async requireBundle(
    payload: RequireBundlePayload,
    compression: boolean = false,
    etag?: string
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
        headers,
        responseType: 'arraybuffer',
        validateStatus: (status) => status === 200 || status === 304
      });
    } catch (error: any) {
      throw await this.translateError(error);
    }

    return this.toRequireResult(response);
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

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { compress, decompress, sanitize } from './utils';

export interface ProvidePayload {
  servicename: string;
  branch: string;
  openapi_yaml: string;
  dry_run?: boolean;
  api_type?: string;
  base_version?: number;
}

export interface ProvideAsyncApiPayload {
  servicename: string;
  branch: string;
  asyncapi_yaml: string;
  dry_run?: boolean;
  api_type?: string;
  base_version?: number;
}

export interface ProvideProtoPayload {
  servicename: string;
  branch: string;
  proto_content: string;
  dry_run?: boolean;
  api_type?: string;
  base_version?: number;
}

export interface ProvideResponseBody {
  version: number;
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
  clientname: string;
  servicename: string;
  branch: string;
  endpoints: RequireBundleEndpoint[];
  timeout?: number;
  dry_run?: boolean;
  api_type?: string;
}

export class SanshainClient {
  private axiosInstance: AxiosInstance;
  private token?: string;

  constructor(baseUrl: string, token?: string, insecure: boolean = false) {
    this.token = token;
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

    this.axiosInstance.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response) {
          let body = error.response.data;
          if (error.response.headers?.['content-encoding'] === 'gzip' && (body instanceof Buffer || body instanceof Uint8Array)) {
            try {
              body = (await decompress(Buffer.from(body))).toString('utf8');
            } catch (e) {
              body = body.toString();
            }
          } else if (body instanceof Buffer || body instanceof Uint8Array) {
            body = Buffer.from(body).toString('utf8');
          } else if (typeof body !== 'string') {
            try {
              body = JSON.stringify(body);
            } catch (e) {
              body = String(body);
            }
          }
          error.message = `Request failed with status ${error.response.status}: ${sanitize(body)}`;
        }
        return Promise.reject(error);
      }
    );
  }

  async provide(payload: ProvidePayload, compression: boolean = false): Promise<ProvideResponseBody | null> {
    return this.postProvide('/provide', { ...payload, api_type: 'openapi' }, compression);
  }

  async provideAsyncApi(payload: ProvideAsyncApiPayload, compression: boolean = false): Promise<ProvideResponseBody | null> {
    return this.postProvide('/provide/asyncapi', { ...payload, api_type: 'asyncapi' }, compression);
  }

  async provideProto(payload: ProvideProtoPayload, compression: boolean = false): Promise<ProvideResponseBody | null> {
    return this.postProvide('/provide/grpc', { ...payload, api_type: 'proto' }, compression);
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

    const response = await this.axiosInstance.post(url, data, { headers });
    if (response.status === 409) {
      throw new Error('Concurrent modification detected. Server version has advanced beyond your base_version. Re-run to fetch the latest state.');
    }
    try {
      let body = response.data;
      if (body instanceof Buffer || body instanceof Uint8Array) {
        body = Buffer.from(body).toString('utf8');
      }
      if (typeof body === 'string') {
        return JSON.parse(body) as ProvideResponseBody;
      }
      return body as ProvideResponseBody;
    } catch {
      return null;
    }
  }

  async require(
    clientname: string,
    servicename: string,
    branch: string,
    path: string,
    method: string,
    timeout?: number,
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
      clientname,
      servicename,
      branch,
      path,
      method,
      timeout,
      dry_run,
      api_type: api_type || 'openapi'
    };

    const headers: Record<string, string> = {};
    if (etag) {
      headers['If-None-Match'] = etag;
    }

    const response: AxiosResponse = await this.axiosInstance.get(url, {
      params,
      headers,
      responseType: 'arraybuffer',
      validateStatus: (status) => status === 200 || status === 304
    });

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

    const response: AxiosResponse = await this.axiosInstance.post('/require-bundle', data, {
      headers,
      responseType: 'arraybuffer',
      validateStatus: (status) => status === 200 || status === 304
    });

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

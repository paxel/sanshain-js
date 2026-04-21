import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { compress } from './utils';

export interface ProvidePayload {
  servicename: string;
  branch: string;
  openapi_yaml: string;
  dry_run?: boolean;
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
}

export class SanshainClient {
  private axiosInstance: AxiosInstance;
  private token?: string;

  constructor(baseUrl: string, token?: string, insecure: boolean = false) {
    this.token = token;
    this.axiosInstance = axios.create({
      baseURL: baseUrl,
      validateStatus: (status) => status >= 200 && status < 300,
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

  async provide(payload: ProvidePayload, compression: boolean = false): Promise<void> {
    let data: any = payload;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (compression) {
      const json = JSON.stringify(payload);
      data = await compress(json);
      headers['Content-Encoding'] = 'gzip';
    }

    await this.axiosInstance.post('/provide', data, { headers });
  }

  async require(
    clientname: string,
    servicename: string,
    branch: string,
    path: string,
    method: string,
    timeout?: number,
    dry_run?: boolean
  ): Promise<string> {
    const params = {
      clientname,
      servicename,
      branch,
      path,
      method,
      timeout,
      dry_run
    };

    const response: AxiosResponse<string> = await this.axiosInstance.get('/require', {
      params,
      responseType: 'text'
    });

    return response.data;
  }

  async requireBundle(
    payload: RequireBundlePayload,
    compression: boolean = false
  ): Promise<string> {
    let data: any = payload;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (compression) {
      const json = JSON.stringify(payload);
      data = await compress(json);
      headers['Content-Encoding'] = 'gzip';
    }

    const response: AxiosResponse<string> = await this.axiosInstance.post('/require-bundle', data, {
      headers,
      responseType: 'text'
    });

    return response.data;
  }
}

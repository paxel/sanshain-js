import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface EndpointConfig {
  method: string;
  path: string;
}

export interface RequireConfig {
  serviceName: string;
  branch?: string;
  outputDirectory: string;
  timeout?: number;
  endpoints: EndpointConfig[];
}

export interface ProvideConfig {
  serviceName: string;
  openApiFile: string;
  branch?: string;
}

export interface SanshainConfig {
  sanshainUrl: string;
  clientName: string;
  timeout?: number;
  compression?: boolean;
  provide?: ProvideConfig;
  requires?: RequireConfig[];
}

export function loadConfig(configPath: string = 'sanshain.yaml'): SanshainConfig {
  const fullPath = path.resolve(process.cwd(), configPath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Configuration file not found: ${fullPath}`);
  }

  const fileContents = fs.readFileSync(fullPath, 'utf8');
  const config = yaml.load(fileContents) as SanshainConfig;

  validateConfig(config);

  return config;
}

function validateConfig(config: any): void {
  if (!config.sanshainUrl) {
    throw new Error('Missing required field: sanshainUrl');
  }
  if (!config.clientName) {
    throw new Error('Missing required field: clientName');
  }

  if (config.provide) {
    if (!config.provide.serviceName) {
      throw new Error('Missing required field in provide: serviceName');
    }
    if (!config.provide.openApiFile) {
      throw new Error('Missing required field in provide: openApiFile');
    }
  }

  if (config.requires) {
    if (!Array.isArray(config.requires)) {
      throw new Error('Field requires must be an array');
    }
    config.requires.forEach((req: any, index: number) => {
      if (!req.serviceName) {
        throw new Error(`Missing serviceName in requires[${index}]`);
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

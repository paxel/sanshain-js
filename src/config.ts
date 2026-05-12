import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

export interface EndpointConfig {
  method: string;
  path: string;
}

export interface RequireConfig {
  serviceName: string;
  apiType?: string;
  branch?: string;
  outputDirectory: string;
  timeout?: number;
  endpoints: EndpointConfig[];
}

export interface ProvideConfig {
  file?: string;
  apiType?: string;
  branch?: string;
  baseVersion?: number;
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
  timeout?: number;
  compression?: boolean;
  bestEffort?: boolean;
  force?: boolean;
  strict?: boolean;
  provide?: ProvideConfig;
  provides?: ProvideConfig[];
  requires?: RequireConfig[];
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
  if (process.env.SANSHAIN_TIMEOUT) {
    config.timeout = parseInt(process.env.SANSHAIN_TIMEOUT, 10);
  }
  if (process.env.SANSHAIN_COMPRESSION) {
    config.compression = process.env.SANSHAIN_COMPRESSION === 'true';
  }
  if (process.env.SANSHAIN_BEST_EFFORT) {
    config.bestEffort = process.env.SANSHAIN_BEST_EFFORT === 'true';
  }
  if (process.env.SANSHAIN_FORCE) {
    // We don't have force in SanshainConfig interface yet, adding it for internal use or we can update interface
    (config as any).force = process.env.SANSHAIN_FORCE === 'true';
  }
  if (process.env.SANSHAIN_STRICT) {
    config.strict = process.env.SANSHAIN_STRICT === 'true';
  }
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

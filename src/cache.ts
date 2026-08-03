import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface ProvideEntry {
  content_hash: string;
  version: string;
  last_provided: string;
}

export interface RequireEntry {
  etag: string;
  last_fetched: string;
}

export interface CacheState {
  provides: Record<string, ProvideEntry>;
  requires: Record<string, RequireEntry>;
}

const DEFAULT_CACHE_DIR = path.join('node_modules', '.cache', 'sanshain');
const CACHE_FILE = 'state.json';

export class SanshainCache {
  private cacheFile: string;
  private state: CacheState;

  constructor(cacheDir?: string) {
    const dir = cacheDir || DEFAULT_CACHE_DIR;
    this.cacheFile = path.join(dir, CACHE_FILE);
    this.state = this.load();
  }

  private load(): CacheState {
    try {
      if (fs.existsSync(this.cacheFile)) {
        const data = fs.readFileSync(this.cacheFile, 'utf8');
        return JSON.parse(data);
      }
    } catch {
      // Corrupted cache — start fresh
    }
    return { provides: {}, requires: {} };
  }

  save(): void {
    const dir = path.dirname(this.cacheFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.cacheFile, JSON.stringify(this.state, null, 2));
  }

  getProvideEntry(key: string): ProvideEntry | undefined {
    return this.state.provides[key];
  }

  updateProvideEntry(key: string, contentHash: string, version: string): void {
    this.state.provides[key] = {
      content_hash: contentHash,
      version,
      last_provided: new Date().toISOString()
    };
  }

  getRequireEntry(key: string): RequireEntry | undefined {
    return this.state.requires[key];
  }

  updateRequireEntry(key: string, etag: string): void {
    this.state.requires[key] = {
      etag,
      last_fetched: new Date().toISOString()
    };
  }

  static computeHash(content: string): string {
    const hash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
    return `sha256:${hash}`;
  }

  static requireKey(serviceName: string, version: string, method: string, apiPath: string): string {
    return `${serviceName}|${version}|${method}|${apiPath}`;
  }

  static requireBundleKey(serviceName: string, version: string): string {
    return `${serviceName}|${version}|bundle`;
  }
}

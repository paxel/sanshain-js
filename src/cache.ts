import fs from 'fs';
import path from 'path';

export interface RequireEntry {
  etag: string;
  last_fetched: string;
}

export interface CacheState {
  /** Written by clients before 2.4.0, which skipped unchanged provides; kept as-is and ignored. */
  provides?: unknown;
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
        const data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'));
        return { ...data, requires: data?.requires ?? {} };
      }
    } catch {
      // Corrupted cache — start fresh
    }
    return { requires: {} };
  }

  save(): void {
    const dir = path.dirname(this.cacheFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.cacheFile, JSON.stringify(this.state, null, 2));
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

  // A requested format is part of the key, so the two renderings of one
  // entry never share an ETag; without one the key is unchanged.
  static requireKey(serviceName: string, version: string, method: string, apiPath: string, format?: string): string {
    return `${serviceName}|${version}|${method}|${apiPath}${format ? `|${format}` : ''}`;
  }

  static requireBundleKey(serviceName: string, version: string, format?: string): string {
    return `${serviceName}|${version}|bundle${format ? `|${format}` : ''}`;
  }
}

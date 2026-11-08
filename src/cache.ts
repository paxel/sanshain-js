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

  // A requested format and the output directory are part of the key, so
  // neither the two renderings of one entry nor two directories it is written
  // to share an ETag; without them the key is unchanged.
  static requireKey(
    serviceName: string,
    version: string,
    method: string,
    apiPath: string,
    format?: string,
    outputDirectory?: string
  ): string {
    return `${serviceName}|${version}|${method}|${apiPath}${format ? `|${format}` : ''}${outputSuffix(outputDirectory)}`;
  }

  static requireBundleKey(serviceName: string, version: string, format?: string, outputDirectory?: string): string {
    return `${serviceName}|${version}|bundle${format ? `|${format}` : ''}${outputSuffix(outputDirectory)}`;
  }
}

/** The output directory as written in sanshain.yaml, with forward slashes, normalized, no trailing slash. */
function outputSuffix(outputDirectory?: string): string {
  if (!outputDirectory) return '';
  const normalized = path.posix.normalize(outputDirectory.replace(/\\/g, '/'));
  return `|out=${normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized}`;
}

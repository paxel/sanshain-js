import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export async function compress(data: string | Buffer): Promise<Buffer> {
  return gzip(data);
}

export async function decompress(data: Buffer): Promise<Buffer> {
  return gunzip(data);
}

export function sanitize(text: string): string {
  if (!text) return '';
  let sanitized = text;
  if (sanitized.length > 1000) {
    sanitized = sanitized.substring(0, 1000) + '... (truncated)';
  }
  return sanitized.split('').map(char => {
    const code = char.charCodeAt(0);
    // Allow common whitespace (space, tab, newline, carriage return)
    if (code === 32 || (code >= 9 && code <= 13)) return char;
    // Allow printable ASCII
    if (code >= 32 && code <= 126) return char;
    // Otherwise replace with ?
    return '?';
  }).join('');
}

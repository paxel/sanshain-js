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

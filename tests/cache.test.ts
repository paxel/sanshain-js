import fs from 'fs';
import os from 'os';
import path from 'path';
import { SanshainCache } from '../src/cache';

describe('SanshainCache keys', () => {
  it('a single endpoint keys producer, version, method and path, then format and output directory', () => {
    expect(SanshainCache.requireKey('users', '1.0.0', 'GET', '/users')).toBe('users|1.0.0|GET|/users');
    expect(SanshainCache.requireKey('users', '1.0.0', 'GET', '/users', 'openapi', 'gen/a')).toBe(
      'users|1.0.0|GET|/users|openapi|out=gen/a',
    );
  });

  it('a bundle keys producer and version, then format and output directory', () => {
    expect(SanshainCache.requireBundleKey('users', '1.0.0')).toBe('users|1.0.0|bundle');
    expect(SanshainCache.requireBundleKey('users', '1.0.0', undefined, 'gen/b')).toBe('users|1.0.0|bundle|out=gen/b');
  });

  it('two spellings of one directory share a key, two directories do not', () => {
    const key = (dir: string) => SanshainCache.requireKey('users', '1.0.0', 'GET', '/users', undefined, dir);
    expect(key('./gen//a/')).toBe(key('gen/a'));
    expect(key('gen\\a')).toBe(key('gen/a'));
    expect(key('gen/a')).not.toBe(key('gen/b'));
  });
});

describe('SanshainCache state file', () => {
  let dir: string;
  const write = (content: string) => {
    fs.writeFileSync(path.join(dir, 'state.json'), content);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanshain-state-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads what save wrote', () => {
    const first = new SanshainCache(dir);
    expect(first.getRequireEntry('key')).toBeUndefined();
    first.updateRequireEntry('key', 'etag-1');
    first.save();

    expect(new SanshainCache(dir).getRequireEntry('key')?.etag).toBe('etag-1');
  });

  it('keeps what an older client wrote beside the requires', () => {
    write('{"provides":{"old":1},"requires":{"key":{"etag":"e","last_fetched":"2026-11-18T10:00:00Z"}}}');

    const cache = new SanshainCache(dir);
    expect(cache.getRequireEntry('key')?.etag).toBe('e');
    cache.save();

    expect(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'))).toMatchObject({ provides: { old: 1 } });
  });

  it.each(['', 'not json', '[]', '"text"', '7', 'null', '{"requires":null}', '{"requires":7}', '{"requires":[1,2]}'])(
    'a file that holds no state (%s) is an empty state that takes the next entry',
    (content) => {
      write(content);

      const cache = new SanshainCache(dir);
      expect(cache.getRequireEntry('key')).toBeUndefined();
      cache.updateRequireEntry('key', 'etag');
      cache.save();

      expect(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'))).toEqual({
        requires: { key: { etag: 'etag', last_fetched: expect.any(String) as string } },
      });
    },
  );
});

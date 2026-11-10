import { SanshainCache } from '../src/cache';

describe('SanshainCache keys', () => {
  it('a single endpoint keys producer, version, method and path, then format and output directory', () => {
    expect(SanshainCache.requireKey('users', '1.0.0', 'GET', '/users')).toBe('users|1.0.0|GET|/users');
    expect(SanshainCache.requireKey('users', '1.0.0', 'GET', '/users', 'openapi', 'gen/a')).toBe(
      'users|1.0.0|GET|/users|openapi|out=gen/a'
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

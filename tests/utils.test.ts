import { displayUrl } from '../src/utils';

describe('displayUrl', () => {
  it('leaves a URL without user or password as given', () => {
    expect(displayUrl('https://sanshain.example:8443')).toBe('https://sanshain.example:8443');
    expect(displayUrl('http://localhost:3000/base/')).toBe('http://localhost:3000/base/');
  });

  it('drops the user and password', () => {
    expect(displayUrl('https://ci:s3cret@sanshain.example:8443/base')).toBe('https://sanshain.example:8443/base');
    expect(displayUrl('https://s3cret@sanshain.example')).toBe('https://sanshain.example/');
    expect(displayUrl('https://:s3cret@sanshain.example')).toBe('https://sanshain.example/');
  });

  it('keeps only what follows the last @ of an unparsable URL', () => {
    expect(displayUrl('//ci:s3c@ret@sanshain.example')).toBe('sanshain.example');
    expect(displayUrl('not a url')).toBe('not a url');
  });
});

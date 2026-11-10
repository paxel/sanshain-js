import { displayUrl, printable } from '../src/utils';

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

describe('printable', () => {
  it('turns every control character but the tab into ?', () => {
    expect(printable('a\nb\r\u0000\u001b[0m\u007f\u0085\u009f\tz')).toBe('a?b???[0m???\tz');
  });

  it('keeps printable text, also beyond ASCII', () => {
    expect(printable('Grüße — ✓ 1.2.0')).toBe('Grüße — ✓ 1.2.0');
  });
});

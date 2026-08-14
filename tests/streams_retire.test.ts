/** The 2.2 surface: streams, retire, harvested subscriptions, line endings. */
import axios from 'axios';
import {
  SanshainClient,
  describeSubscription,
  isAdvisory
} from '../src/api';
import { resolveStream } from '../src/config';
import { normalizeLineEndings } from '../src/utils';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const PROVIDE_OK = JSON.stringify({
  version: '1.0.0',
  stability: 'snapshot',
  content_hash: 'sha256:abc',
  changes: { inserts: 0, updates: 0, deletes: 0 }
});

describe('resolveStream', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults to no stream and reads the environment', () => {
    delete process.env.SANSHAIN_TRUNK;
    delete process.env.SANSHAIN_TAG;
    expect(resolveStream()).toEqual({});
    process.env.SANSHAIN_TRUNK = 'true';
    expect(resolveStream()).toEqual({ trunk: true });
    delete process.env.SANSHAIN_TRUNK;
    process.env.SANSHAIN_TAG = 'R';
    expect(resolveStream()).toEqual({ tag: 'R' });
  });

  it('prefers the flag over the environment', () => {
    process.env.SANSHAIN_TAG = 'from-env';
    expect(resolveStream(false, 'from-flag')).toEqual({ tag: 'from-flag' });
  });

  it('refuses trunk and tag together, locally', () => {
    // The server answers 400 for both; naming the misconfiguration here beats
    // spending a round trip on it.
    delete process.env.SANSHAIN_TRUNK;
    delete process.env.SANSHAIN_TAG;
    expect(() => resolveStream(true, 'R')).toThrow(/never both/);
    expect(() => resolveStream(true, 'R')).toThrow(/'R'/);
    process.env.SANSHAIN_TAG = 'R';
    expect(() => resolveStream(true)).toThrow(/never both/);
  });
});

describe('streams on the wire', () => {
  let client: SanshainClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockedAxios as any);
    client = new SanshainClient('http://localhost:3000');
  });

  it('provide carries the declared stream, and omits it when undeclared', async () => {
    mockedAxios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });

    await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot', trunk: true });
    expect(mockedAxios.post.mock.calls[0][1]).toMatchObject({ trunk: true });

    await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot', tag: 'R' });
    expect(mockedAxios.post.mock.calls[1][1]).toMatchObject({ tag: 'R' });

    await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot' });
    const bare = mockedAxios.post.mock.calls[2][1] as Record<string, unknown>;
    expect(bare).not.toHaveProperty('trunk');
    expect(bare).not.toHaveProperty('tag');
  });

  it('the single require carries the stream in the query', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: Buffer.from('paths: {}'), headers: {} });

    await client.require('c', 'p', '1.0.0', '/x', 'GET', false, undefined, undefined, { trunk: true });
    expect(mockedAxios.get.mock.calls[0][1]?.params).toMatchObject({ trunk: true });

    await client.require('c', 'p', '1.0.0', '/x', 'GET', false, undefined, undefined, { tag: 'R' });
    expect(mockedAxios.get.mock.calls[1][1]?.params).toMatchObject({ tag: 'R' });

    await client.require('c', 'p', '1.0.0', '/x', 'GET');
    const params = mockedAxios.get.mock.calls[2][1]?.params as Record<string, unknown>;
    expect(params).not.toHaveProperty('trunk');
    expect(params).not.toHaveProperty('tag');
  });

  it('the bundle carries the stream in the body — the server reads no query there', async () => {
    // The server's bundle handler has no query extractor: a stream on the
    // query string would be silently dropped and a trunk build would record
    // no trunk pins.
    mockedAxios.post.mockResolvedValue({ status: 200, data: Buffer.from('paths: {}'), headers: {} });

    await client.requireBundle({
      consumername: 'c',
      producername: 'p',
      version: '1.0.0',
      endpoints: [
        { path: '/x', method: 'GET' },
        { path: '/y', method: 'GET' }
      ],
      trunk: true
    });
    expect(mockedAxios.post.mock.calls[0][0]).toBe('/require-bundle');
    expect(mockedAxios.post.mock.calls[0][1]).toMatchObject({ trunk: true });
  });
});

describe('retire', () => {
  let client: SanshainClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockedAxios as any);
    client = new SanshainClient('http://localhost:3000');
  });

  it('sends retired with no document, on the family its own provide path', async () => {
    mockedAxios.post.mockResolvedValue({
      status: 202,
      data: JSON.stringify({ tag_cleared: 'messaging', trunk_pins_closed: 2, contracts_released: 1 }),
      headers: {}
    });

    const shed = await client.retire('notifier', 'asyncapi');

    expect(mockedAxios.post.mock.calls[0][0]).toBe('/provide/asyncapi');
    expect(mockedAxios.post.mock.calls[0][1]).toEqual({ producername: 'notifier', retired: true });
    expect(shed).toEqual({ tag_cleared: 'messaging', trunk_pins_closed: 2, contracts_released: 1 });
  });

  it('a dry run is sent as such', async () => {
    mockedAxios.post.mockResolvedValue({
      status: 202,
      data: JSON.stringify({ trunk_pins_closed: 0, contracts_released: 0 }),
      headers: {}
    });

    await client.retire('svc', undefined, true);

    expect(mockedAxios.post.mock.calls[0][0]).toBe('/provide');
    expect(mockedAxios.post.mock.calls[0][1]).toEqual({ producername: 'svc', retired: true, dry_run: true });
  });

  it('a 403 names the role, the maintainer grant and the snapshot fallback', async () => {
    // The lazy wrong-server check answers 2.x, keeping the original error.
    mockedAxios.get.mockResolvedValue({ status: 200, data: JSON.stringify({ version: '2.2.0' }), headers: {} });
    mockedAxios.post.mockRejectedValue({
      response: { status: 403, data: JSON.stringify({ error: "requires the 'releaser' role" }), headers: {} }
    });

    await expect(client.retire('svc')).rejects.toThrow(/releaser/);
    mockedAxios.post.mockRejectedValue({
      response: { status: 403, data: JSON.stringify({ error: "requires the 'releaser' role" }), headers: {} }
    });
    await expect(client.retire('svc')).rejects.toThrow(/maintainer/);
  });
});

describe('line endings', () => {
  it('normalizes CRLF to LF, and leaves LF content alone', () => {
    // Byte-for-byte comparison server-side: a CRLF checkout must hash the
    // same as an LF one, or the same commit conflicts with itself depending
    // on which runner published it.
    expect(normalizeLineEndings('a\r\nb\rc\n')).toBe('a\nb\nc\n');
    const lf = 'a\nb\n';
    expect(normalizeLineEndings(lf)).toBe(lf);
  });

  it('provide uploads LF content', async () => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockedAxios as any);
    const client = new SanshainClient('http://localhost:3000');
    mockedAxios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });

    await client.provide({
      producername: 'svc',
      openapi_yaml: 'openapi: 3.0.3\r\ninfo:\r\n  title: T\r',
      stability: 'snapshot'
    });

    const sent = mockedAxios.post.mock.calls[0][1] as { openapi_yaml: string };
    expect(sent.openapi_yaml).toBe('openapi: 3.0.3\ninfo:\n  title: T\n');
  });
});

describe('harvested subscriptions', () => {
  it('ride the response and classify advisories', async () => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockedAxios as any);
    const client = new SanshainClient('http://localhost:3000');
    mockedAxios.post.mockResolvedValue({
      status: 202,
      data: JSON.stringify({
        version: '1.0.0',
        stability: 'snapshot',
        content_hash: 'sha256:abc',
        changes: { inserts: 0, updates: 0, deletes: 0 },
        harvested_subscriptions: [
          { channel: 'user/signup', message_name: 'UserSignedUp', owner: 'accounts' },
          { channel: 'order/placed', message_name: 'OrderPlaced', drift: "expects 'total'" }
        ]
      }),
      headers: {}
    });

    const res = await client.provideAsyncApi({ producername: 'p', asyncapi_yaml: 'x', stability: 'snapshot' });
    const subs = res?.harvested_subscriptions ?? [];
    expect(subs).toHaveLength(2);
    expect(isAdvisory(subs[0])).toBe(false);
    expect(describeSubscription(subs[0])).toContain('accounts');
    expect(isAdvisory(subs[1])).toBe(true);
    expect(describeSubscription(subs[1])).toContain('no publisher yet');
    expect(describeSubscription(subs[1])).toContain('total');
  });
});

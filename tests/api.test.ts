import axios from 'axios';
import { SanshainClient, VersionConflictError, UnknownVersionError, AbsentEndpointError, warningsOf } from '../src/api';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Sanshain API Client', () => {
  let client: SanshainClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockedAxios as any);
    client = new SanshainClient('http://localhost:3000', 'test-token');
  });

  it('should send stability and no branch-era fields on provide', async () => {
    const responseBody = {
      version: '1.2.0',
      stability: 'snapshot',
      content_hash: 'sha256:abc',
      changes: { inserts: 3, updates: 0, deletes: 0 }
    };
    mockedAxios.post.mockResolvedValue({ status: 202, data: JSON.stringify(responseBody), headers: {} });

    const result = await client.provide({
      producername: 'test-service',
      openapi_yaml: 'spec: content',
      stability: 'snapshot'
    });

    expect(result).toEqual(responseBody);
    expect(mockedAxios.post).toHaveBeenCalledWith('/provide', expect.any(Object), expect.any(Object));
    const sentPayload = mockedAxios.post.mock.calls[0][1] as any;
    expect(sentPayload.producername).toBe('test-service');
    expect(sentPayload.stability).toBe('snapshot');
    expect(sentPayload).not.toHaveProperty('branch');
    expect(sentPayload).not.toHaveProperty('base_version');
    expect(sentPayload).not.toHaveProperty('force');
    expect(sentPayload).not.toHaveProperty('api_type');
  });

  it('should send the pinned version and no branch/timeout on require', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: 'yaml content', headers: {} });

    const content = await client.require('client', 'service', '1.2.0', '/path', 'GET');

    expect(content.content).toBe('yaml content');
    expect(mockedAxios.get).toHaveBeenCalledWith('/require', expect.objectContaining({
      params: {
        consumername: 'client',
        producername: 'service',
        version: '1.2.0',
        path: '/path',
        method: 'GET',
        dry_run: undefined
      }
    }));
    const sentParams = (mockedAxios.get.mock.calls[0][1] as any).params;
    expect(sentParams).not.toHaveProperty('branch');
    expect(sentParams).not.toHaveProperty('timeout');
  });

  it('should send the pinned version on require-bundle', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'merged yaml', headers: {} });

    const payload = {
      consumername: 'client',
      producername: 'service',
      version: '2.0.1',
      endpoints: [{ path: '/p', method: 'GET' }]
    };
    const content = await client.requireBundle(payload);

    expect(content.content).toBe('merged yaml');
    expect(mockedAxios.post).toHaveBeenCalledWith('/require-bundle', { ...payload, api_type: 'openapi' }, expect.any(Object));
    const sentPayload = mockedAxios.post.mock.calls[0][1] as any;
    expect(sentPayload).not.toHaveProperty('branch');
    expect(sentPayload).not.toHaveProperty('timeout');
  });

  it('should surface the server message and proposed_version on 409', async () => {
    mockedAxios.post.mockRejectedValue({
      response: {
        status: 409,
        data: JSON.stringify({
          error: 'version 1.2.0 is GA and immutable',
          proposed_version: '1.3.0'
        }),
        headers: {}
      }
    });
    // The lazy /version diagnosis runs on failure; a 2.x server keeps the 409.
    mockedAxios.get.mockResolvedValue({ status: 200, data: JSON.stringify({ version: '2.0.0' }), headers: {} });

    const promise = client.provide({
      producername: 'test-service',
      openapi_yaml: 'spec: content',
      stability: 'ga'
    });

    await expect(promise).rejects.toBeInstanceOf(VersionConflictError);
    await promise.catch((error: VersionConflictError) => {
      expect(error.message).toContain('version 1.2.0 is GA and immutable');
      expect(error.proposedVersion).toBe('1.3.0');
    });
  });

  it('should replace the error with an upgrade hint when the server is pre-2.0', async () => {
    mockedAxios.post.mockRejectedValue({
      response: {
        status: 400,
        data: JSON.stringify({ error: 'missing field branch' }),
        headers: {}
      }
    });
    mockedAxios.get.mockResolvedValue({ status: 200, data: JSON.stringify({ version: '1.7.3' }), headers: {} });

    await expect(client.provide({
      producername: 'test-service',
      openapi_yaml: 'spec: content',
      stability: 'snapshot'
    })).rejects.toThrow(
      'Sanshain server at http://localhost:3000 is 1.7.3; this client requires Sanshain 2.x — upgrade the server.'
    );
    expect(mockedAxios.get).toHaveBeenCalledWith('/version', expect.any(Object));
  });

  it('should only check the server version once per client instance', async () => {
    mockedAxios.get
      .mockRejectedValueOnce({
        response: { status: 404, data: JSON.stringify({ error: 'unknown version' }), headers: {} }
      })
      .mockResolvedValueOnce({ status: 200, data: JSON.stringify({ version: '2.1.0' }), headers: {} })
      .mockRejectedValueOnce({
        response: { status: 404, data: JSON.stringify({ error: 'unknown version' }), headers: {} }
      });

    await expect(client.require('c', 'p', '9.9.9', '/x', 'GET')).rejects.toBeInstanceOf(UnknownVersionError);
    await expect(client.require('c', 'p', '9.9.9', '/x', 'GET')).rejects.toBeInstanceOf(UnknownVersionError);

    const versionCalls = mockedAxios.get.mock.calls.filter((call) => call[0] === '/version');
    expect(versionCalls).toHaveLength(1);
  });

  it('should explain a 404 as an unknown producer or version', async () => {
    mockedAxios.get
      .mockRejectedValueOnce({
        response: { status: 404, data: JSON.stringify({ error: 'no such version 9.9.9' }), headers: {} }
      })
      .mockResolvedValueOnce({ status: 200, data: JSON.stringify({ version: '2.0.0' }), headers: {} });

    const promise = client.require('client', 'service', '9.9.9', '/path', 'GET');
    await expect(promise).rejects.toBeInstanceOf(UnknownVersionError);
    await promise.catch((error: Error) => {
      expect(error.message).toContain('Unknown producer or version (404)');
      expect(error.message).toContain('no such version 9.9.9');
      expect(error.message).toContain('check the pinned version');
    });
  });

  it('should explain a 410 as a deliberately absent endpoint', async () => {
    mockedAxios.get
      .mockRejectedValueOnce({
        response: { status: 410, data: JSON.stringify({ error: 'endpoint GET /path absent from 1.0.0' }), headers: {} }
      })
      .mockResolvedValueOnce({ status: 200, data: JSON.stringify({ version: '2.0.0' }), headers: {} });

    const promise = client.require('client', 'service', '1.0.0', '/path', 'GET');
    await expect(promise).rejects.toBeInstanceOf(AbsentEndpointError);
    await promise.catch((error: Error) => {
      expect(error.message).toContain('Absent endpoint (410)');
      expect(error.message).toContain('deliberately does not include');
    });
  });
});

describe('Sanshain-Warning collection', () => {
  it('reads the separate header lines from the raw response, never splitting a joined value', () => {
    expect(warningsOf({ headers: {} })).toEqual([]);
    expect(warningsOf({ headers: { 'sanshain-warning': 'a, b' } })).toEqual(['a, b']);
    expect(warningsOf({ headers: { 'sanshain-warning': ['a, b', 'c'] } })).toEqual(['a, b', 'c']);
    expect(
      warningsOf({
        headers: { 'sanshain-warning': 'a, b, c' },
        request: { res: { headersDistinct: { 'sanshain-warning': ['a, b', 'c'] } } }
      })
    ).toEqual(['a, b', 'c']);
  });

  it('collects from success and error responses, and takeWarnings forgets them', async () => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockedAxios as any);
    const client = new SanshainClient('http://localhost:3000');
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: 'x', headers: { 'sanshain-warning': 'one' } });
    await client.require('c', 'p', '1.0.0', '/x', 'GET');
    expect(client.takeWarnings()).toEqual(['one']);
    expect(client.takeWarnings()).toEqual([]);

    mockedAxios.post.mockRejectedValueOnce({
      response: { status: 500, data: '{}', headers: { 'sanshain-warning': 'two' } }
    });
    mockedAxios.get.mockResolvedValueOnce({ status: 200, data: JSON.stringify({ version: '2.4.0' }), headers: {} });
    await expect(client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot' })).rejects.toThrow();
    expect(client.takeWarnings()).toEqual(['two']);
  });

  it('a catalog without recorded counts as recorded', async () => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockedAxios as any);
    const client = new SanshainClient('http://localhost:3000');
    mockedAxios.put.mockResolvedValueOnce({ status: 200, data: JSON.stringify({ system: 's', trunk: false, resources: [] }), headers: {} });
    expect((await client.pushCatalog('s', 'x')).recorded).toBe(true);
    mockedAxios.put.mockResolvedValueOnce({
      status: 200,
      data: JSON.stringify({ system: 's', trunk: false, resources: [], recorded: false }),
      headers: {}
    });
    expect((await client.pushCatalog('s', 'x')).recorded).toBe(false);
  });

  it('over real HTTP, repeated header lines arrive as separate warnings', async () => {
    const http = require('http');
    const realAxios = jest.requireActual('axios');
    const server = http.createServer((req: any, res: any) => {
      res.setHeader('Sanshain-Warning', ['first, with a comma', 'second']);
      res.statusCode = req.url === '/provide' ? 202 : 404;
      res.end(JSON.stringify({ version: '1.0.0', stability: 'snapshot', content_hash: 'h', changes: {} }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      mockedAxios.create.mockImplementation((config: any) => realAxios.create(config));
      const client = new SanshainClient(`http://127.0.0.1:${server.address().port}`);
      await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot', tag: 'R9' });
      expect(client.takeWarnings()).toEqual(['first, with a comma', 'second']);
    } finally {
      mockedAxios.create.mockReset();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

import axios from 'axios';
import { SanshainClient } from '../src/api';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Sanshain API Client', () => {
  let client: SanshainClient;

  beforeEach(() => {
    mockedAxios.create.mockReturnValue(mockedAxios as any);
    client = new SanshainClient('http://localhost:3000', 'test-token');
  });

  it('should call provide endpoint with correct data', async () => {
    mockedAxios.post.mockResolvedValue({ status: 202 });

    const payload = {
      servicename: 'test-service',
      branch: 'main',
      openapi_yaml: 'spec: content'
    };
    await client.provide(payload);

    expect(mockedAxios.post).toHaveBeenCalledWith('/provide', payload, expect.any(Object));
  });

  it('should call require endpoint with correct params', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: 'yaml content' });

    const content = await client.require('client', 'service', 'main', '/path', 'GET');

    expect(content).toBe('yaml content');
    expect(mockedAxios.get).toHaveBeenCalledWith('/require', expect.objectContaining({
      params: {
        clientname: 'client',
        servicename: 'service',
        branch: 'main',
        path: '/path',
        method: 'GET',
        timeout: undefined,
        dry_run: undefined
      }
    }));
  });

  it('should call require-bundle endpoint with correct data', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: 'merged yaml' });

    const payload = {
      clientname: 'client',
      servicename: 'service',
      branch: 'main',
      endpoints: [{ path: '/p', method: 'GET' }]
    };
    const content = await client.requireBundle(payload);

    expect(content).toBe('merged yaml');
    expect(mockedAxios.post).toHaveBeenCalledWith('/require-bundle', payload, expect.any(Object));
  });
});

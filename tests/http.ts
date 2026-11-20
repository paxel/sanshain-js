/** The HTTP layer of the tests: the automocked axios, and a local server for the tests over real HTTP. */
import http from 'http';
import { AddressInfo } from 'net';
import { CreateAxiosDefaults } from 'axios';

/** The fields of a body or of a query the client sent; a test reads them by name. */
export type Fields = Record<string, unknown>;

/** The options of a call as the tests read them. */
export interface RequestOptions {
  params: Fields;
  headers: Record<string, string | undefined>;
}

/**
 * The automocked axios as the tests arrange and inspect it: `jest.mock('axios')` in the test
 * file replaces every function of the module by a mock. A call takes the path, then the body
 * (post, put) and the options.
 */
export interface MockedHttp {
  create: jest.Mock<unknown, [config: CreateAxiosDefaults]>;
  get: jest.Mock<Promise<unknown>, [url: string, options: RequestOptions]>;
  post: jest.Mock<Promise<unknown>, [url: string, body: Fields, options: RequestOptions]>;
  put: jest.Mock<Promise<unknown>, [url: string, body: Fields, options: RequestOptions]>;
}

/** The nth call of a mocked function; reading a call that was never made fails the test here. */
export function nthCall<A extends unknown[]>(mocked: { mock: { calls: A[] } }, n: number): A {
  const found = mocked.mock.calls[n];
  if (!found) throw new Error(`call ${String(n)} was never made`);
  return found;
}

/** Let the mocked axios hand out real clients, for a test against a local server. */
export function useRealHttp(mocked: MockedHttp): void {
  const real = jest.requireActual<typeof import('axios')>('axios');
  mocked.create.mockImplementation((config) => real.create(config));
}

/** Start the server on a free local port and give the URL that reaches it. */
export async function listening(server: http.Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
}

/** Stop the server and wait until it has closed. */
export async function closed(server: http.Server): Promise<void> {
  await new Promise((resolve) => {
    server.close(resolve);
  });
}

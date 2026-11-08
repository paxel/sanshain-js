/** Annotations: filling the placeholders, and where they travel on the wire. */
import axios from 'axios';
import { ANNOTATIONS_DROPPED_WARNING, Annotation, SanshainClient } from '../src/api';
import { fillAnnotations, parseSet } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const entry = (value: string, name = 'link', scope: Annotation['scope'] = 'version'): Annotation => ({ scope, name, value });
const sets = (...pairs: [string, string][]) => new Map(pairs);

describe('fillAnnotations', () => {
  it('fills from the flag and the environment', () => {
    const filled = fillAnnotations([entry('x-{{A}}-{{B}}')], sets(['A', '1']), { SANSHAIN_SET_B: '2' });
    expect(filled).toEqual({ annotations: [entry('x-1-2')], warnings: [] });
  });

  it('the flag wins over the environment', () => {
    const filled = fillAnnotations([entry('{{A}}')], sets(['A', 'f']), { SANSHAIN_SET_A: 'e' });
    expect(filled.annotations).toEqual([entry('f')]);
  });

  it('fills a placeholder used twice', () => {
    expect(fillAnnotations([entry('{{A}}/{{A}}')], sets(['A', '7']), {}).annotations).toEqual([entry('7/7')]);
  });

  it('leaves out an entry with an unfilled placeholder, naming entry and placeholder, and keeps the others', () => {
    const filled = fillAnnotations(
      [entry('first'), entry('id-{{MISSING}}', 'requirements'), entry('last', 'jenkins', 'system')],
      sets(),
      {}
    );
    expect(filled.annotations).toEqual([entry('first'), entry('last', 'jenkins', 'system')]);
    expect(filled.warnings).toEqual([
      "annotation 'requirements' left out: {{MISSING}} is not set (--set MISSING=… or SANSHAIN_SET_MISSING)"
    ]);
  });

  it('names the first unfilled placeholder of an entry', () => {
    const filled = fillAnnotations([entry('{{AREA}}/{{ID}}/{{X}}', 'requirements')], sets(['AREA', '7']), {});
    expect(filled.warnings).toEqual([
      "annotation 'requirements' left out: {{ID}} is not set (--set ID=… or SANSHAIN_SET_ID)"
    ]);
  });

  it('an empty flag is unfilled and does not fall through to the environment', () => {
    const empty = fillAnnotations([entry('{{A}}')], sets(['A', '']), {});
    expect(empty.annotations).toEqual([]);
    expect(empty.warnings).toHaveLength(1);
    const masked = fillAnnotations([entry('{{A}}')], sets(['A', '']), { SANSHAIN_SET_A: 'e' });
    expect(masked.annotations).toEqual([]);
    expect(masked.warnings).toHaveLength(1);
  });

  it('an empty environment variable is unfilled', () => {
    expect(fillAnnotations([entry('{{A}}')], sets(), { SANSHAIN_SET_A: '' }).annotations).toEqual([]);
  });

  it('keeps a value without placeholders unchanged', () => {
    expect(fillAnnotations([entry('plain value')], sets(), {})).toEqual({ annotations: [entry('plain value')], warnings: [] });
  });

  it('keeps braces that are not a placeholder as literal text', () => {
    const literal = ['{{ A }}', '{{a-b}}', '{{}}'].map((v) => entry(v));
    const filled = fillAnnotations(literal, sets(['A', 'x'], ['a-b', 'y']), { 'SANSHAIN_SET_a-b': 'z' });
    expect(filled).toEqual({ annotations: literal, warnings: [] });
  });

  it('reads the environment variable in exact case', () => {
    expect(fillAnnotations([entry('{{id}}')], sets(), { SANSHAIN_SET_ID: 'upper' }).annotations).toEqual([]);
    expect(fillAnnotations([entry('{{id}}')], sets(), { SANSHAIN_SET_id: 'lower' }).annotations).toEqual([entry('lower')]);
  });

  it('a name that is an Object property is no flag', () => {
    expect(fillAnnotations([entry('{{constructor}}')], sets(), {}).annotations).toEqual([]);
  });

  it('inserts a value literally, $ patterns included', () => {
    expect(fillAnnotations([entry('{{A}}')], sets(['A', "$&$1$'"]), {}).annotations).toEqual([entry("$&$1$'")]);
  });

  it('sends exactly scope, name and value', () => {
    const extra = { scope: 'system', name: 'n', value: 'v', colour: 'red' } as Annotation;
    expect(fillAnnotations([extra], sets(), {}).annotations).toEqual([{ scope: 'system', name: 'n', value: 'v' }]);
  });

  it('nothing declared is nothing to send', () => {
    expect(fillAnnotations(undefined)).toEqual({ annotations: [], warnings: [] });
  });
});

describe('parseSet', () => {
  it('splits at the first =', () => {
    expect(parseSet('A=x=y')).toEqual(['A', 'x=y']);
    expect(parseSet('A=')).toEqual(['A', '']);
  });

  it('refuses an argument without a name or without =', () => {
    expect(() => parseSet('A')).toThrow("expected NAME=value, got 'A'");
    expect(() => parseSet('=x')).toThrow("expected NAME=value, got '=x'");
  });
});

// What a service before 2.13.0 answers, in its real shape: the refusal lists
// every field it does know — the origin fields among them.
const PROVIDE_REFUSAL =
  'Failed to deserialize the JSON body into the target type: unknown field `annotations`, expected one of ' +
  '`producername`, `openapi_yaml`, `stability`, `build_url`, `change_url`, `tickets`, `note`, `dry_run`, `trunk`, `tag`, `retired`';
const BUNDLE_REFUSAL =
  'Failed to deserialize the JSON body into the target type: unknown field `annotations`, expected one of ' +
  '`consumername`, `producername`, `version`, `endpoints`, `api_type`, `dry_run`, `trunk`, `tag`';
const CATALOG_REFUSAL =
  'Failed to deserialize the JSON body into the target type: unknown field `annotations`, expected one of ' +
  '`catalog_info_yaml`, `trunk`';
const REQUIRE_REFUSAL =
  'Failed to deserialize query string: unknown field `annotations`, expected one of ' +
  '`consumername`, `producername`, `version`, `path`, `method`, `dry_run`, `trunk`, `tag`, `format`';

const PROVIDE_OK = JSON.stringify({
  version: '1.0.0',
  stability: 'snapshot',
  content_hash: 'sha256:abc',
  changes: { inserts: 0, updates: 0, deletes: 0 }
});

const VERSION_ANNOTATION = entry('http://solar.system/id-7/requirements/42', 'requirements', 'version');
const SYSTEM_ANNOTATION = entry('https://jenkins.corp/job/payments', 'jenkins', 'system');
const BOTH = [VERSION_ANNOTATION, SYSTEM_ANNOTATION];

const refusal = (status: number, body: string) => ({ response: { status, data: body, headers: {} } });

describe('annotations on the wire', () => {
  let client: SanshainClient;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(mockedAxios as any);
    client = new SanshainClient('http://localhost:3000');
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('a provide sends every annotation, both scopes, in the body', async () => {
    mockedAxios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });

    await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot', annotations: BOTH });
    await client.provideAsyncApi({ producername: 'p', asyncapi_yaml: 'x', stability: 'snapshot', annotations: BOTH });
    await client.provideProto({ producername: 'p', proto_content: 'x', stability: 'snapshot', annotations: BOTH });

    for (const call of mockedAxios.post.mock.calls) {
      expect((call[1] as any).annotations).toEqual(BOTH);
    }
  });

  it('a provide without annotations sends no field', async () => {
    mockedAxios.post.mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });

    await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot', annotations: [] });
    await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot' });

    expect(mockedAxios.post.mock.calls[0][1]).not.toHaveProperty('annotations');
    expect(mockedAxios.post.mock.calls[1][1]).not.toHaveProperty('annotations');
  });

  it('a retire sends none', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: '{}', headers: {} });

    await client.retire('p', 'asyncapi');

    expect(mockedAxios.post.mock.calls[0][1]).toEqual({ producername: 'p', retired: true });
  });

  it('a require sends the system ones as a JSON array in the query', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: Buffer.from('paths: {}'), headers: {} });

    await client.require('c', 'p', '1.0.0', '/x', 'GET', false, undefined, undefined, undefined, undefined, BOTH);

    const params = mockedAxios.get.mock.calls[0][1]?.params as Record<string, unknown>;
    expect(params.annotations).toBe(JSON.stringify([SYSTEM_ANNOTATION]));
  });

  it('a require with only version annotations sends no parameter', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: Buffer.from('paths: {}'), headers: {} });

    await client.require('c', 'p', '1.0.0', '/x', 'GET', false, undefined, undefined, undefined, undefined, [VERSION_ANNOTATION]);

    expect(mockedAxios.get.mock.calls[0][1]?.params).not.toHaveProperty('annotations');
  });

  it('a bundle sends the system ones in the body', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: Buffer.from('paths: {}'), headers: {} });

    await client.requireBundle({
      consumername: 'c',
      producername: 'p',
      version: '1.0.0',
      endpoints: [{ path: '/x', method: 'GET' }],
      annotations: BOTH
    });

    expect((mockedAxios.post.mock.calls[0][1] as any).annotations).toEqual([SYSTEM_ANNOTATION]);
  });

  it('a catalog push sends the system ones in the body', async () => {
    mockedAxios.put.mockResolvedValue({ status: 200, data: JSON.stringify({ system: 's', trunk: false, resources: [] }), headers: {} });

    await client.pushCatalog('s', 'yaml', undefined, false, BOTH);

    expect(mockedAxios.put.mock.calls[0][1]).toEqual({ catalog_info_yaml: 'yaml', annotations: [SYSTEM_ANNOTATION] });
  });

  it('an older service refusing them on a provide: repeated once without them, the origin kept, warned once', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(refusal(422, PROVIDE_REFUSAL))
      .mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });

    await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot', build_url: 'https://ci/1', annotations: BOTH });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect((mockedAxios.post.mock.calls[0][1] as any).annotations).toEqual(BOTH);
    const repeated = mockedAxios.post.mock.calls[1][1] as any;
    expect(repeated).not.toHaveProperty('annotations');
    // The refusal lists build_url among the expected fields: no origin fallback.
    expect(repeated.build_url).toBe('https://ci/1');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(`⚠ ${ANNOTATIONS_DROPPED_WARNING}`);

    // The rest of the run sends none, without warning again.
    await client.provideAsyncApi({ producername: 'p', asyncapi_yaml: 'x', stability: 'snapshot', annotations: BOTH });
    expect(mockedAxios.post.mock.calls[2][1]).not.toHaveProperty('annotations');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a 422 naming another field is no annotations refusal', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: JSON.stringify({ version: '2.13.0' }), headers: {} });
    mockedAxios.post.mockRejectedValue(
      refusal(422, 'Failed to deserialize the JSON body into the target type: unknown field `colour`, expected one of `annotations`')
    );

    await expect(client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot', annotations: BOTH })).rejects.toThrow(
      /422/
    );
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a 2.8 service refusing annotations, then the origin, gets the provide without both', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(refusal(422, PROVIDE_REFUSAL))
      .mockRejectedValueOnce(refusal(422, 'Failed to deserialize the JSON body into the target type: unknown field `build_url`, expected one of `producername`'))
      .mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });

    await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot', build_url: 'https://ci/1', annotations: BOTH });

    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    const last = mockedAxios.post.mock.calls[2][1] as any;
    expect(last).not.toHaveProperty('annotations');
    expect(last).not.toHaveProperty('build_url');
    expect(last.producername).toBe('p');
  });

  it('a 2.8 service refusing the origin, then annotations, gets the provide without both', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(refusal(422, 'Failed to deserialize the JSON body into the target type: unknown field `build_url`, expected one of `producername`'))
      .mockRejectedValueOnce(refusal(422, PROVIDE_REFUSAL))
      .mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });

    await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot', build_url: 'https://ci/1', annotations: BOTH });

    expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    expect((mockedAxios.post.mock.calls[1][1] as any).annotations).toEqual(BOTH);
    const last = mockedAxios.post.mock.calls[2][1] as any;
    expect(last).not.toHaveProperty('annotations');
    expect(last).not.toHaveProperty('build_url');
  });

  it('a refusal read from a Buffer body, as the real HTTP layer hands it over, is recognised', async () => {
    mockedAxios.post
      .mockRejectedValueOnce({ response: { status: 422, data: Buffer.from(PROVIDE_REFUSAL), headers: {} } })
      .mockResolvedValue({ status: 202, data: PROVIDE_OK, headers: {} });

    await client.provide({ producername: 'p', openapi_yaml: 'x', stability: 'snapshot', annotations: BOTH });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect(mockedAxios.post.mock.calls[1][1]).not.toHaveProperty('annotations');
  });

  it('an older service refusing the require parameter with 400: repeated once without it, before the format check', async () => {
    mockedAxios.get
      .mockRejectedValueOnce(refusal(400, REQUIRE_REFUSAL))
      .mockResolvedValue({ status: 200, data: Buffer.from('openapi: 3.0.3\npaths: {}\n'), headers: {} });

    const result = await client.require('c', 'p', '1.0.0', 'user/signup', 'SUB', false, 'asyncapi', undefined, undefined, 'openapi', BOTH);

    expect(result.content).toContain('openapi: 3.0.3');
    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(mockedAxios.get.mock.calls[0][1]?.params).toHaveProperty('annotations');
    expect(mockedAxios.get.mock.calls[1][1]?.params).not.toHaveProperty('annotations');
    expect(mockedAxios.get.mock.calls[1][1]?.params).toMatchObject({ format: 'openapi' });
    expect(warn).toHaveBeenCalledWith(`⚠ ${ANNOTATIONS_DROPPED_WARNING}`);
  });

  it('an older service refusing them on a bundle: repeated once without them', async () => {
    mockedAxios.post
      .mockRejectedValueOnce(refusal(422, BUNDLE_REFUSAL))
      .mockResolvedValue({ status: 200, data: Buffer.from('paths: {}'), headers: {} });

    await client.requireBundle({ consumername: 'c', producername: 'p', version: '1.0.0', endpoints: [{ path: '/x', method: 'GET' }], annotations: BOTH });

    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
    expect((mockedAxios.post.mock.calls[0][1] as any).annotations).toEqual([SYSTEM_ANNOTATION]);
    expect(mockedAxios.post.mock.calls[1][1]).not.toHaveProperty('annotations');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('an older service refusing them on a catalog push: repeated once without them', async () => {
    mockedAxios.put
      .mockRejectedValueOnce(refusal(422, CATALOG_REFUSAL))
      .mockResolvedValue({ status: 200, data: JSON.stringify({ system: 's', trunk: false, resources: [] }), headers: {} });

    const pushed = await client.pushCatalog('s', 'yaml', undefined, false, BOTH);

    expect(pushed.recorded).toBe(true);
    expect(mockedAxios.put).toHaveBeenCalledTimes(2);
    expect(mockedAxios.put.mock.calls[1][1]).toEqual({ catalog_info_yaml: 'yaml' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a call that sent no annotations never treats a refusal as theirs', async () => {
    mockedAxios.get.mockResolvedValue({ status: 200, data: JSON.stringify({ version: '2.13.0' }), headers: {} });
    mockedAxios.put.mockRejectedValue(refusal(422, CATALOG_REFUSAL));

    await expect(client.pushCatalog('s', 'yaml', undefined, false, [VERSION_ANNOTATION])).rejects.toThrow(/422/);
    expect(mockedAxios.put).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it('over real HTTP, the require parameter arrives as the JSON array it was', async () => {
    const http = require('http');
    const realAxios = jest.requireActual('axios');
    let received: string | null = null;
    const server = http.createServer((req: any, res: any) => {
      received = new URL(req.url, 'http://localhost').searchParams.get('annotations');
      res.statusCode = 200;
      res.end('paths: {}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      mockedAxios.create.mockImplementation((config: any) => realAxios.create(config));
      const realClient = new SanshainClient(`http://127.0.0.1:${server.address().port}`);
      const tricky = entry('https://x.corp/a?b=1&c=2+3 #frag "q" ü', 'jenkins', 'system');
      await realClient.require('c', 'p', '1.0.0', '/x', 'GET', false, undefined, undefined, undefined, undefined, [tricky]);
      expect(JSON.parse(received ?? 'null')).toEqual([tricky]);
    } finally {
      mockedAxios.create.mockReset();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

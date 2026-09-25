import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import {
  createApiClient,
  queryString,
  AppException,
  ErrorCodes,
  noContentSchema,
  type ApiFailure,
  type Meta,
} from '../src/index';

/** Callers get unwrapped `data` or a typed throw — never an envelope or a raw Response. */

const meta: Meta = { requestId: 'req-test-0001' };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const success = (data: unknown, extra: Partial<Meta> = {}) =>
  json(200, { success: true, data, meta: { ...meta, ...extra } });

const failure = (status: number, error: ApiFailure['error']) =>
  json(status, { success: false, error, meta } satisfies ApiFailure);

/** Builds a client over a scripted queue of responses, recording each call. */
function clientWith(
  responses: Response[],
  tokens: { access?: string; refresh?: string } = {},
  headers?: Readonly<Record<string, string>>,
) {
  const calls: { url: string; authorization: string | null; client: string | null }[] = [];
  const causes: unknown[] = [];
  let accessToken = tokens.access ?? null;

  const api = createApiClient({
    baseUrl: 'https://api.test',
    getAccessToken: () => accessToken,
    getRefreshToken: () => tokens.refresh ?? null,
    onTokensRefreshed: (next) => {
      accessToken = next.accessToken;
    },
    onUnauthorized: (cause) => causes.push(cause),
    headers,
    fetchImpl: ((url: string, init?: RequestInit) => {
      const requestHeaders = new Headers(init?.headers);
      calls.push({
        url,
        authorization: requestHeaders.get('Authorization'),
        client: requestHeaders.get('x-client'),
      });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected extra request to ${url}`);
      return Promise.resolve(next);
    }) as unknown as typeof fetch,
  });

  return { api, calls, causes };
}

const schema = z.object({ id: z.string() });

describe('typed client — success', () => {
  it('reads a 204 with no body as no content, since Express drops the envelope', async () => {
    const { api } = clientWith([new Response(null, { status: 204 })], { access: 'valid' });

    assert.equal(await api.request('/thing', { schema: noContentSchema }), null);
  });

  it('still refuses a 204 where the call expected data', async () => {
    const { api } = clientWith([new Response(null, { status: 204 })], { access: 'valid' });

    await assert.rejects(
      api.request('/thing', { schema }),
      (e: unknown) => AppException.is(e) && e.code === ErrorCodes.INTERNAL,
    );
  });

  it('returns data, not the envelope', async () => {
    const { api } = clientWith([success({ id: 'abc' })]);

    const result = await api.request('/thing', { schema, anonymous: true });

    assert.deepEqual(result, { id: 'abc' });
  });

  it('rebuilds a page from data + meta', async () => {
    const { api } = clientWith([success(['a', 'b'], { page: 3, pageSize: 2, total: 11 })]);

    const page = await api.requestPaginated('/things', {
      schema: z.array(z.string()),
      anonymous: true,
    });

    assert.deepEqual(page, { items: ['a', 'b'], page: 3, pageSize: 2, total: 11 });
  });

  it('rejects a 200 whose data does not match the schema', async () => {
    const { api } = clientWith([success({ id: 42 })]);

    await assert.rejects(api.request('/thing', { schema, anonymous: true }), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'INTERNAL');
      return true;
    });
  });

  it('sends the app kind on every request', async () => {
    const { api, calls } = clientWith([success({ id: 'abc' })], {}, { 'x-client': 'MOBILE' });
    await api.request('/thing', { schema });
    assert.equal(calls[0]?.client, 'MOBILE');
  });
});

describe('typed client — failure', () => {
  it('throws an AppException carrying the server code and fieldErrors', async () => {
    const { api } = clientWith([
      failure(400, {
        code: 'VALIDATION_ERROR',
        message: 'Some of the details are not valid',
        fieldErrors: { mobile: ['Enter a valid 10-digit mobile number'] },
      }),
    ]);

    await assert.rejects(api.request('/thing', { schema, anonymous: true }), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.equal(error.httpStatus, 400);
      assert.deepEqual(error.fieldErrors, { mobile: ['Enter a valid 10-digit mobile number'] });
      return true;
    });
  });

  it('types a non-envelope error from a proxy by its status', async () => {
    const { api } = clientWith([json(502, { nginx: 'bad gateway' })]);

    await assert.rejects(api.request('/thing', { schema, anonymous: true }), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'INTERNAL');
      assert.equal(error.httpStatus, 502);
      return true;
    });
  });

  it('turns an unreachable API into the same typed error', async () => {
    const api = createApiClient({
      baseUrl: 'https://api.test',
      getAccessToken: () => null,
      getRefreshToken: () => null,
      fetchImpl: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
    });

    await assert.rejects(api.request('/thing', { schema, anonymous: true }), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'INTERNAL');
      return true;
    });
  });
});

describe('typed client — 401 handling', () => {
  it('refreshes and replays when the session merely expired', async () => {
    const { api, calls } = clientWith(
      [
        failure(401, { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' }),
        success({ accessToken: 'fresh', refreshToken: 'r2', expiresInSec: 900 }),
        success({ id: 'abc' }),
      ],
      { access: 'stale', refresh: 'r1' },
    );

    const result = await api.request('/thing', { schema });

    assert.deepEqual(result, { id: 'abc' });
    assert.equal(calls.length, 3);
    assert.equal(calls[1]?.url, 'https://api.test/auth/refresh');
    // The replay must carry the NEW token, or the retry is pointless.
    assert.equal(calls[2]?.authorization, 'Bearer fresh');
  });

  it('does not refresh on a 401 that means "wrong credential"', async () => {
    const { api, calls } = clientWith(
      [failure(401, { code: 'PIN_INVALID', message: 'Incorrect mobile number or PIN' })],
      { access: 'valid', refresh: 'r1' },
    );

    await assert.rejects(api.request('/thing', { schema }), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'PIN_INVALID');
      return true;
    });
    // One call only: refreshing here would hide the real code and could sign a perfectly good session out.
    assert.equal(calls.length, 1);
  });

  it('signs out at once, without refreshing, when the session was replaced', async () => {
    const { api, calls, causes } = clientWith(
      [
        failure(401, {
          code: 'SESSION_REPLACED',
          message: 'Replaced',
          details: { replacedBy: 'WEB' },
        }),
      ],
      { access: 'valid', refresh: 'r1' },
    );

    await assert.rejects(
      api.request('/thing', { schema }),
      (e: unknown) => AppException.is(e) && e.code === 'SESSION_REPLACED',
    );
    assert.equal(calls.length, 1, 'a refresh would only be refused the same way');
    assert.equal((causes[0] as AppException).code, 'SESSION_REPLACED');
  });

  /** The bug this prevents: a throttled refresh signing a student out with the clock still running. */
  it('asks the refresh again when it was throttled, rather than ending the sitting', async () => {
    const { api, calls, causes } = clientWith(
      [
        failure(401, { code: 'UNAUTHENTICATED', message: 'Expired' }),
        failure(429, { code: 'RATE_LIMITED', message: 'Too many requests' }),
        success({ accessToken: 'fresh', refreshToken: 'r2', expiresInSec: 900 }),
        success({ id: 'abc' }),
      ],
      { access: 'stale', refresh: 'r1' },
    );

    assert.deepEqual(await api.request('/thing', { schema }), { id: 'abc' });
    assert.equal(calls.length, 4, 'the throttled refresh is asked a second time');
    assert.deepEqual(causes, [], 'a throttle says nothing about whether the session is still good');
  });

  it('keeps the session when the refresh never gets through at all', async () => {
    const { api, causes } = clientWith(
      [
        failure(401, { code: 'UNAUTHENTICATED', message: 'Expired' }),
        ...Array.from({ length: 4 }, () => failure(429, { code: 'RATE_LIMITED', message: 'Busy' })),
      ],
      { access: 'stale', refresh: 'r1' },
    );

    await assert.rejects(
      api.request('/thing', { schema }),
      (e: unknown) => AppException.is(e) && e.httpStatus === 429,
      'the throttle is the error, not an expired session the student must sign in for',
    );
    assert.deepEqual(causes, [], 'the student stays signed in and can go on answering');
  });

  it('passes on why a refresh failed', async () => {
    const { api, causes } = clientWith(
      [
        failure(401, { code: 'UNAUTHENTICATED', message: 'Expired' }),
        failure(401, {
          code: 'SESSION_REPLACED',
          message: 'Replaced',
          details: { replacedBy: 'MOBILE' },
        }),
      ],
      { access: 'stale', refresh: 'r1' },
    );

    await assert.rejects(
      api.request('/thing', { schema }),
      (e: unknown) => AppException.is(e) && e.code === 'SESSION_REPLACED',
      'the replacement is the error, not the expired token that led to the refresh',
    );
    assert.equal((causes[0] as AppException).code, 'SESSION_REPLACED');
  });

  it('says why when a replacement lands between the refresh and the retry', async () => {
    const { api, causes } = clientWith(
      [
        failure(401, { code: 'UNAUTHENTICATED', message: 'Expired' }),
        success({ accessToken: 'fresh', refreshToken: 'r2', expiresInSec: 900 }),
        failure(401, {
          code: 'SESSION_REPLACED',
          message: 'Replaced',
          details: { replacedBy: 'WEB' },
        }),
      ],
      { access: 'stale', refresh: 'r1' },
    );

    await assert.rejects(api.request('/thing', { schema }));
    assert.equal((causes[0] as AppException | undefined)?.code, 'SESSION_REPLACED');
  });
});

describe('AppException', () => {
  it('round-trips through the wire form', () => {
    const original = new AppException(ErrorCodes.CONFLICT, 'That already exists', {
      fieldErrors: { mobile: ['Already registered'] },
    });

    const rebuilt = AppException.fromFailure({
      success: false,
      error: original.toApiError(),
      meta,
    });

    assert.equal(rebuilt.code, 'CONFLICT');
    assert.equal(rebuilt.message, 'That already exists');
    assert.deepEqual(rebuilt.fieldErrors, { mobile: ['Already registered'] });
    assert.equal(rebuilt.httpStatus, 409);
  });

  it('recognises its own across copies, where instanceof might not', () => {
    const structural = Object.assign(Object.create(AppException.prototype) as object, {
      [Symbol.for('iace.AppException')]: true,
    });

    assert.ok(AppException.is(structural));
    assert.ok(!AppException.is(new Error('plain')));
    assert.ok(!AppException.is({ code: 'NOT_FOUND' }));
  });

  it('defaults status and message from the code', () => {
    const error = new AppException(ErrorCodes.NOT_FOUND);

    assert.equal(error.httpStatus, 404);
    assert.equal(error.message, 'Not found');
  });
});

/** The wire format for a multi-select filter. Both failures here are silent. */
describe('queryString', () => {
  it('joins a multi-select filter into one param', () => {
    assert.equal(queryString({ subjectId: ['sub_1', 'sub_2'] }), '?subjectId=sub_1%2Csub_2');
  });

  /** Sent as `in: []`, this would empty the table rather than widen it. */
  it('drops an empty multi-select instead of sending it', () => {
    assert.equal(queryString({ subjectId: [] }), '');
    assert.equal(queryString({ q: 'ram', subjectId: [] }), '?q=ram');
  });

  it('still drops what it always dropped', () => {
    assert.equal(queryString({ q: '', branchId: undefined, page: null }), '');
  });

  it('carries primitives beside a set', () => {
    assert.equal(
      queryString({ page: 2, isActive: true, difficulty: ['LOW', 'HIGH'] }),
      '?page=2&isActive=true&difficulty=LOW%2CHIGH',
    );
  });
});

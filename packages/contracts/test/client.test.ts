import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import {
  createApiClient,
  AppException,
  ErrorCodes,
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
function clientWith(responses: Response[], tokens: { access?: string; refresh?: string } = {}) {
  const calls: { url: string; authorization: string | null }[] = [];
  let accessToken = tokens.access ?? null;

  const api = createApiClient({
    baseUrl: 'https://api.test',
    getAccessToken: () => accessToken,
    getRefreshToken: () => tokens.refresh ?? null,
    onTokensRefreshed: (next) => {
      accessToken = next.accessToken;
    },
    fetchImpl: ((url: string, init?: RequestInit) => {
      calls.push({
        url,
        authorization: new Headers(init?.headers).get('Authorization'),
      });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected extra request to ${url}`);
      return Promise.resolve(next);
    }) as unknown as typeof fetch,
  });

  return { api, calls };
}

const schema = z.object({ id: z.string() });

describe('typed client — success', () => {
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
    // One call only: refreshing here would hide the real code, and could sign
    // a perfectly good session out.
    assert.equal(calls.length, 1);
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

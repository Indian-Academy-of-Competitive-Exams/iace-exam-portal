import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { z } from 'zod';
import {
  createApiClient,
  createAdminApiClient,
  AppException,
  ErrorCodes,
  noContentSchema,
  type ApiClientOptions,
  type ApiFailure,
  type Meta,
} from '../src/index';
import { createApiCore, queryString } from '../src/client/core';

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

/** A request the network swallows: it answers nothing until the caller abandons it. */
const HANG = Symbol('hang');

/** Builds a core and a client over one scripted queue of responses, recording each call. */
function clientWith(
  responses: (Response | typeof HANG)[],
  tokens: { access?: string; refresh?: string } = {},
  headers?: Readonly<Record<string, string>>,
) {
  const calls: { url: string; authorization: string | null; client: string | null }[] = [];
  const causes: unknown[] = [];
  let accessToken = tokens.access ?? null;

  const options: ApiClientOptions = {
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
      if (next === HANG) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return Promise.resolve(next);
    }) as unknown as typeof fetch,
  };

  return {
    core: createApiCore(options),
    api: createApiClient(options),
    admin: createAdminApiClient(options).admin,
    calls,
    causes,
  };
}

const schema = z.object({ id: z.string() });

describe('typed client — success', () => {
  it('reads a 204 with no body as no content, since Express drops the envelope', async () => {
    const { core } = clientWith([new Response(null, { status: 204 })], { access: 'valid' });

    assert.equal(await core.request('/thing', { schema: noContentSchema }), null);
  });

  it('still refuses a 204 where the call expected data', async () => {
    const { core } = clientWith([new Response(null, { status: 204 })], { access: 'valid' });

    await assert.rejects(
      core.request('/thing', { schema }),
      (e: unknown) => AppException.is(e) && e.code === ErrorCodes.INTERNAL,
    );
  });

  /** A save sent as the tab closes has to be allowed to finish after it. */
  it('asks the browser to keep a keepalive write alive past the page, and no other', async () => {
    const kept: (boolean | undefined)[] = [];
    const core = createApiCore({
      baseUrl: 'https://api.test',
      getAccessToken: () => 'valid',
      getRefreshToken: () => null,
      onTokensRefreshed: () => undefined,
      fetchImpl: ((_url: string, init?: RequestInit) => {
        kept.push(init?.keepalive);
        return Promise.resolve(success({ id: 'a' }));
      }) as unknown as typeof fetch,
    });

    await core.write('PATCH', '/thing', schema, { id: 'a' }, { keepalive: true });
    await core.write('PATCH', '/thing', schema, { id: 'a' });

    assert.deepEqual(kept, [true, undefined]);
  });

  /** A superseded search must be abortable, and the signal is transport, not a filter. */
  it('hands the signal of a list query to the fetch, and keeps it out of the URL', async () => {
    const seen: { url: string; signal?: AbortSignal | null }[] = [];
    const core = createApiCore({
      baseUrl: 'https://api.test',
      getAccessToken: () => 'valid',
      getRefreshToken: () => null,
      onTokensRefreshed: () => undefined,
      fetchImpl: ((url: string, init?: RequestInit) => {
        seen.push({ url, signal: init?.signal });
        return Promise.resolve(success([], { page: 1, pageSize: 20, total: 0 }));
      }) as unknown as typeof fetch,
    });
    const abort = new AbortController();

    await core.list('/things', { q: 'ssc', signal: abort.signal }, schema);

    assert.equal(seen[0]?.url, 'https://api.test/things?q=ssc');
    assert.equal(seen[0]?.signal, abort.signal);
  });

  it('returns data, not the envelope', async () => {
    const { core } = clientWith([success({ id: 'abc' })]);

    const result = await core.request('/thing', { schema, anonymous: true });

    assert.deepEqual(result, { id: 'abc' });
  });

  it('rebuilds a page from data + meta', async () => {
    const { core } = clientWith([success(['a', 'b'], { page: 3, pageSize: 2, total: 11 })]);

    const page = await core.requestPaginated('/things', {
      schema: z.array(z.string()),
      anonymous: true,
    });

    assert.deepEqual(page, { items: ['a', 'b'], page: 3, pageSize: 2, total: 11 });
  });

  it('rejects a 200 whose data does not match the schema', async () => {
    const { core } = clientWith([success({ id: 42 })]);

    await assert.rejects(core.request('/thing', { schema, anonymous: true }), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'INTERNAL');
      return true;
    });
  });

  it('sends the app kind on every request', async () => {
    const { core, calls } = clientWith([success({ id: 'abc' })], {}, { 'x-client': 'MOBILE' });
    await core.request('/thing', { schema });
    assert.equal(calls[0]?.client, 'MOBILE');
  });

  it('reaches a nested admin method', async () => {
    const { admin, calls } = clientWith([new Response(null, { status: 204 })], { access: 'valid' });
    assert.equal(await admin.branches.remove('b1'), null);
    assert.equal(calls.length, 1);
  });
});

describe('typed client — failure', () => {
  it('throws an AppException carrying the server code and fieldErrors', async () => {
    const { core } = clientWith([
      failure(400, {
        code: 'VALIDATION_ERROR',
        message: 'Some of the details are not valid',
        fieldErrors: { mobile: ['Enter a valid 10-digit mobile number'] },
      }),
    ]);

    await assert.rejects(core.request('/thing', { schema, anonymous: true }), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'VALIDATION_ERROR');
      assert.equal(error.httpStatus, 400);
      assert.deepEqual(error.fieldErrors, { mobile: ['Enter a valid 10-digit mobile number'] });
      return true;
    });
  });

  it('types a non-envelope error from a proxy by its status', async () => {
    const { core } = clientWith([json(502, { nginx: 'bad gateway' })]);

    await assert.rejects(core.request('/thing', { schema, anonymous: true }), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'INTERNAL');
      assert.equal(error.httpStatus, 502);
      return true;
    });
  });

  it('turns an unreachable API into the same typed error', async () => {
    const core = createApiCore({
      baseUrl: 'https://api.test',
      getAccessToken: () => null,
      getRefreshToken: () => null,
      fetchImpl: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
    });

    await assert.rejects(core.request('/thing', { schema, anonymous: true }), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'INTERNAL');
      return true;
    });
  });
});

describe('typed client — 401 handling', () => {
  it('refreshes and replays when the session merely expired', async () => {
    const { core, calls } = clientWith(
      [
        failure(401, { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' }),
        success({ accessToken: 'fresh', refreshToken: 'r2', expiresInSec: 900 }),
        success({ id: 'abc' }),
      ],
      { access: 'stale', refresh: 'r1' },
    );

    const result = await core.request('/thing', { schema });

    assert.deepEqual(result, { id: 'abc' });
    assert.equal(calls.length, 3);
    assert.equal(calls[1]?.url, 'https://api.test/auth/refresh');
    // The replay must carry the NEW token, or the retry is pointless.
    assert.equal(calls[2]?.authorization, 'Bearer fresh');
  });

  it('does not refresh on a 401 that means "wrong credential"', async () => {
    const { core, calls } = clientWith(
      [failure(401, { code: 'PIN_INVALID', message: 'Incorrect mobile number or PIN' })],
      { access: 'valid', refresh: 'r1' },
    );

    await assert.rejects(core.request('/thing', { schema }), (error: unknown) => {
      assert.ok(AppException.is(error));
      assert.equal(error.code, 'PIN_INVALID');
      return true;
    });
    // One call only: refreshing here would hide the real code and could sign a perfectly good session out.
    assert.equal(calls.length, 1);
  });

  it('signs out at once, without refreshing, when the session was replaced', async () => {
    const { core, calls, causes } = clientWith(
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
      core.request('/thing', { schema }),
      (e: unknown) => AppException.is(e) && e.code === 'SESSION_REPLACED',
    );
    assert.equal(calls.length, 1, 'a refresh would only be refused the same way');
    assert.equal((causes[0] as AppException).code, 'SESSION_REPLACED');
  });

  /** The bug this prevents: a throttled refresh signing a student out with the clock still running. */
  it('asks the refresh again when it was throttled, rather than ending the sitting', async () => {
    const { core, calls, causes } = clientWith(
      [
        failure(401, { code: 'UNAUTHENTICATED', message: 'Expired' }),
        failure(429, { code: 'RATE_LIMITED', message: 'Too many requests' }),
        success({ accessToken: 'fresh', refreshToken: 'r2', expiresInSec: 900 }),
        success({ id: 'abc' }),
      ],
      { access: 'stale', refresh: 'r1' },
    );

    assert.deepEqual(await core.request('/thing', { schema }), { id: 'abc' });
    assert.equal(calls.length, 4, 'the throttled refresh is asked a second time');
    assert.deepEqual(causes, [], 'a throttle says nothing about whether the session is still good');
  });

  /** The server answers the replaced token again for 60 seconds only; a refresh left hanging must be asked again inside that. */
  it('abandons a refresh that never answers, and asks again', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { core, calls, causes } = clientWith(
        [
          failure(401, { code: 'UNAUTHENTICATED', message: 'Expired' }),
          HANG,
          success({ accessToken: 'fresh', refreshToken: 'r2', expiresInSec: 900 }),
          success({ id: 'abc' }),
        ],
        { access: 'stale', refresh: 'r1' },
      );

      const answered = core.request('/thing', { schema });
      for (let waited = 0; waited < 30_000 && calls.length < 4; waited += 500) {
        await new Promise((settle) => setImmediate(settle));
        mock.timers.tick(500);
      }

      assert.equal(calls.length, 4, 'the hung refresh was given up on and asked again');
      assert.deepEqual(await answered, { id: 'abc' });
      assert.deepEqual(causes, []);
    } finally {
      mock.timers.reset();
    }
  });

  it('keeps the session when the refresh never gets through at all', async () => {
    const { core, causes } = clientWith(
      [
        failure(401, { code: 'UNAUTHENTICATED', message: 'Expired' }),
        ...Array.from({ length: 4 }, () => failure(429, { code: 'RATE_LIMITED', message: 'Busy' })),
      ],
      { access: 'stale', refresh: 'r1' },
    );

    await assert.rejects(
      core.request('/thing', { schema }),
      (e: unknown) => AppException.is(e) && e.httpStatus === 429,
      'the throttle is the error, not an expired session the student must sign in for',
    );
    assert.deepEqual(causes, [], 'the student stays signed in and can go on answering');
  });

  it('passes on why a refresh failed', async () => {
    const { core, causes } = clientWith(
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
      core.request('/thing', { schema }),
      (e: unknown) => AppException.is(e) && e.code === 'SESSION_REPLACED',
      'the replacement is the error, not the expired token that led to the refresh',
    );
    assert.equal((causes[0] as AppException).code, 'SESSION_REPLACED');
  });

  it('says why when a replacement lands between the refresh and the retry', async () => {
    const { core, causes } = clientWith(
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

    await assert.rejects(core.request('/thing', { schema }));
    assert.equal((causes[0] as AppException | undefined)?.code, 'SESSION_REPLACED');
  });
});

describe('typed client — a download racing a request', () => {
  /** The bug this prevents: two refreshes spend the same token, and the second is refused as a reuse. */
  it('shares the one refresh, so a token is never spent twice', async () => {
    let accessToken = 'stale';
    const refreshedWith: unknown[] = [];
    const core = createApiCore({
      baseUrl: 'https://api.test',
      getAccessToken: () => accessToken,
      getRefreshToken: () => 'r1',
      onTokensRefreshed: (next) => {
        accessToken = next.accessToken;
      },
      fetchImpl: ((url: string, init?: RequestInit) => {
        if (url.endsWith('/auth/refresh')) {
          refreshedWith.push(init?.body);
          return Promise.resolve(
            success({ accessToken: 'fresh', refreshToken: 'r2', expiresInSec: 900 }),
          );
        }
        const fresh = new Headers(init?.headers).get('Authorization') === 'Bearer fresh';
        if (!fresh) return Promise.resolve(failure(401, { code: 'UNAUTHENTICATED', message: 'x' }));
        return Promise.resolve(
          url.endsWith('/file') ? new Response('bytes') : success({ id: 'a' }),
        );
      }) as unknown as typeof fetch,
    });

    const [data, file] = await Promise.all([
      core.request('/thing', { schema }),
      core.requestBlob('/file'),
    ]);

    assert.deepEqual(data, { id: 'a' });
    assert.equal(await file.text(), 'bytes');
    assert.equal(refreshedWith.length, 1);
  });

  it('signs out without refreshing when a download finds the session replaced', async () => {
    const causes: unknown[] = [];
    const core = createApiCore({
      baseUrl: 'https://api.test',
      getAccessToken: () => 'valid',
      getRefreshToken: () => 'r1',
      onUnauthorized: (cause) => causes.push(cause),
      fetchImpl: (() =>
        Promise.resolve(
          failure(401, { code: 'SESSION_REPLACED', message: 'Replaced' }),
        )) as unknown as typeof fetch,
    });

    await assert.rejects(
      core.requestBlob('/file'),
      (e: unknown) => AppException.is(e) && e.code === 'SESSION_REPLACED',
    );
    assert.equal((causes[0] as AppException).code, 'SESSION_REPLACED');
  });

  /** The bug this prevents: a download refused twice leaves the app signed in with a session that can do nothing. */
  it('signs out when a download is refused again after the refresh', async () => {
    const causes: unknown[] = [];
    const core = createApiCore({
      baseUrl: 'https://api.test',
      getAccessToken: () => 'stale',
      getRefreshToken: () => 'r1',
      onUnauthorized: (cause) => causes.push(cause),
      fetchImpl: ((url: string) =>
        Promise.resolve(
          url.endsWith('/auth/refresh')
            ? success({ accessToken: 'fresh', refreshToken: 'r2', expiresInSec: 900 })
            : failure(401, { code: 'UNAUTHENTICATED', message: 'Expired' }),
        )) as unknown as typeof fetch,
    });

    await assert.rejects(
      core.requestBlob('/file'),
      (e: unknown) => AppException.is(e) && e.code === 'UNAUTHENTICATED',
    );
    assert.equal((causes[0] as AppException | undefined)?.code, 'UNAUTHENTICATED');
  });

  /** The bug this prevents: a 401 landing after somebody else refreshed rotates the refresh token again, which the server reads as a reuse and revokes the session for. */
  it('replays a late 401 with the token another request already fetched', async () => {
    let accessToken = 'stale';
    let refreshes = 0;
    let refuseTheSlowOne = () => undefined as void;
    const held = new Promise<void>((settle) => {
      refuseTheSlowOne = () => settle();
    });
    const core = createApiCore({
      baseUrl: 'https://api.test',
      getAccessToken: () => accessToken,
      getRefreshToken: () => 'r1',
      onTokensRefreshed: (next) => {
        accessToken = next.accessToken;
      },
      fetchImpl: ((url: string, init?: RequestInit) => {
        if (url.endsWith('/auth/refresh')) {
          refreshes += 1;
          return Promise.resolve(
            success({ accessToken: 'fresh', refreshToken: 'r2', expiresInSec: 900 }),
          );
        }
        if (new Headers(init?.headers).get('Authorization') === 'Bearer fresh') {
          return Promise.resolve(success({ id: 'a' }));
        }
        const refused = failure(401, { code: 'UNAUTHENTICATED', message: 'Expired' });
        return url.endsWith('/slow') ? held.then(() => refused) : Promise.resolve(refused);
      }) as unknown as typeof fetch,
    });

    const late = core.request('/slow', { schema });
    assert.deepEqual(await core.request('/thing', { schema }), { id: 'a' });
    refuseTheSlowOne();

    assert.deepEqual(await late, { id: 'a' });
    assert.equal(
      refreshes,
      1,
      'a second refresh spends the rotated token and is refused as a reuse',
    );
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

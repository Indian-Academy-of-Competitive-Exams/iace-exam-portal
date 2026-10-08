import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLIENT_KINDS, ErrorCodes } from '@iace/contracts';
import { createAppApiClient } from '../src/api-client';
import { createTokenStore } from '../src/token-store';
import { fakeStorage } from './support/fake-storage';

const meta = { requestId: 'req-test-0001' };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The failure this prevents: a sign-out that stopped waiting, then handed its session back by a slow refresh. */
test('a refresh answered after the device was cleared puts no session back', async (t) => {
  const store = createTokenStore('iace.test.late-refresh', fakeStorage());
  store.set({ accessToken: 'expired', refreshToken: 'held', expiresInSec: 900 });
  let answerRefresh: (response: Response) => void = () => undefined;
  const asked: string[] = [];
  t.mock.method(globalThis, 'fetch', (url: string) => {
    asked.push(url);
    if (url.endsWith('/auth/refresh')) {
      return new Promise<Response>((resolve) => {
        answerRefresh = resolve;
      });
    }
    // The first sign-out is refused as expired; the one retried on the fresh token is taken.
    return Promise.resolve(
      asked.length === 1
        ? json(401, {
            success: false,
            error: { code: ErrorCodes.UNAUTHENTICATED, message: 'expired' },
            meta,
          })
        : new Response(null, { status: 204 }),
    );
  });
  const api = createAppApiClient({
    baseUrl: 'https://api.test',
    tokenStore: store,
    signOutSignal: { emit: () => undefined, subscribe: () => () => undefined },
    client: { kind: CLIENT_KINDS.WEB },
  });

  const signedOut = api.auth.logout();
  await new Promise((turn) => setImmediate(turn));
  store.clear();
  answerRefresh(
    json(200, {
      success: true,
      data: { accessToken: 'fresh', refreshToken: 'rotated', expiresInSec: 900 },
      meta,
    }),
  );
  await signedOut;

  assert.equal(store.get(), null);
  assert.equal(asked.length, 3, 'the server is still told, on the token the refresh returned');
});

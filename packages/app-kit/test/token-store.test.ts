import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { createTokenStore } from '../src/token-store';

/**
 * The smallest possible stand-in. Node has no localStorage, and the point of
 * these tests is which KEY is written, not how the browser stores it.
 */
function installFakeStorage(): Map<string, string> {
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => void entries.set(key, value),
      removeItem: (key: string) => void entries.delete(key),
    },
  });
  return entries;
}

const tokens = { accessToken: 'access', refreshToken: 'refresh', expiresInSec: 900 };

describe('createTokenStore', () => {
  let entries: Map<string, string>;
  beforeEach(() => {
    entries = installFakeStorage();
  });

  it('round-trips a session', () => {
    const store = createTokenStore('iace.admin.auth');
    store.set(tokens);

    assert.deepEqual(store.get(), { accessToken: 'access', refreshToken: 'refresh' });
  });

  it('writes under the key it was given, and no other', () => {
    createTokenStore('iace.admin.auth').set(tokens);

    assert.deepEqual([...entries.keys()], ['iace.admin.auth']);
  });

  /**
   * The failure this exists to prevent. Admin and test are two SPAs on ONE
   * origin: a shared key means whichever loaded last silently clobbers the
   * other's session, and an admin's token gets handed to a student's requests.
   */
  it('keeps two apps on one origin from seeing each other', () => {
    const admin = createTokenStore('iace.admin.auth');
    const test = createTokenStore('iace.test.auth');

    admin.set(tokens);
    assert.equal(test.get(), null, 'the test app must not see the admin session');

    test.set({ accessToken: 'student', refreshToken: 'student-refresh', expiresInSec: 900 });
    assert.equal(admin.get()?.accessToken, 'access', 'the admin session must survive');
  });

  it('clears only its own key', () => {
    const admin = createTokenStore('iace.admin.auth');
    const test = createTokenStore('iace.test.auth');
    admin.set(tokens);
    test.set(tokens);

    admin.clear();

    assert.equal(admin.get(), null);
    assert.ok(test.get(), 'clearing one app must not sign the other out');
  });

  it('reads a corrupt entry as signed out rather than throwing on every request', () => {
    entries.set('iace.admin.auth', 'not json{');

    assert.equal(createTokenStore('iace.admin.auth').get(), null);
  });

  it('never persists anything beyond the two tokens', () => {
    createTokenStore('iace.admin.auth').set({ ...tokens, expiresInSec: 900 });

    assert.deepEqual(Object.keys(JSON.parse(entries.get('iace.admin.auth') ?? '{}') as object), [
      'accessToken',
      'refreshToken',
    ]);
  });
});

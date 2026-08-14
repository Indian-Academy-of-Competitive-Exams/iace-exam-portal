import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTokenStore, type KeyValueStorage } from '../src/token-store';

/**
 * A storage adapter with a Map behind it.
 *
 * It used to be a `globalThis.localStorage` stand-in installed before each
 * test. It is a plain object now because storage is an INJECTED adapter — the
 * package no longer reaches for a global, which is what lets a future Expo app
 * import it (docs/03 §3). That the tests got simpler is the tell.
 */
function fakeStorage(): KeyValueStorage & { entries: Map<string, string> } {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => void entries.set(key, value),
    removeItem: (key) => void entries.delete(key),
  };
}

const tokens = { accessToken: 'access', refreshToken: 'refresh', expiresInSec: 900 };

describe('createTokenStore', () => {
  it('round-trips a session', () => {
    const store = createTokenStore('iace.admin.auth', fakeStorage());
    store.set(tokens);

    assert.deepEqual(store.get(), { accessToken: 'access', refreshToken: 'refresh' });
  });

  it('writes under the key it was given, and no other', () => {
    const storage = fakeStorage();
    createTokenStore('iace.admin.auth', storage).set(tokens);

    assert.deepEqual([...storage.entries.keys()], ['iace.admin.auth']);
  });

  /**
   * The failure this exists to prevent. Admin and test are two SPAs on ONE
   * origin: a shared key means whichever loaded last silently clobbers the
   * other's session, and an admin's token gets handed to a student's requests.
   */
  it('keeps two apps on one origin from seeing each other', () => {
    const storage = fakeStorage();
    const admin = createTokenStore('iace.admin.auth', storage);
    const test = createTokenStore('iace.test.auth', storage);

    admin.set(tokens);
    assert.equal(test.get(), null, 'the test app must not see the admin session');

    test.set({ accessToken: 'student', refreshToken: 'student-refresh', expiresInSec: 900 });
    assert.equal(admin.get()?.accessToken, 'access', 'the admin session must survive');
  });

  it('clears only its own key', () => {
    const storage = fakeStorage();
    const admin = createTokenStore('iace.admin.auth', storage);
    const test = createTokenStore('iace.test.auth', storage);
    admin.set(tokens);
    test.set(tokens);

    admin.clear();

    assert.equal(admin.get(), null);
    assert.ok(test.get(), 'clearing one app must not sign the other out');
  });

  it('reads a corrupt entry as signed out rather than throwing on every request', () => {
    const storage = fakeStorage();
    storage.entries.set('iace.admin.auth', 'not json{');

    assert.equal(createTokenStore('iace.admin.auth', storage).get(), null);
  });

  it('survives a storage that refuses to answer', () => {
    // Safari in private mode, a quota error, a SecureStore that is locked. The
    // session is unreadable, which is the same as signed out — it must not
    // throw out of every single request.
    const hostile: KeyValueStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };

    assert.equal(createTokenStore('iace.admin.auth', hostile).get(), null);
  });

  it('never persists anything beyond the two tokens', () => {
    const storage = fakeStorage();
    createTokenStore('iace.admin.auth', storage).set({ ...tokens, expiresInSec: 900 });

    assert.deepEqual(
      Object.keys(JSON.parse(storage.entries.get('iace.admin.auth') ?? '{}') as object),
      ['accessToken', 'refreshToken'],
    );
  });
});

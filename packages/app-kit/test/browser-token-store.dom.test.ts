import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBrowserTokenStore } from '../browser';

const written = (key: string | null) => window.dispatchEvent(new StorageEvent('storage', { key }));
const tokens = { accessToken: 'access', refreshToken: 'refresh', expiresInSec: 900 };

describe('createBrowserTokenStore', () => {
  /** The two SPAs share an origin: an admin signing out must not sign the student app's tab out. */
  it('hears another tab write its own key or clear the storage, and not the other app', () => {
    let heard = 0;
    const stop = createBrowserTokenStore('iace.admin.auth').subscribe?.(() => (heard += 1));

    written('iace.test.auth');
    assert.equal(heard, 0);

    written('iace.admin.auth');
    written(null);
    assert.equal(heard, 2);

    stop?.();
    written('iace.admin.auth');
    assert.equal(heard, 2);
  });

  /** The tab the server told clears twice: once with the reason, then again as its session is torn down. */
  it('keeps why a session ended through a later clear, and drops it at the next sign-in', () => {
    const store = createBrowserTokenStore('iace.test.why');
    store.set(tokens);

    store.clear({ replacedBy: 'MOBILE' });
    store.clear();

    assert.equal(store.get(), null);
    assert.deepEqual(store.endedBy?.(), { replacedBy: 'MOBILE' });
    assert.equal(createBrowserTokenStore('iace.admin.auth').endedBy?.(), null);

    store.set(tokens);
    assert.equal(store.endedBy?.(), null);
  });

  it('reads a device kind this build does not know as a replacement all the same', () => {
    localStorage.setItem('iace.test.newer.ended', 'TOASTER');

    assert.deepEqual(createBrowserTokenStore('iace.test.newer').endedBy?.(), { replacedBy: null });
  });
});

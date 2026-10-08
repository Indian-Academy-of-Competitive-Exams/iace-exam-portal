import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createBrowserTokenStore } from '../browser';

const written = (key: string | null) => window.dispatchEvent(new StorageEvent('storage', { key }));

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
});

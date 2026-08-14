import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLocalSignOutSignal } from '../src/sign-out-signal';

/**
 * The channel that gets a user back to the login screen when their refresh
 * token is gone.
 *
 * Worth its own tests because both ways of getting it wrong are silent: a
 * signal nobody hears leaves the app retrying forever against a dead token,
 * and a subscription that never comes off keeps a stale React callback alive
 * and clears a session the user has since re-established.
 */
describe('createLocalSignOutSignal', () => {
  it('reaches every subscriber', () => {
    const signal = createLocalSignOutSignal();
    const heard: string[] = [];
    signal.subscribe(() => heard.push('a'));
    signal.subscribe(() => heard.push('b'));

    signal.emit();

    assert.deepEqual(heard, ['a', 'b']);
  });

  it('stops delivering once unsubscribed', () => {
    const signal = createLocalSignOutSignal();
    let heard = 0;
    const stop = signal.subscribe(() => (heard += 1));

    signal.emit();
    stop();
    signal.emit();

    assert.equal(heard, 1);
  });

  it('is harmless with nobody listening', () => {
    assert.doesNotThrow(() => createLocalSignOutSignal().emit());
  });
});

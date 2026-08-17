import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLocalSignOutSignal } from '../src/sign-out-signal';

/** Both failures here are silent: a signal nobody hears, or a subscription that never comes off. */
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

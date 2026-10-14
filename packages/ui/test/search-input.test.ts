import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createDebouncer } from '../src/components/ui/search-input';

/** Timers are mocked: the guarantee is ordering and cancellation, not elapsed time. */
describe('createDebouncer', () => {
  it('flush with nothing pending does nothing', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const debouncer = createDebouncer(300);
    assert.doesNotThrow(() => debouncer.flush());
  });

  /** The unmount case: a search landing after the screen has gone. */
  it('cancel drops the pending search entirely', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const run = mock.fn();
    const debouncer = createDebouncer(300);

    debouncer.schedule(run);
    debouncer.cancel();
    t.mock.timers.tick(1000);

    assert.equal(run.mock.callCount(), 0);
  });
});

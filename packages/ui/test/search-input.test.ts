import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { createDebouncer } from '../src/components/ui/search-input';

/** Timers are mocked: the guarantee is ordering and cancellation, not elapsed time. */
describe('createDebouncer', () => {
  it('runs once, after the typing stops', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const ran: string[] = [];
    const debouncer = createDebouncer(300);

    for (const term of ['A', 'AM', 'AME', 'AMEE']) {
      debouncer.schedule(() => ran.push(term));
      t.mock.timers.tick(50);
    }

    assert.deepEqual(ran, [], 'nothing should run while the keys are still coming');

    t.mock.timers.tick(300);
    assert.deepEqual(ran, ['AMEE'], 'only the last term is worth asking about');
  });

  it('flush answers now — Enter should not wait out the delay', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const ran: string[] = [];
    const debouncer = createDebouncer(300);

    debouncer.schedule(() => ran.push('AMEERPET'));
    debouncer.flush();
    assert.deepEqual(ran, ['AMEERPET']);

    // And the timer it replaced must not fire a second time.
    t.mock.timers.tick(1000);
    assert.deepEqual(ran, ['AMEERPET']);
  });

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

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createDebouncer } from '../src/components/ui/search-input';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

/**
 * The waiting that makes a search box cost one request instead of eight.
 *
 * Timers are mocked rather than slept through: the guarantee is about ordering
 * and cancellation, and a test that sleeps for it is a test that is slow AND
 * flaky.
 */
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

  /**
   * The unmount case. A search that lands after the screen has gone is a
   * request for a page nobody is looking at, and a setState on a component that
   * no longer exists.
   */
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

describe('search boxes', () => {
  /**
   * Two of the three screens write the term into the URL, so an unwaited
   * keystroke was also a history entry: Back walked out of a search one letter
   * at a time instead of leaving the screen.
   */
  it('are not hand-built out of a plain Input and a magnifier', () => {
    const offenders = globSync('apps/*/src/**/*.tsx', { cwd: REPO_ROOT }).filter((relative) =>
      /prefix=\{<Search\b/.test(readFileSync(path.join(REPO_ROOT, relative), 'utf8')),
    );

    assert.deepEqual(offenders, [], 'use SearchInput from @iace/ui — it holds the keystrokes');
  });
});

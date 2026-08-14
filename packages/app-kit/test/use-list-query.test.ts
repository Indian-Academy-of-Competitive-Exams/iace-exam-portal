import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterKey } from '../src/use-list-query';

/**
 * What decides whether a list jumps back to page 1.
 *
 * Both failures are quiet and both are infuriating rather than obviously
 * broken: too eager and the table resets while the reader is on page 4 doing
 * nothing at all; too lax and a new filter leaves them looking at page 4 of a
 * result set that now has two, which reads as "there are none".
 */
describe('filterKey', () => {
  it('treats the same filters as the same however they are ordered', () => {
    // Callers build these with spreads whose shape depends on the filter —
    // `{ ...STATUS_QUERY[status], q }` — so key order genuinely varies between
    // renders for one logical filter set.
    assert.equal(
      filterKey({ q: 'ram', isActive: 'true' }),
      filterKey({ isActive: 'true', q: 'ram' }),
    );
  });

  it('treats an unset filter and an absent one as the same', () => {
    // `filters.get('q') || undefined` is how every screen writes this.
    assert.equal(filterKey({ q: undefined, branchId: 'br_1' }), filterKey({ branchId: 'br_1' }));
  });

  it('sees a changed value', () => {
    assert.notEqual(filterKey({ q: 'ram' }), filterKey({ q: 'ramesh' }));
  });

  it('sees a filter being added or removed', () => {
    assert.notEqual(filterKey({ q: 'ram' }), filterKey({ q: 'ram', ungrouped: 'true' }));
  });

  /**
   * `false` and `''` are answers, not absences. "Not ready yet" is a question
   * an admin asks on purpose, and dropping it alongside `undefined` would make
   * that filter unable to change the page it is on.
   */
  it('keeps falsy values that are not undefined', () => {
    assert.notEqual(filterKey({ preTestReady: 'false' }), filterKey({}));
    assert.notEqual(filterKey({ q: '' }), filterKey({}));
    assert.notEqual(filterKey({ ungrouped: false }), filterKey({}));
  });

  it('is stable for an empty filter set', () => {
    assert.equal(filterKey({}), filterKey({ a: undefined }));
  });
});

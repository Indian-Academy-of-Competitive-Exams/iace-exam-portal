import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { filterKey } from '../src/use-list-query';

/** What decides whether a list jumps back to page 1. Both failures are quiet. */
describe('filterKey', () => {
  it('treats the same filters as the same however they are ordered', () => {
    // Callers build these with spreads, so key order varies for one logical filter set.
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

  /** `false` and `''` are answers, not absences — only `undefined` is "not set". */
  it('keeps falsy values that are not undefined', () => {
    assert.notEqual(filterKey({ preTestReady: 'false' }), filterKey({}));
    assert.notEqual(filterKey({ q: '' }), filterKey({}));
    assert.notEqual(filterKey({ ungrouped: false }), filterKey({}));
  });

  it('is stable for an empty filter set', () => {
    assert.equal(filterKey({}), filterKey({ a: undefined }));
  });
});

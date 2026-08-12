import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nextPageParam } from '../src/use-infinite-pages';

const page = (over: Partial<{ page: number; pageSize: number; total: number; items: number }>) => {
  const { page: p = 1, pageSize = 100, total = 250, items = pageSize } = over;
  return { page: p, pageSize, total, items: Array.from({ length: items }, (_, i) => i) };
};

/**
 * The whole correctness of an infinite list lives here, and both failures are
 * silent: stop one page early and the remaining items simply do not exist as
 * far as the reader is concerned; fail to stop and the control asks for empty
 * page after empty page while the spinner never leaves.
 */
describe('nextPageParam', () => {
  it('asks for the next page while items remain', () => {
    assert.equal(nextPageParam(page({ page: 1, total: 250 }), 1), 2);
    assert.equal(nextPageParam(page({ page: 2, total: 250 }), 2), 3);
  });

  it('stops on the last, short page', () => {
    // 250 items, 100 a page: the third holds 50 and there is nothing after it.
    assert.equal(nextPageParam(page({ page: 3, total: 250, items: 50 }), 3), null);
  });

  /**
   * The off-by-one that loops for ever: a total that divides exactly by the
   * page size means the last full page is the last page, not a promise of an
   * empty one after it.
   */
  it('stops when the total divides exactly by the page size', () => {
    assert.equal(nextPageParam(page({ page: 2, pageSize: 100, total: 200 }), 2), null);
  });

  it('stops on an empty page, whatever the total claims', () => {
    // A row deleted between requests can leave the count ahead of reality.
    assert.equal(nextPageParam(page({ page: 3, total: 999, items: 0 }), 3), null);
  });

  it('stops immediately when the first page is the only one', () => {
    assert.equal(nextPageParam(page({ page: 1, total: 7, items: 7 }), 1), null);
  });

  it('handles a list with nothing in it', () => {
    assert.equal(nextPageParam(page({ page: 1, total: 0, items: 0 }), 1), null);
  });

  /**
   * Counted from what has been loaded, not from the page number the server
   * echoed: a server that ignored the page parameter would otherwise have the
   * control ask for the same page forever.
   */
  it('counts loaded pages rather than trusting the echoed page number', () => {
    assert.equal(nextPageParam(page({ page: 1, total: 250 }), 2), 3);
  });
});

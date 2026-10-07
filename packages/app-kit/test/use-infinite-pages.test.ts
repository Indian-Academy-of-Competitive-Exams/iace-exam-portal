import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadedItems, nextPageParam } from '../src/use-infinite-pages';

const page = (over: Partial<{ page: number; pageSize: number; total: number; items: number }>) => {
  const { page: p = 1, pageSize = 100, total = 250, items = pageSize } = over;
  return { page: p, pageSize, total, items: Array.from({ length: items }, (_, i) => i) };
};

/** Both failures are silent: stopping a page early, or never stopping. */
describe('nextPageParam', () => {
  it('asks for the next page while items remain', () => {
    assert.equal(nextPageParam(page({ page: 1, total: 250 }), 1), 2);
    assert.equal(nextPageParam(page({ page: 2, total: 250 }), 2), 3);
  });

  it('stops on the last, short page', () => {
    // 250 items, 100 a page: the third holds 50 and there is nothing after it.
    assert.equal(nextPageParam(page({ page: 3, total: 250, items: 50 }), 3), null);
  });

  /** A total that divides exactly by the page size ends there, with no empty page after. */
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

  /** Counted from what loaded, not the echoed page number, or a broken server loops. */
  it('counts loaded pages rather than trusting the echoed page number', () => {
    assert.equal(nextPageParam(page({ page: 1, total: 250 }), 2), 3);
  });
});

const rows = (...ids: string[]) => ({
  page: 1,
  pageSize: 2,
  total: 4,
  items: ids.map((id) => ({ id })),
});

/** Pages are cut by position, so a row arriving between two loads pushes one onto the next page. */
describe('loadedItems', () => {
  it('lists a row once when it slid onto the next page', () => {
    assert.deepEqual(loadedItems([rows('n3', 'n2'), rows('n2', 'n1')]), [
      { id: 'n3' },
      { id: 'n2' },
      { id: 'n1' },
    ]);
  });

  it('keeps every row of pages that do not overlap, in the order they came', () => {
    assert.deepEqual(loadedItems([rows('n4', 'n3'), rows('n2', 'n1')]), [
      { id: 'n4' },
      { id: 'n3' },
      { id: 'n2' },
      { id: 'n1' },
    ]);
  });

  it('leaves rows that carry no id as they came', () => {
    const page = { page: 1, pageSize: 2, total: 2, items: ['a', 'a'] };

    assert.deepEqual(loadedItems([page]), ['a', 'a']);
  });
});

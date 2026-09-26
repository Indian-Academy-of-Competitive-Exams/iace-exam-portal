import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HELD_PAPERS, recall, remember } from '../src/attempts/paper-sheet.service';

/** Keys in the order the cache would evict them, which is the order it holds them in. */
const heldKeys = (cache: Map<string, string>): string[] => [...cache.keys()];

const filled = (count: number): Map<string, string> => {
  const cache = new Map<string, string>();
  for (let at = 0; at < count; at += 1) remember(cache, `paper_${at}`, `terms_${at}`);
  return cache;
};

describe('the paper cache’s eviction order', () => {
  it('holds at most the papers it says it holds', () => {
    const cache = filled(HELD_PAPERS + 10);

    assert.equal(cache.size, HELD_PAPERS);
  });

  /** The failure this prevents: a hall sitting one paper all morning loses it to the newest test. */
  it('evicts the paper longest unread, not the one longest held', () => {
    const cache = filled(HELD_PAPERS);
    const oldestHeld = 'paper_0';

    // Read it, then admit one more: something has to go, and it must not be the paper in use.
    assert.equal(recall(cache, oldestHeld), 'terms_0');
    remember(cache, 'paper_new', 'terms_new');

    assert.ok(cache.has(oldestHeld), 'the paper just read survived');
    assert.ok(!cache.has('paper_1'), 'the one nobody has read since went instead');
    assert.equal(cache.size, HELD_PAPERS);
  });

  /** The failure this prevents: a re-read paper costing an unrelated one its place. */
  it('re-remembering a paper it already holds evicts nothing', () => {
    const cache = filled(HELD_PAPERS);

    // A key in the MIDDLE: re-remembering the coldest would evict itself and hide the bug.
    remember(cache, 'paper_30', 'terms_30_again');

    assert.equal(cache.size, HELD_PAPERS);
    assert.ok(cache.has('paper_0'), 'the coldest paper was not charged for it');
    assert.equal(cache.get('paper_30'), 'terms_30_again');
    assert.equal(heldKeys(cache).at(-1), 'paper_30', 'and it is now the freshest');
  });

  it('answers nothing for a paper it never held, and holds nothing new', () => {
    const cache = filled(2);

    assert.equal(recall(cache, 'paper_absent'), undefined);
    assert.deepEqual(heldKeys(cache), ['paper_0', 'paper_1']);
  });
});

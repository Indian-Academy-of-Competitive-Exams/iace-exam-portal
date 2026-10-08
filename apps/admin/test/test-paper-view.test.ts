import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SECTION_FULLNESS,
  poolStamp,
  sectionFullness,
  sectionTally,
} from '../src/features/tests/test-paper-view';

describe('sectionFullness', () => {
  const section = { id: 'sec_1', questionCount: 25 };

  /** Untouched is not the same as part-built: a fresh test must not read as five warnings. */
  it('separates untouched from short from full', () => {
    assert.equal(sectionFullness(section, new Map()), SECTION_FULLNESS.EMPTY);
    assert.equal(sectionFullness(section, new Map([['sec_1', 0]])), SECTION_FULLNESS.EMPTY);
    assert.equal(sectionFullness(section, new Map([['sec_1', 12]])), SECTION_FULLNESS.SHORT);
    assert.equal(sectionFullness(section, new Map([['sec_1', 25]])), SECTION_FULLNESS.FULL);
  });

  /** A paper over its count is not short of anything, whatever put it there. */
  it('counts a section past its own count as full', () => {
    assert.equal(sectionFullness(section, new Map([['sec_1', 26]])), SECTION_FULLNESS.FULL);
  });

  /** THE failure this prevents: a paper still loading judged short of everything. */
  it('judges nothing before a paper exists', () => {
    assert.equal(sectionFullness(section, null), null);
    assert.equal(sectionTally(section, null), null);
  });
});

describe('sectionTally', () => {
  const section = { id: 'sec_1', questionCount: 25 };

  it('reads what the section holds against what it owes', () => {
    assert.equal(sectionTally(section, new Map([['sec_1', 12]])), '12/25');
  });

  /** A section the paper has no row for holds zero, not nothing measurable. */
  it('reads zero for a section the paper has no row for', () => {
    assert.equal(sectionTally(section, new Map()), '0/25');
  });
});

describe('poolStamp', () => {
  const split = (tag: string) => ({ sections: { sec_1: { tags: [tag] } } });
  const began = { updatedAt: '2026-10-08T04:00:00.000Z', questionPoolFilter: split('PYQ') };
  const LATER = '2026-10-08T04:05:00.000Z';

  /** The failure this prevents: a hand-over or a typist's Done moving the stamp, and every Save refused until a reload. */
  it('sends the newest stamp while the pool the draft began on still stands', () => {
    assert.equal(poolStamp(began, { ...began, updatedAt: LATER }), LATER);
    const unset = { updatedAt: began.updatedAt, questionPoolFilter: null };
    assert.equal(poolStamp(unset, { ...unset, updatedAt: LATER }), LATER);
  });

  /** The failure this prevents: a re-read handing a stale draft the stamp of the very split it is about to undo. */
  it('keeps the stamp the draft began on once another save has moved the pool', () => {
    const moved = { updatedAt: LATER, questionPoolFilter: split('2024') };

    assert.equal(poolStamp(began, moved), began.updatedAt);
  });
});

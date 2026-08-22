import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MATCH_MODES } from '@iace/contracts';
import { matchFilters } from '../src/common/match-filters';

interface Where {
  AND?: Where[];
  OR?: Where[];
  subject?: string;
  status?: string;
  name?: string;
}

const subject: Where = { subject: 'QUANT' };
const status: Where = { status: 'ACTIVE' };
const search: Where = { name: 'ravi' };

describe('matchFilters', () => {
  it('narrows with every filter when matching all', () => {
    assert.deepEqual(matchFilters([search], [subject, status], MATCH_MODES.ALL), [
      search,
      subject,
      status,
    ]);
  });

  it('widens across the filters when matching any', () => {
    assert.deepEqual(matchFilters([search], [subject, status], MATCH_MODES.ANY), [
      search,
      { OR: [subject, status] },
    ]);
  });

  /** The search and the date range say what you are looking at; the toggle governs the rest. */
  it('keeps what always narrows outside the OR, so a search still narrows in any mode', () => {
    const [first] = matchFilters([search], [subject, status], MATCH_MODES.ANY);

    assert.deepEqual(first, search);
  });

  /** `OR: []` matches NOTHING, and one condition ORed with itself is just that condition. */
  it('does not build an OR it cannot mean', () => {
    assert.deepEqual(matchFilters([search], [], MATCH_MODES.ANY), [search]);
    assert.deepEqual(matchFilters([search], [subject], MATCH_MODES.ANY), [search, subject]);
  });

  it('is empty when nothing was asked for, in either mode', () => {
    assert.deepEqual(matchFilters([], [], MATCH_MODES.ALL), []);
    assert.deepEqual(matchFilters([], [], MATCH_MODES.ANY), []);
  });
});

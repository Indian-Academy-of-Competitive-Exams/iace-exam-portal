import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { everyTermMatches } from '../src/common/search-terms';

/** Stands in for the columns a stage row shows: its name, its key, and its exam's code. */
const shown = (term: string) => [{ name: term }, { stageKey: term }, { examCode: term }];

describe('everyTermMatches', () => {
  it('filters nothing when nothing was typed', () => {
    assert.deepEqual(everyTermMatches(undefined, shown), {});
    assert.deepEqual(everyTermMatches('', shown), {});
    assert.deepEqual(everyTermMatches('   ', shown), {});
  });

  it('offers one word to every column', () => {
    assert.deepEqual(everyTermMatches('Tier', shown), {
      AND: [{ OR: [{ name: 'Tier' }, { stageKey: 'Tier' }, { examCode: 'Tier' }] }],
    });
  });

  /** The failure this prevents: "SSC CGL Tier 1" finding nothing, no column holding all of it. */
  it('requires each word separately, so a phrase may span columns', () => {
    const where = everyTermMatches('SSC CGL Tier 1', shown);

    assert.equal(where.AND?.length, 4);
    assert.deepEqual(
      where.AND?.map((clause) => clause.OR[0]),
      [{ name: 'SSC' }, { name: 'CGL' }, { name: 'Tier' }, { name: '1' }],
    );
  });

  it('reads runs of whitespace as one gap', () => {
    assert.equal(everyTermMatches('  SSC   CGL  ', shown).AND?.length, 2);
  });
});

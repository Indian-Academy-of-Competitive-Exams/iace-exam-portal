import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_DIFFICULTY_MIX,
  bucketCounts,
  difficultyMixSchema,
  paperFeasibility,
  type FeasibilitySection,
  type SectionAvailability,
} from '../src/index';

const QUANT: FeasibilitySection = { id: 'sec_1', name: 'Quantitative Aptitude', questionCount: 25 };

const held = (total: number, byDifficulty: SectionAvailability['byDifficulty'] = {}) => ({
  sec_1: { total, byDifficulty },
});

describe('difficultyMixSchema', () => {
  it('takes a mix that adds up', () => {
    assert.equal(difficultyMixSchema.safeParse(DEFAULT_DIFFICULTY_MIX).success, true);
  });

  /** The failure this prevents: a section whose buckets quietly draw more or fewer than it holds. */
  it('refuses one that does not', () => {
    assert.equal(difficultyMixSchema.safeParse({ LOW: 30, MEDIUM: 40, HIGH: 40 }).success, false);
  });

  it('allows a difficulty to be left out entirely', () => {
    assert.equal(difficultyMixSchema.safeParse({ LOW: 0, MEDIUM: 100, HIGH: 0 }).success, true);
  });
});

describe('bucketCounts', () => {
  it('divides cleanly when it can', () => {
    assert.deepEqual(bucketCounts(DEFAULT_DIFFICULTY_MIX, 10), { LOW: 3, MEDIUM: 4, HIGH: 3 });
  });

  /** 30/40/30 of 25 is 7.5/10/7.5, and a mix with equal ends has to draw equal ends. */
  it('gives the odd one to the middle', () => {
    assert.deepEqual(bucketCounts(DEFAULT_DIFFICULTY_MIX, 25), { LOW: 7, MEDIUM: 11, HIGH: 7 });
  });

  /** The failure this prevents: a medium question on a paper that asked for no medium at all. */
  it('never puts the odd one in a bucket the mix asked nothing of', () => {
    assert.deepEqual(bucketCounts({ LOW: 50, MEDIUM: 0, HIGH: 50 }, 3), {
      LOW: 2,
      MEDIUM: 0,
      HIGH: 1,
    });
    assert.equal(bucketCounts({ LOW: 100, MEDIUM: 0, HIGH: 0 }, 7).MEDIUM, 0);
  });

  it('hands a second spare to the largest remainder left', () => {
    // 30/30/40 of 9 is 2.7/2.7/3.6: two spare, one to the middle and one to the largest remainder.
    assert.deepEqual(bucketCounts({ LOW: 30, MEDIUM: 30, HIGH: 40 }, 9), {
      LOW: 3,
      MEDIUM: 3,
      HIGH: 3,
    });
  });

  /** The failure this prevents: two draws from one spec producing papers of different lengths. */
  it('always adds up to the section, whatever the mix and the count', () => {
    const mixes = [
      DEFAULT_DIFFICULTY_MIX,
      { LOW: 33, MEDIUM: 33, HIGH: 34 },
      { LOW: 1, MEDIUM: 98, HIGH: 1 },
      { LOW: 50, MEDIUM: 0, HIGH: 50 },
    ];
    for (const mix of mixes) {
      for (let count = 1; count <= 60; count += 1) {
        const buckets = bucketCounts(mix, count);
        assert.equal(
          buckets.LOW + buckets.MEDIUM + buckets.HIGH,
          count,
          `${JSON.stringify(mix)} of ${count}`,
        );
      }
    }
  });

  it('draws nothing from a difficulty set to nought', () => {
    assert.equal(bucketCounts({ LOW: 0, MEDIUM: 60, HIGH: 40 }, 20).LOW, 0);
  });
});

describe('paperFeasibility', () => {
  it('says nothing when the bank can fill every bucket', () => {
    const spec = { sections: { sec_1: { mix: DEFAULT_DIFFICULTY_MIX } } };
    const available = held(100, { LOW: 30, MEDIUM: 40, HIGH: 30 });

    assert.deepEqual(paperFeasibility([QUANT], spec, available), []);
  });

  /** The failure this prevents: a draw that reports a section short without saying which half. */
  it('names the difficulty that is thin, and both numbers', () => {
    const spec = { sections: { sec_1: { mix: DEFAULT_DIFFICULTY_MIX } } };
    const available = held(100, { LOW: 30, MEDIUM: 40, HIGH: 3 });

    assert.deepEqual(paperFeasibility([QUANT], spec, available), [
      {
        baseConfigSectionId: 'sec_1',
        sectionName: 'Quantitative Aptitude',
        difficulty: 'HIGH',
        needed: 7,
        available: 3,
      },
    ]);
  });

  /** Dropping the mix is the way out of a thin bucket, so it must judge the total instead. */
  it('judges a section with no mix on its total alone', () => {
    const thin = paperFeasibility([QUANT], { sections: { sec_1: {} } }, held(20, { HIGH: 0 }));
    assert.equal(thin.length, 1);
    assert.equal(thin[0]?.difficulty, null);
    assert.equal(thin[0]?.needed, 25);

    assert.deepEqual(paperFeasibility([QUANT], { sections: { sec_1: {} } }, held(25)), []);
  });

  it('judges a section the spec never mentions the same way', () => {
    assert.deepEqual(paperFeasibility([QUANT], null, held(25)), []);
    assert.equal(paperFeasibility([QUANT], null, held(24)).length, 1);
  });

  it('reports every thin bucket, not just the first', () => {
    const spec = { sections: { sec_1: { mix: DEFAULT_DIFFICULTY_MIX } } };
    const gaps = paperFeasibility([QUANT], spec, held(6, { LOW: 1, MEDIUM: 2, HIGH: 3 }));

    assert.deepEqual(
      gaps.map((gap) => gap.difficulty),
      ['LOW', 'MEDIUM', 'HIGH'],
    );
  });
});

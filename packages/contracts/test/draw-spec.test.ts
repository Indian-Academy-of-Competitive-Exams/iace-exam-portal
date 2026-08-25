import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  defaultMixFor,
  difficultyMixSchema,
  mixIssue,
  paperFeasibility,
  type FeasibilitySection,
  type SectionAvailability,
} from '../src/index';

const QUANT: FeasibilitySection = { id: 'sec_1', name: 'Quantitative Aptitude', questionCount: 25 };

const held = (total: number, byDifficulty: SectionAvailability['byDifficulty'] = {}) => ({
  sec_1: { total, byDifficulty },
});

describe('difficultyMixSchema', () => {
  it('takes whole counts, including none of a difficulty', () => {
    assert.equal(difficultyMixSchema.safeParse({ LOW: 7, MEDIUM: 11, HIGH: 7 }).success, true);
    assert.equal(difficultyMixSchema.safeParse({ LOW: 0, MEDIUM: 25, HIGH: 0 }).success, true);
  });

  it('refuses a negative count and a fraction of a question', () => {
    assert.equal(difficultyMixSchema.safeParse({ LOW: -1, MEDIUM: 26, HIGH: 0 }).success, false);
    assert.equal(difficultyMixSchema.safeParse({ LOW: 7.5, MEDIUM: 10, HIGH: 7.5 }).success, false);
  });
});

describe('defaultMixFor', () => {
  it('starts near 30/40/30 without leaving a question unaccounted for', () => {
    assert.deepEqual(defaultMixFor(25), { LOW: 7, MEDIUM: 11, HIGH: 7 });
    assert.deepEqual(defaultMixFor(10), { LOW: 3, MEDIUM: 4, HIGH: 3 });
  });

  /** The failure this prevents: a starting split the admin has to correct before it will save. */
  it('always adds up to the section it was built for', () => {
    for (let count = 0; count <= 60; count += 1) {
      const mix = defaultMixFor(count);
      assert.equal(mix.LOW + mix.MEDIUM + mix.HIGH, count, `of ${count}`);
    }
  });
});

describe('mixIssue', () => {
  it('passes a split that adds up to the section', () => {
    assert.equal(mixIssue({ LOW: 7, MEDIUM: 11, HIGH: 7 }, QUANT), null);
  });

  /** The schema never sees the section, so this is the one rule it cannot hold. */
  it('names both numbers when it does not', () => {
    const issue = mixIssue({ LOW: 7, MEDIUM: 10, HIGH: 7 }, QUANT);
    assert.match(issue ?? '', /holds 25/);
    assert.match(issue ?? '', /adds up to 24/);
  });

  it('catches a split that overshoots as well as one that falls short', () => {
    assert.ok(mixIssue({ LOW: 10, MEDIUM: 11, HIGH: 7 }, QUANT));
  });
});

describe('paperFeasibility', () => {
  const mixed = { sections: { sec_1: { mix: { LOW: 7, MEDIUM: 11, HIGH: 7 } } } };

  it('says nothing when the bank can fill every bucket', () => {
    assert.deepEqual(
      paperFeasibility([QUANT], mixed, held(100, { LOW: 30, MEDIUM: 40, HIGH: 30 })),
      [],
    );
  });

  /** The failure this prevents: a draw reporting a section short without saying which half. */
  it('names the difficulty that is thin, and both numbers', () => {
    assert.deepEqual(
      paperFeasibility([QUANT], mixed, held(100, { LOW: 30, MEDIUM: 40, HIGH: 3 })),
      [
        {
          baseConfigSectionId: 'sec_1',
          sectionName: 'Quantitative Aptitude',
          difficulty: 'HIGH',
          needed: 7,
          available: 3,
        },
      ],
    );
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

  it('asks nothing of a difficulty the split set to nought', () => {
    const noHigh = { sections: { sec_1: { mix: { LOW: 12, MEDIUM: 13, HIGH: 0 } } } };

    assert.deepEqual(
      paperFeasibility([QUANT], noHigh, held(30, { LOW: 12, MEDIUM: 13, HIGH: 0 })),
      [],
    );
  });

  it('reports every thin bucket, not just the first', () => {
    const gaps = paperFeasibility([QUANT], mixed, held(6, { LOW: 1, MEDIUM: 2, HIGH: 3 }));

    assert.deepEqual(
      gaps.map((gap) => gap.difficulty),
      ['LOW', 'MEDIUM', 'HIGH'],
    );
  });
});

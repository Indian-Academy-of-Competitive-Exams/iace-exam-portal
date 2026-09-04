import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  boundedPicks,
  defaultMixFor,
  difficultyMixSchema,
  mixIssue,
  paperFeasibility,
  pickIssue,
  quotaWithPicks,
  sectionQuota,
  strandedPicks,
  type DifficultyLevel,
  type FeasibilitySection,
  type OfferedQuestion,
  type PickedQuestion,
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

describe('sectionQuota', () => {
  it('counts what each difficulty has taken against what the split allows it', () => {
    const quota = sectionQuota({ LOW: 7, MEDIUM: 11, HIGH: 7 }, ['LOW', 'LOW', 'HIGH']);

    assert.deepEqual(quota.LOW, { chosen: 2, allowed: 7 });
    assert.deepEqual(quota.MEDIUM, { chosen: 0, allowed: 11 });
    assert.deepEqual(quota.HIGH, { chosen: 1, allowed: 7 });
  });

  it('leaves every bucket unbounded when the section has no split', () => {
    const quota = sectionQuota(undefined, ['LOW', 'MEDIUM']);

    assert.deepEqual(quota.LOW, { chosen: 1, allowed: null });
    assert.deepEqual(quota.HIGH, { chosen: 0, allowed: null });
  });
});

describe('pickIssue', () => {
  /** The failure this prevents: a paper that says 7 low and goes out holding 9. */
  it('refuses a full bucket while its neighbours still take one', () => {
    const quota = sectionQuota({ LOW: 2, MEDIUM: 21, HIGH: 2 }, ['LOW', 'LOW']);

    assert.equal(pickIssue('LOW', quota, QUANT.questionCount), 'QUOTA_MET');
    assert.equal(pickIssue('MEDIUM', quota, QUANT.questionCount), null);
  });

  it('takes anything of any difficulty while the section has room and no split', () => {
    const quota = sectionQuota(undefined, ['HIGH', 'HIGH', 'HIGH']);

    assert.equal(pickIssue('HIGH', quota, QUANT.questionCount), null);
  });

  /** The section's own count is the ceiling even where the split disagrees with it. */
  it('refuses everything once the section holds what it needs', () => {
    const full = Array.from({ length: 25 }, () => 'MEDIUM' as const);
    const quota = sectionQuota({ LOW: 7, MEDIUM: 99, HIGH: 7 }, full);

    assert.equal(pickIssue('MEDIUM', quota, QUANT.questionCount), 'SECTION_FULL');
    assert.equal(pickIssue('LOW', quota, QUANT.questionCount), 'SECTION_FULL');
  });
});

describe('quotaWithPicks', () => {
  it('counts what is only shortlisted alongside what the paper already holds', () => {
    const quota = quotaWithPicks(sectionQuota({ LOW: 7, MEDIUM: 11, HIGH: 7 }, ['LOW']), [
      'LOW',
      'HIGH',
    ]);

    assert.deepEqual(quota.LOW, { chosen: 2, allowed: 7 });
    assert.deepEqual(quota.HIGH, { chosen: 1, allowed: 7 });
  });
});

describe('boundedPicks', () => {
  const CYCLE: readonly DifficultyLevel[] = ['LOW', 'MEDIUM', 'HIGH'];
  const ids = Array.from({ length: 40 }, (_, index) => `q${index}`);
  const bank: OfferedQuestion[] = ids.map((questionId, index) => ({
    questionId,
    difficulty: CYCLE[index % CYCLE.length] ?? 'LOW',
  }));
  const all = new Set(ids);
  const none = new Set<string>();

  /** The failure this prevents: 40 rows ticked at once against a section that can take three. */
  it('takes only what the section still has room for, in the order offered', () => {
    const quota = sectionQuota(
      undefined,
      Array.from({ length: 22 }, () => 'LOW' as const),
    );

    const kept = boundedPicks(bank, all, none, quota, 25);

    assert.equal(kept.size, 3);
    assert.deepEqual([...kept.keys()], ['q0', 'q1', 'q2']);
  });

  it('stops at a full bucket while its neighbours still take one', () => {
    const quota = sectionQuota({ LOW: 1, MEDIUM: 2, HIGH: 0 }, []);

    const kept = boundedPicks(bank, all, none, quota, 3);

    assert.deepEqual(
      [...kept.entries()],
      [
        ['q0', 'LOW'],
        ['q1', 'MEDIUM'],
        ['q4', 'MEDIUM'],
      ],
    );
  });

  /** A tick already made comes first in the order, so a later tick-all cannot push it out. */
  it('keeps a pick already made ahead of the rest of the bank', () => {
    const quota = sectionQuota(undefined, []);
    const order = [{ questionId: 'q30', difficulty: 'HIGH' as const }, ...bank];

    const kept = boundedPicks(order, all, none, quota, 2);

    assert.deepEqual([...kept.keys()], ['q30', 'q0']);
  });

  it('passes over anything the paper already holds, and anything not asked for', () => {
    const quota = sectionQuota(undefined, []);

    const kept = boundedPicks(bank, new Set(['q0', 'q1', 'q2']), new Set(['q1']), quota, 25);

    assert.deepEqual([...kept.keys()], ['q0', 'q2']);
  });

  it('takes nothing at all once the section holds what it needs', () => {
    const quota = sectionQuota(
      undefined,
      Array.from({ length: 25 }, () => 'LOW' as const),
    );

    assert.equal(boundedPicks(bank, all, none, quota, 25).size, 0);
  });
});

describe('strandedPicks', () => {
  const picked = (
    questionId: string,
    difficulty: DifficultyLevel,
    topicId: string | null = 'top_1',
  ): PickedQuestion => ({ questionId, difficulty, topicId });

  it('says nothing while the section still draws from where its questions came', () => {
    const chosen = [picked('q1', 'LOW'), picked('q2', 'HIGH', 'top_2')];

    assert.deepEqual(strandedPicks(chosen, { topicIds: ['top_1', 'top_2'] }), {});
    assert.deepEqual(strandedPicks(chosen, undefined), {});
  });

  /** The failure this prevents: narrowing the topics and never being told what it orphaned. */
  it('flags a question whose topic the section stopped drawing from', () => {
    const chosen = [picked('q1', 'LOW'), picked('q2', 'HIGH', 'top_2')];

    assert.deepEqual(strandedPicks(chosen, { topicIds: ['top_1'] }), { q2: 'OFF_TOPIC' });
  });

  it('counts a question with no topic at all as outside a narrowed pool', () => {
    const orphan = strandedPicks([picked('q1', 'LOW', null)], { topicIds: ['top_1'] });

    assert.deepEqual(orphan, { q1: 'OFF_TOPIC' });
  });

  it('flags only what a tightened split leaves over, in the order the paper holds it', () => {
    const chosen = [picked('q1', 'LOW'), picked('q2', 'LOW'), picked('q3', 'LOW')];

    assert.deepEqual(strandedPicks(chosen, { mix: { LOW: 2, MEDIUM: 0, HIGH: 0 } }), {
      q3: 'QUOTA_MET',
    });
  });
});

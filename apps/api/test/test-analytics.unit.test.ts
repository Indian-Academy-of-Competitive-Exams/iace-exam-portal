import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ITEM_SIGNALS,
  testAnalyticsSummarySchema,
  testItemAnalyticsSchema,
  testSectionAnalyticsSchema,
  worthInspecting,
  type TestTopper,
} from '@iace/contracts';
import {
  itemsOf,
  sectionsOf,
  summaryOf,
  type ItemTotals,
  type SectionTotals,
  type StatTotals,
} from '../src/attempts/test-analytics';

const COMPUTED_AT = new Date('2026-09-09T04:30:00.000Z');

const TOPPER: TestTopper = {
  attemptId: 'att_9',
  studentId: 'stu_9',
  name: 'Anitha R',
  score: 96,
  timeSpentSec: 3300,
};

function stat(overrides: Partial<StatTotals> = {}): StatTotals {
  return {
    attemptCount: 120,
    evaluatedCount: 100,
    sumScore: 5400,
    maxScore: 96,
    minScore: -4,
    sumTimeSec: 330_000,
    bands: [
      { from: 0, to: 40, count: 20 },
      { from: 40, to: 80, count: 60 },
      { from: 80, to: 120, count: 20 },
    ],
    computedAt: COMPUTED_AT,
    ...overrides,
  };
}

function section(overrides: Partial<SectionTotals> = {}): SectionTotals {
  return {
    baseConfigSectionId: 'sec_1',
    name: 'Quantitative Aptitude',
    order: 1,
    maxMarks: 50,
    attempted: 100,
    sumScore: 2500,
    sumTimeSec: 120_000,
    ...overrides,
  };
}

const OPTIONS = [1, 2, 3, 4].map((position) => ({
  id: `opt_${position}`,
  position,
  isCorrect: position === 1,
  text: {},
}));

function item(overrides: Partial<ItemTotals> = {}): ItemTotals {
  return {
    paperQuestionId: 'pq_1',
    questionId: 'q_1',
    order: 1,
    baseConfigSectionId: 'sec_1',
    questionCode: 'SSC-QA-0001',
    stemPreview: 'The average of five numbers…',
    attemptedCount: 80,
    correctCount: 60,
    wrongCount: 20,
    skippedCount: 20,
    sumTimeSec: 3200,
    pValue: 0.75,
    discrimination: null,
    options: OPTIONS,
    optionCounts: { opt_1: 60, opt_2: 12, opt_3: 5, opt_4: 3 },
    ...overrides,
  };
}

describe('summaryOf', () => {
  it('derives the averages off the sums the fold already wrote', () => {
    const summary = summaryOf(stat(), TOPPER);

    assert.equal(summary.meanScore, 54);
    assert.equal(summary.averageTimeSec, 3300);
    assert.equal(summary.medianScore, 60);
    assert.equal(summary.maxScore, 96);
    assert.equal(summary.minScore, -4);
    assert.equal(summary.evaluatedCount, 100);
    assert.equal(summary.attemptCount, 120);
    assert.equal(summary.topper?.name, 'Anitha R');
    assert.equal(summary.computedAt, COMPUTED_AT.toISOString());
    assert.deepEqual(summary.bands, stat().bands);
    testAnalyticsSummarySchema.parse(summary);
  });

  it('reads an unfolded paper as unmeasured, never as a cohort that scored zero', () => {
    const summary = summaryOf(null, null);

    assert.equal(summary.meanScore, null);
    assert.equal(summary.medianScore, null);
    assert.equal(summary.averageTimeSec, null);
    assert.equal(summary.maxScore, null);
    assert.equal(summary.evaluatedCount, 0);
    assert.deepEqual(summary.bands, []);
    testAnalyticsSummarySchema.parse(summary);
  });

  it('holds the same line on a row folded before any sitting was evaluated', () => {
    const summary = summaryOf(
      stat({ evaluatedCount: 0, sumScore: 0, sumTimeSec: 0, maxScore: null, minScore: null }),
      null,
    );

    assert.equal(summary.meanScore, null);
    assert.equal(summary.averageTimeSec, null);
  });
});

describe('sectionsOf', () => {
  it('averages each section over the sittings that reached it, in paper order', () => {
    const rows = [
      section({ baseConfigSectionId: 'sec_2', name: 'Reasoning', order: 2, sumScore: 3000 }),
      section(),
    ];
    const [first, second] = sectionsOf(rows);

    assert.equal(first?.name, 'Quantitative Aptitude');
    assert.equal(first?.averageScore, 25);
    assert.equal(first?.averageTimeSec, 1200);
    assert.equal(first?.maxMarks, 50);
    assert.equal(second?.name, 'Reasoning');
    assert.equal(second?.averageScore, 30);
    sectionsOf(rows).forEach((row) => testSectionAnalyticsSchema.parse(row));
  });

  it('leaves a section nobody reached unmeasured', () => {
    const [only] = sectionsOf([section({ attempted: 0, sumScore: 0, sumTimeSec: 0 })]);

    assert.equal(only?.averageScore, null);
    assert.equal(only?.averageTimeSec, null);
  });
});

describe('itemsOf', () => {
  it('spreads the option counts in paper order and marks the key', () => {
    const [only] = itemsOf([item()]);

    assert.deepEqual(
      only?.optionCounts.map((option) => [option.position, option.count, option.isCorrect]),
      [
        [1, 60, true],
        [2, 12, false],
        [3, 5, false],
        [4, 3, false],
      ],
    );
    assert.equal(only?.averageTimeSec, 40);
    assert.equal(only?.pValue, 0.75);
    assert.deepEqual(only?.signals, []);
    testItemAnalyticsSchema.parse(only);
  });

  it('counts an option nobody chose as a zero, not as a missing row', () => {
    const [only] = itemsOf([item({ optionCounts: { opt_1: 80 } })]);

    assert.deepEqual(
      only?.optionCounts.map((option) => option.count),
      [80, 0, 0, 0],
    );
  });

  it('reads slow against this paper, so a long paper does not flag its every question', () => {
    const quick = (order: number) =>
      item({ paperQuestionId: `pq_${order}`, order, sumTimeSec: 800 });
    const slow = item({ paperQuestionId: 'pq_3', order: 3, sumTimeSec: 8000, pValue: 0.1 });
    const rows = itemsOf([quick(1), quick(2), slow]);
    const flagged = rows.at(-1);

    assert.ok(flagged);
    assert.equal(flagged.paperQuestionId, 'pq_3');
    assert.deepEqual(flagged.signals, [ITEM_SIGNALS.LOW_ACCURACY, ITEM_SIGNALS.SLOW]);
    assert.equal(worthInspecting(flagged), true);
    assert.deepEqual(rows[0]?.signals, []);
  });

  it('orders by the paper, not by whatever order the rollup rows came back in', () => {
    const rows = [item({ paperQuestionId: 'pq_3', order: 3 }), item({ order: 1 })];

    assert.deepEqual(
      itemsOf(rows).map((row) => row.order),
      [1, 3],
    );
  });
});

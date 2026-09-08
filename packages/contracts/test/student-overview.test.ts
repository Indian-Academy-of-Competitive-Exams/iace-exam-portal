import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVALUATION_MODE,
  SUBJECT_SAMPLE_FLOOR,
  TEST_SCOPE,
  measureOf,
  ANSWER_STATE,
  PAPER_QUESTION_STATUS,
  dispositionRates,
  distractorThatWon,
  effortPerSitting,
  overallModeGap,
  questionReportInsights,
  scopesSat,
  standingTiles,
  subjectModeGaps,
  subjectShares,
  type OverviewStanding,
  type SubjectMeasure,
  type QuestionReportRow,
  type SubjectStanding,
} from '../src';

describe('measureOf', () => {
  const tallies = [
    {
      scope: TEST_SCOPE.FULL,
      evaluationMode: EVALUATION_MODE.RANKED,
      attempted: 40,
      correct: 30,
      sumTimeSec: 1_600,
    },
    {
      scope: TEST_SCOPE.SECTIONAL,
      evaluationMode: EVALUATION_MODE.RANKED,
      attempted: 20,
      correct: 5,
      sumTimeSec: 1_000,
    },
    {
      scope: TEST_SCOPE.FULL,
      evaluationMode: EVALUATION_MODE.PRACTICE,
      attempted: 10,
      correct: 9,
      sumTimeSec: 200,
    },
  ];

  it('sums every scope when none is named', () => {
    const measure = measureOf(tallies, EVALUATION_MODE.RANKED);

    assert.equal(measure.attempted, 60);
    assert.equal(measure.accuracy, 58.33);
    assert.equal(measure.pace, 43.33);
  });

  it('narrows to one scope when one is named', () => {
    const measure = measureOf(tallies, EVALUATION_MODE.RANKED, TEST_SCOPE.SECTIONAL);

    assert.equal(measure.attempted, 20);
    assert.equal(measure.accuracy, 25);
  });

  /** The toggle has to move something real, or it is a control that lies. */
  it('answers the two modes with different readings', () => {
    const ranked = measureOf(tallies, EVALUATION_MODE.RANKED);
    const practice = measureOf(tallies, EVALUATION_MODE.PRACTICE);

    assert.equal(practice.accuracy, 90);
    assert.notEqual(ranked.accuracy, practice.accuracy);
    assert.notEqual(ranked.pace, practice.pace);
  });

  /** Nothing attempted is not nought per cent, which would read as every answer wrong. */
  it('reads an unattempted set as unmeasured, never as zero', () => {
    const measure = measureOf(tallies, EVALUATION_MODE.PRACTICE, TEST_SCOPE.SECTIONAL);

    assert.equal(measure.attempted, 0);
    assert.equal(measure.accuracy, null);
    assert.equal(measure.pace, null);
  });

  /** A four-question subject must never draw the same bar as a four-hundred-question one. */
  it('leaves a low sample visible in its own n', () => {
    const measure = measureOf(
      [
        {
          scope: TEST_SCOPE.SECTIONAL,
          evaluationMode: EVALUATION_MODE.RANKED,
          attempted: 4,
          correct: 4,
          sumTimeSec: 100,
        },
      ],
      EVALUATION_MODE.RANKED,
    );

    assert.equal(measure.accuracy, 100);
    assert.ok(measure.attempted < SUBJECT_SAMPLE_FLOOR);
  });
});

describe('scopesSat', () => {
  const subjects: SubjectStanding[] = [
    {
      subjectId: 'sub_r',
      name: 'Reasoning',
      tallies: [
        {
          scope: TEST_SCOPE.SECTIONAL,
          evaluationMode: EVALUATION_MODE.RANKED,
          attempted: 8,
          correct: 8,
          sumTimeSec: 80,
        },
      ],
    },
    {
      subjectId: 'sub_q',
      name: 'Quantitative Aptitude',
      tallies: [
        {
          scope: TEST_SCOPE.FULL,
          evaluationMode: EVALUATION_MODE.PRACTICE,
          attempted: 30,
          correct: 27,
          sumTimeSec: 300,
        },
      ],
    },
  ];

  /** A filter offering a scope the student has never sat narrows to an empty chart. */
  it('offers only the scopes sat in the mode being read', () => {
    assert.deepEqual(scopesSat(subjects, EVALUATION_MODE.RANKED), [TEST_SCOPE.SECTIONAL]);
    assert.deepEqual(scopesSat(subjects, EVALUATION_MODE.PRACTICE), [TEST_SCOPE.FULL]);
  });

  it('offers nothing where nothing has been folded', () => {
    assert.deepEqual(scopesSat([], EVALUATION_MODE.RANKED), []);
  });

  /** A scope with rows but nothing answered in them would open on an empty ranking. */
  it('leaves out a scope nothing was attempted in', () => {
    const untouched: SubjectStanding[] = [
      {
        subjectId: 'sub_r',
        name: 'Reasoning',
        tallies: [
          {
            scope: TEST_SCOPE.SECTIONAL,
            evaluationMode: EVALUATION_MODE.RANKED,
            attempted: 0,
            correct: 0,
            sumTimeSec: 90,
          },
        ],
      },
    ];

    assert.deepEqual(scopesSat(untouched, EVALUATION_MODE.RANKED), []);
  });
});

describe('standingTiles', () => {
  const STANDING: OverviewStanding = {
    testsAttempted: 5,
    testsEvaluated: 4,
    practiceAttempts: 1,
    avgPercentile: 63.3,
    bestPercentile: 88.5,
    avgScore: 65,
    sumTimeSec: 7_200,
    lastAttemptAt: '2026-08-30T09:00:00.000Z',
  };
  const MEASURE: SubjectMeasure = {
    attempted: 50,
    correct: 31,
    accuracy: 62,
    sumTimeSec: 700,
    pace: 14,
  };

  it('leads on score and marking when the reader is on ranked', () => {
    const tiles = standingTiles(STANDING, MEASURE, EVALUATION_MODE.RANKED);

    assert.deepEqual(
      tiles.map((tile) => [tile.label, tile.value]),
      [
        ['Average score', 65],
        ['Tests marked', 4],
        ['Sittings', 5],
      ],
    );
  });

  /** A practice sitting is never evaluated against a board, so restating its score would be a lie. */
  it('answers with what practice counted, never a ranked figure under another name', () => {
    const tiles = standingTiles(STANDING, MEASURE, EVALUATION_MODE.PRACTICE);

    assert.deepEqual(
      tiles.map((tile) => [tile.label, tile.value]),
      [
        ['Practice sittings', 1],
        ['Questions answered', 50],
        ['Correct', 31],
      ],
    );
    assert.ok(!tiles.some((tile) => tile.value === STANDING.avgScore));
    assert.ok(!tiles.some((tile) => tile.value === STANDING.avgPercentile));
  });

  it('leaves an unmarked score null, for the screen to dash rather than read as zero', () => {
    const tiles = standingTiles({ ...STANDING, avgScore: null }, MEASURE, EVALUATION_MODE.RANKED);

    assert.equal(tiles[0]?.value, null);
  });
});

/** `testsAttempted` is every sitting, so under practice it would restate `practiceAttempts`. */
describe('standingTiles never shows one number twice', () => {
  it('gives practice three distinct counts when nothing of theirs is ranked', () => {
    const standing: OverviewStanding = {
      testsAttempted: 9,
      testsEvaluated: 0,
      practiceAttempts: 9,
      avgPercentile: null,
      bestPercentile: null,
      avgScore: null,
      sumTimeSec: 3_600,
      lastAttemptAt: null,
    };
    const measure: SubjectMeasure = {
      attempted: 48,
      correct: 8,
      accuracy: 16.67,
      sumTimeSec: 373,
      pace: 7.77,
    };

    const values = standingTiles(standing, measure, EVALUATION_MODE.PRACTICE).map(
      (tile) => tile.value,
    );

    assert.deepEqual(values, [9, 48, 8]);
    assert.equal(new Set(values).size, values.length);
  });
});

describe('dispositionRates', () => {
  it('reads the three shares off one partition', () => {
    const rates = dispositionRates({ correct: 8, wrong: 40, unattempted: 612 });

    assert.equal(rates.served, 660);
    assert.equal(rates.answered, 48);
    assert.equal(rates.attemptRate, 7.27);
    assert.equal(rates.accuracy, 16.67);
    assert.equal(rates.errorRate, 83.33);
  });

  /** A nought would read as "answered nothing right", which is not what nothing answered means. */
  it('leaves every share null when nothing was answered, never zero', () => {
    const rates = dispositionRates({ correct: 0, wrong: 0, unattempted: 100 });

    assert.equal(rates.attemptRate, 0);
    assert.equal(rates.accuracy, null);
    assert.equal(rates.errorRate, null);
  });

  it('has nothing to divide by when nothing was served', () => {
    const rates = dispositionRates({ correct: 0, wrong: 0, unattempted: 0 });

    assert.equal(rates.attemptRate, null);
    assert.equal(rates.served, 0);
  });
});

describe('subjectModeGaps', () => {
  const subjects: SubjectStanding[] = [
    {
      subjectId: 'sub_q',
      name: 'Quantitative Aptitude',
      tallies: [
        {
          scope: TEST_SCOPE.FULL,
          evaluationMode: EVALUATION_MODE.RANKED,
          attempted: 50,
          correct: 20,
          sumTimeSec: 500,
        },
        {
          scope: TEST_SCOPE.FULL,
          evaluationMode: EVALUATION_MODE.PRACTICE,
          attempted: 50,
          correct: 35,
          sumTimeSec: 1_000,
        },
      ],
    },
    {
      subjectId: 'sub_g',
      name: 'General Awareness',
      tallies: [
        {
          scope: TEST_SCOPE.FULL,
          evaluationMode: EVALUATION_MODE.PRACTICE,
          attempted: 20,
          correct: 10,
          sumTimeSec: 100,
        },
      ],
    },
  ];

  it('measures the drop from practice to ranked, in accuracy points', () => {
    const [quant] = subjectModeGaps(subjects);

    assert.equal(quant?.name, 'Quantitative Aptitude');
    assert.equal(quant?.accuracyGap, -30);
    assert.equal(quant?.paceGap, -10);
  });

  /** One side measured is not a gap: reporting it as zero would invent a subject that holds up. */
  it('drops a subject sat in only one mode rather than calling it level', () => {
    const gaps = subjectModeGaps(subjects);

    assert.equal(gaps.length, 1);
    assert.ok(!gaps.some((gap) => gap.name === 'General Awareness'));
  });
});

describe('subjectShares', () => {
  const subjects: SubjectStanding[] = [
    {
      subjectId: 'sub_q',
      name: 'Quantitative Aptitude',
      tallies: [
        {
          scope: TEST_SCOPE.FULL,
          evaluationMode: EVALUATION_MODE.PRACTICE,
          attempted: 40,
          correct: 10,
          sumTimeSec: 900,
        },
      ],
    },
    {
      subjectId: 'sub_r',
      name: 'Reasoning',
      tallies: [
        {
          scope: TEST_SCOPE.FULL,
          evaluationMode: EVALUATION_MODE.PRACTICE,
          attempted: 40,
          correct: 30,
          sumTimeSec: 300,
        },
      ],
    },
  ];

  it('marks the subject that eats the clock without paying it back', () => {
    const [quant, reasoning] = subjectShares(subjects, EVALUATION_MODE.PRACTICE);

    assert.equal(quant?.timeShare, 75);
    assert.equal(quant?.correctShare, 25);
    assert.equal(quant?.payoff, -50);

    assert.equal(reasoning?.payoff, 50);
  });

  it('leaves out a subject with nothing attempted in this mode', () => {
    assert.deepEqual(subjectShares(subjects, EVALUATION_MODE.RANKED), []);
  });
});

describe('effortPerSitting', () => {
  const standing: OverviewStanding = {
    testsAttempted: 9,
    testsEvaluated: 0,
    practiceAttempts: 9,
    avgPercentile: null,
    bestPercentile: null,
    avgScore: null,
    sumTimeSec: 3_600,
    lastAttemptAt: null,
  };

  it('divides the lifetime totals by the sittings behind them', () => {
    const effort = effortPerSitting(standing, { correct: 8, wrong: 40, unattempted: 612 });

    assert.equal(effort.questions, 73);
    assert.equal(effort.timeSec, 400);
  });

  it('has nothing to divide by before a first sitting', () => {
    const effort = effortPerSitting(
      { ...standing, testsAttempted: 0 },
      { correct: 0, wrong: 0, unattempted: 0 },
    );

    assert.deepEqual(effort, { questions: null, timeSec: null });
  });
});

describe('questionReportInsights', () => {
  const row = (over: Partial<QuestionReportRow>): QuestionReportRow =>
    ({
      questionId: 'q',
      paperQuestionId: 'pq',
      order: 1,
      baseConfigSectionId: 'sec',
      state: ANSWER_STATE.ANSWERED,
      selectedOptionId: null,
      typedAnswer: null,
      isCorrect: null,
      marksAwarded: null,
      marks: 2,
      negativeMarks: 0.5,
      disposition: PAPER_QUESTION_STATUS.ACTIVE,
      timeSpentSec: 0,
      predefinedDifficulty: null,
      attemptRate: null,
      accuracy: null,
      cohortAverageTimeSec: null,
      systemDifficulty: null,
      topperTimeSec: null,
      topperMarksAwarded: null,
      optionCounts: [],
      correctAnswer: null,
      ...over,
    }) as QuestionReportRow;

  it('splits the clock by what each question actually returned', () => {
    const insights = questionReportInsights([
      row({ isCorrect: true, timeSpentSec: 20 }),
      row({ isCorrect: false, timeSpentSec: 50 }),
      row({ isCorrect: null, timeSpentSec: 30 }),
    ]);

    assert.equal(insights.timeOnCorrectSec, 20);
    assert.equal(insights.timeOnWrongSec, 50);
    assert.equal(insights.timeOnBlankSec, 30);
    assert.equal(insights.wastedShare, 80);
  });

  /** A question nobody else answered either is not a question they lost their nerve on. */
  it('counts a blank against the field, not against the paper', () => {
    const insights = questionReportInsights([
      row({ isCorrect: null, attemptRate: 0.9 }),
      row({ isCorrect: null, attemptRate: 0.1 }),
      row({ isCorrect: null, attemptRate: null }),
      row({ isCorrect: false, attemptRate: 0.9 }),
    ]);

    assert.equal(insights.blankButAnswerable, 1);
  });

  it('has no share to report when the paper took no time at all', () => {
    assert.equal(questionReportInsights([row({})]).wastedShare, null);
  });
});

describe('distractorThatWon', () => {
  const counts = (values: readonly [number, number, boolean][]) =>
    values.map(([position, count, isCorrect], index) => ({
      optionId: `o${index}`,
      position,
      isCorrect,
      count,
    }));

  it('names the option the field reached for most', () => {
    const won = distractorThatWon({
      optionCounts: counts([
        [1, 3, false],
        [2, 11, false],
        [3, 6, true],
      ]),
    } as QuestionReportRow);

    assert.equal(won?.position, 2);
    assert.equal(won?.count, 11);
    assert.equal(won?.isCorrect, false);
  });

  /** Every option at zero is a question the rollup has not counted, not a question nobody answered. */
  it('says nothing where nothing was counted', () => {
    assert.equal(
      distractorThatWon({
        optionCounts: counts([
          [1, 0, false],
          [2, 0, true],
        ]),
      } as QuestionReportRow),
      null,
    );
    assert.equal(distractorThatWon({ optionCounts: [] } as unknown as QuestionReportRow), null);
  });
});

describe('overallModeGap', () => {
  const subjects: SubjectStanding[] = [
    {
      subjectId: 'sub_q',
      name: 'Quantitative Aptitude',
      tallies: [
        {
          scope: TEST_SCOPE.FULL,
          evaluationMode: EVALUATION_MODE.RANKED,
          attempted: 100,
          correct: 40,
          sumTimeSec: 1_000,
        },
        {
          scope: TEST_SCOPE.FULL,
          evaluationMode: EVALUATION_MODE.PRACTICE,
          attempted: 100,
          correct: 70,
          sumTimeSec: 500,
        },
      ],
    },
  ];

  it('measures the whole reader, not one subject at a time', () => {
    const gap = overallModeGap(subjects);

    assert.equal(gap.ranked.accuracy, 40);
    assert.equal(gap.practice.accuracy, 70);
    assert.equal(gap.accuracyGap, -30);
    assert.equal(gap.paceGap, 5);
  });

  /** Nothing sat in one mode leaves no gap: a missing side is not a side that scored zero. */
  it('reports no gap where one mode was never sat', () => {
    assert.equal(overallModeGap([]).accuracyGap, null);
  });
});

describe('standingTiles names the split behind the sitting count', () => {
  it('says how many of the sittings were practice', () => {
    const tiles = standingTiles(
      {
        testsAttempted: 9,
        testsEvaluated: 2,
        practiceAttempts: 7,
        avgPercentile: 50,
        bestPercentile: 60,
        avgScore: 40,
        sumTimeSec: 100,
        lastAttemptAt: null,
      },
      { attempted: 10, correct: 5, accuracy: 50, sumTimeSec: 100, pace: 10 },
      EVALUATION_MODE.RANKED,
    );

    assert.equal(tiles.at(-1)?.foot, '7 in practice');
  });
});

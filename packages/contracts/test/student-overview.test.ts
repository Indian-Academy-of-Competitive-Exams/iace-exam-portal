import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EVALUATION_MODE,
  SUBJECT_SAMPLE_FLOOR,
  TEST_SCOPE,
  measureOf,
  ANSWER_STATE,
  PAPER_QUESTION_STATUS,
  currentStreak,
  dispositionRates,
  distractorThatWon,
  longestStreak,
  practiceWindow,
  rankSubjectsByWeakness,
  shiftCivilDate,
  startOfLastMonth,
  effortPerSitting,
  overallModeGap,
  placeInSpread,
  scopeComparison,
  scopesNotSat,
  untouchedSubjects,
  questionReportInsights,
  scopesSat,
  standingTiles,
  subjectModeGaps,
  subjectShares,
  type OverviewStanding,
  type SubjectMeasure,
  type QuestionReportRow,
  type EvaluationMode,
  type SubjectStanding,
  type TestScope,
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
    assert.equal(effort.perServedSec, 5.45);
  });

  it('has nothing to divide by before a first sitting', () => {
    const effort = effortPerSitting(
      { ...standing, testsAttempted: 0 },
      { correct: 0, wrong: 0, unattempted: 0 },
    );

    assert.deepEqual(effort, { questions: null, timeSec: null, perServedSec: null });
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

describe('placeInSpread', () => {
  it('reads a score against the floor and the top the paper was actually scored', () => {
    assert.equal(placeInSpread(50, 0, 100), 50);
    assert.equal(placeInSpread(-5, -10, 10), 25);
  });

  /** A spread of one point is not a spread: dividing by it would put everyone at either end. */
  it('refuses a spread it cannot divide', () => {
    assert.equal(placeInSpread(50, null, 100), null);
    assert.equal(placeInSpread(50, 100, 100), null);
    assert.equal(placeInSpread(50, 0, null), null);
  });

  it('clamps a score outside the spread rather than reporting past the ends', () => {
    assert.equal(placeInSpread(120, 0, 100), 100);
    assert.equal(placeInSpread(-20, 0, 100), 0);
  });
});

describe('the blind spots every other figure filters out', () => {
  const tally = (scope: TestScope, mode: EvaluationMode, attempted: number, sumTimeSec = 0) => ({
    scope,
    evaluationMode: mode,
    attempted,
    correct: 0,
    sumTimeSec,
  });

  const subjects: SubjectStanding[] = [
    {
      subjectId: 'sub_e',
      name: 'English Comprehension',
      tallies: [tally(TEST_SCOPE.FULL, EVALUATION_MODE.PRACTICE, 0, 40)],
    },
    {
      subjectId: 'sub_q',
      name: 'Quantitative Aptitude',
      tallies: [tally(TEST_SCOPE.FULL, EVALUATION_MODE.PRACTICE, 12)],
    },
  ];

  /** The row exists because a paper asked; the zero is the answer that never came. */
  it('names a subject served and never answered', () => {
    const untouched = untouchedSubjects(subjects, EVALUATION_MODE.PRACTICE);

    assert.deepEqual(
      untouched.map((subject) => subject.name),
      ['English Comprehension'],
    );
  });

  it('holds nothing against a mode that was never sat at all', () => {
    assert.deepEqual(untouchedSubjects(subjects, EVALUATION_MODE.RANKED), []);
  });

  it('lists the kinds of paper this mode has never asked for', () => {
    const missing = scopesNotSat(subjects, EVALUATION_MODE.PRACTICE);

    assert.ok(!missing.includes(TEST_SCOPE.FULL));
    assert.ok(missing.includes(TEST_SCOPE.SECTIONAL));
  });
});

describe('scopeComparison', () => {
  const tally = (scope: TestScope, attempted: number, correct: number) => ({
    scope,
    evaluationMode: EVALUATION_MODE.RANKED,
    attempted,
    correct,
    sumTimeSec: 100,
  });

  const subjects: SubjectStanding[] = [
    {
      subjectId: 'sub_q',
      name: 'Quantitative Aptitude',
      tallies: [tally(TEST_SCOPE.FULL, 100, 40), tally(TEST_SCOPE.SECTIONAL, 50, 35)],
    },
  ];

  it('sets the two busiest kinds of paper against each other', () => {
    const compared = scopeComparison(subjects, EVALUATION_MODE.RANKED);

    assert.equal(compared?.first, TEST_SCOPE.FULL);
    assert.equal(compared?.second, TEST_SCOPE.SECTIONAL);
    assert.equal(compared?.subjects[0]?.accuracyGap, -30);
  });

  /** One kind of paper is not a comparison, and calling it one would invent a second side. */
  it('refuses a comparison with only one kind of paper behind it', () => {
    const one: SubjectStanding[] = [
      {
        subjectId: 'sub_q',
        name: 'Quantitative Aptitude',
        tallies: [tally(TEST_SCOPE.FULL, 10, 5)],
      },
    ];

    assert.equal(scopeComparison(one, EVALUATION_MODE.RANKED), null);
    assert.equal(scopeComparison([], EVALUATION_MODE.RANKED), null);
  });
});

describe('subjectShares names the share of answers too', () => {
  it('splits answers, clock and marks across the subjects', () => {
    const subjects: SubjectStanding[] = [
      {
        subjectId: 'a',
        name: 'A',
        tallies: [
          {
            scope: TEST_SCOPE.FULL,
            evaluationMode: EVALUATION_MODE.PRACTICE,
            attempted: 30,
            correct: 10,
            sumTimeSec: 100,
          },
        ],
      },
      {
        subjectId: 'b',
        name: 'B',
        tallies: [
          {
            scope: TEST_SCOPE.FULL,
            evaluationMode: EVALUATION_MODE.PRACTICE,
            attempted: 10,
            correct: 10,
            sumTimeSec: 300,
          },
        ],
      },
    ];

    const [a, b] = subjectShares(subjects, EVALUATION_MODE.PRACTICE);

    assert.equal(a?.attemptedShare, 75);
    assert.equal(b?.attemptedShare, 25);
    assert.equal(b?.timeShare, 75);
  });
});

describe('rankSubjectsByWeakness', () => {
  const subject = (
    subjectId: string,
    name: string,
    attempted: number,
    correct: number,
  ): SubjectStanding => ({
    subjectId,
    name,
    tallies: [
      {
        scope: TEST_SCOPE.FULL,
        evaluationMode: EVALUATION_MODE.RANKED,
        attempted,
        correct,
        sumTimeSec: attempted * 30,
      },
    ],
  });

  const subjects = [
    subject('sub_g', 'General Awareness', 40, 34),
    subject('sub_q', 'Quantitative Aptitude', 40, 12),
    subject('sub_r', 'Reasoning', 40, 24),
  ];

  it('puts the weakest first, which is the whole point of the panel', () => {
    const { weakest } = rankSubjectsByWeakness(subjects, EVALUATION_MODE.RANKED);

    assert.deepEqual(
      weakest.map((row) => row.name),
      ['Quantitative Aptitude', 'Reasoning', 'General Awareness'],
    );
    assert.equal(weakest[0]?.measure.accuracy, 30);
  });

  /** The failure this prevents: two questions and one miss branding a subject as somebody's worst. */
  it('holds a subject under the floor out of the ranking rather than ranking it bottom', () => {
    const thin = subject('sub_e', 'English', SUBJECT_SAMPLE_FLOOR - 1, 0);
    const ranking = rankSubjectsByWeakness([...subjects, thin], EVALUATION_MODE.RANKED);

    assert.ok(!ranking.weakest.some((row) => row.name === 'English'));
    assert.deepEqual(
      ranking.thin.map((row) => row.name),
      ['English'],
    );
    assert.equal(ranking.weakest[0]?.name, 'Quantitative Aptitude');
  });

  /** Served and never answered is a blind spot, not a weakness — it has no accuracy to rank on. */
  it('leaves out a subject nothing was answered in', () => {
    const ranking = rankSubjectsByWeakness(
      [...subjects, subject('sub_e', 'English', 0, 0)],
      EVALUATION_MODE.RANKED,
    );

    assert.equal(ranking.weakest.length + ranking.thin.length, 3);
  });

  it('reads the mode the dashboard is showing, never both at once', () => {
    const ranking = rankSubjectsByWeakness(subjects, EVALUATION_MODE.PRACTICE);

    assert.deepEqual(ranking, { weakest: [], thin: [] });
  });
});

describe('practiceWindow', () => {
  const sat = (date: string, sittings = 1) => ({ date, sittings });

  it('fills every day from the floor to today, zeros included, oldest first', () => {
    const window = practiceWindow([sat('2026-09-07', 2)], '2026-09-05', '2026-09-08');

    assert.deepEqual(window, [
      { date: '2026-09-05', sittings: 0 },
      { date: '2026-09-06', sittings: 0 },
      { date: '2026-09-07', sittings: 2 },
      { date: '2026-09-08', sittings: 0 },
    ]);
  });

  it('ignores a counted day outside the window it was asked for', () => {
    const window = practiceWindow([sat('2026-08-01')], '2026-09-07', '2026-09-08');

    assert.equal(
      window.every((day) => day.sittings === 0),
      true,
    );
  });
});

describe('startOfLastMonth', () => {
  it('opens on the first of the month before this one', () => {
    assert.equal(startOfLastMonth('2026-09-08'), '2026-08-01');
  });

  /** January's previous month is in the previous YEAR, which a naive decrement gets wrong. */
  it('crosses the year end', () => {
    assert.equal(startOfLastMonth('2026-01-15'), '2025-12-01');
  });
});

describe('currentStreak', () => {
  const on = (date: string) => ({ date, sittings: 1 });

  it('counts the run of days ending today', () => {
    const run = currentStreak([on('2026-09-06'), on('2026-09-07'), on('2026-09-08')], '2026-09-08');

    assert.equal(run, 3);
  });

  /** The day is not over: breaking a run before the reader could keep it would be wrong. */
  it('holds a run that ends yesterday, because today is still in progress', () => {
    assert.equal(currentStreak([on('2026-09-06'), on('2026-09-07')], '2026-09-08'), 2);
  });

  it('is broken once a whole day was missed', () => {
    assert.equal(currentStreak([on('2026-09-05'), on('2026-09-06')], '2026-09-08'), 0);
  });

  it('has no run without a sitting', () => {
    assert.equal(currentStreak([], '2026-09-08'), 0);
    assert.equal(currentStreak([{ date: '2026-09-08', sittings: 0 }], '2026-09-08'), 0);
  });
});

describe('longestStreak', () => {
  const on = (date: string) => ({ date, sittings: 1 });

  it('finds the best run anywhere, not the one ending today', () => {
    const best = longestStreak([
      on('2026-08-01'),
      on('2026-08-02'),
      on('2026-08-03'),
      on('2026-08-04'),
      on('2026-09-07'),
      on('2026-09-08'),
    ]);

    assert.equal(best, 4);
  });

  it('counts a lone day as a run of one, and nothing as none', () => {
    assert.equal(longestStreak([on('2026-09-08')]), 1);
    assert.equal(longestStreak([]), 0);
  });

  /** A run crossing a month end is one run: the calendar is not what breaks it. */
  it('runs across a month boundary', () => {
    assert.equal(longestStreak([on('2026-08-31'), on('2026-09-01')]), 2);
  });
});

describe('shiftCivilDate', () => {
  it('crosses a month and a year end without a zone getting involved', () => {
    assert.equal(shiftCivilDate('2026-09-01', -1), '2026-08-31');
    assert.equal(shiftCivilDate('2026-12-31', 1), '2027-01-01');
    assert.equal(shiftCivilDate('2028-02-28', 1), '2028-02-29');
  });
});

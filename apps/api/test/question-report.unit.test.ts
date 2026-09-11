import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  DIFFICULTY_LEVEL,
  QUESTION_TYPE,
  SYSTEM_DIFFICULTY,
  questionReportSchema,
  systemDifficultyOf,
} from '@iace/contracts';
import { QuestionReportService } from '../src/attempts/question-report.service';
import { paceIndexOf } from '../src/attempts/question-report';
import {
  FakePerformancePrisma,
  makeAttempt,
  makeScoredTest,
  makeServedAnswer,
  mcqOptions,
  type FakePerformanceData,
} from './support/fakes';

const STUDENT = 'stu_1';
const TOPPER = 'stu_2';
const ATTEMPT = 'att_1';
const TOPPER_ATTEMPT = 'att_9';
const ANSWER_TEXT = 'Cuttack';
const TYPED_GUESS = 'Bhubaneswar';

const SHAPE = makeScoredTest({
  sections: [
    {
      id: 'sec_1',
      name: 'Section A',
      order: 1,
      questionCount: 3,
      marksPerQuestion: 2,
      durationSec: null,
    },
  ],
});

/** One right, one wrong, one never touched, and a typed one whose key is text rather than an option. */
function served(attemptId: string, timing: readonly number[] = [40, 50, 5, 10]) {
  return [
    makeServedAnswer({
      attemptId,
      questionId: 'q1',
      paperQuestionId: 'pq_1',
      order: 1,
      selectedOptionId: 'o1',
      isCorrect: true,
      marksAwarded: 2,
      timeSpentSec: timing[0] ?? 0,
      state: ANSWER_STATE.ANSWERED,
      answerKey: { mode: 'EXACT', answers: { en: ANSWER_TEXT } },
      options: mcqOptions(1),
    }),
    makeServedAnswer({
      attemptId,
      questionId: 'q2',
      paperQuestionId: 'pq_2',
      order: 2,
      difficulty: DIFFICULTY_LEVEL.HIGH,
      selectedOptionId: 'o3',
      isCorrect: false,
      marksAwarded: -0.5,
      timeSpentSec: timing[1] ?? 0,
      state: ANSWER_STATE.ANSWERED,
      options: mcqOptions(2),
    }),
    makeServedAnswer({
      attemptId,
      questionId: 'q3',
      paperQuestionId: 'pq_3',
      order: 3,
      marksAwarded: 0,
      timeSpentSec: timing[2] ?? 0,
    }),
    makeServedAnswer({
      attemptId,
      questionId: 'q4',
      paperQuestionId: 'pq_4',
      order: 4,
      type: QUESTION_TYPE.TEXT_FIELD,
      typedAnswer: TYPED_GUESS,
      isCorrect: false,
      marksAwarded: 0,
      timeSpentSec: timing[3] ?? 0,
      state: ANSWER_STATE.ANSWERED,
      options: [],
      answerKey: { mode: 'EXACT', answers: { en: ANSWER_TEXT } },
    }),
  ];
}

function sittings() {
  return [
    makeAttempt({
      id: ATTEMPT,
      studentId: STUDENT,
      status: ATTEMPT_STATUS.EVALUATED,
      submittedAt: new Date('2026-08-24T06:00:00.000Z'),
      score: 1.5,
    }),
    makeAttempt({
      id: TOPPER_ATTEMPT,
      studentId: TOPPER,
      status: ATTEMPT_STATUS.EVALUATED,
      submittedAt: new Date('2026-08-24T06:00:00.000Z'),
      score: 6,
    }),
  ];
}

function bench(overrides: Partial<FakePerformanceData> = {}) {
  const attempts = overrides.attempts ?? sittings();
  const data: FakePerformanceData = {
    attempts,
    served: attempts.flatMap((row) =>
      served(row.id, row.id === TOPPER_ATTEMPT ? [20, 20, 20, 20] : undefined),
    ),
    shape: overrides.shape ?? SHAPE,
    students: [
      { id: STUDENT, deletedAt: null, currentBranchId: 'br_1' },
      { id: TOPPER, deletedAt: null, currentBranchId: 'br_1' },
    ],
    series: [],
    tests: [],
    testStats: [
      {
        testId: 'tst_1',
        evaluatedCount: 2,
        sumScore: 7.5,
        maxScore: 6,
        scoreHistogram: null,
        sumTimeSec: 250,
        topperAttemptId: TOPPER_ATTEMPT,
      },
    ],
    sectionStats: [],
    questionStats: [
      {
        testId: 'tst_1',
        paperQuestionId: 'pq_1',
        pValue: 0.8,
        attemptedCount: 8,
        skippedCount: 2,
        correctCount: 6,
        sumTimeSec: 300,
        optionCounts: { o1: 6, o3: 2 },
      },
      {
        testId: 'tst_1',
        paperQuestionId: 'pq_2',
        pValue: 0.2,
        attemptedCount: 5,
        skippedCount: 5,
        correctCount: 1,
        sumTimeSec: 400,
        optionCounts: { o2: 1, o3: 4 },
      },
    ],
    ...overrides,
  };

  const prisma = new FakePerformancePrisma(data);
  return { data, prisma, service: new QuestionReportService(prisma.asService()) };
}

describe('systemDifficultyOf', () => {
  it('bands a question by how hard the cohort actually found it', () => {
    assert.equal(systemDifficultyOf(0.8), SYSTEM_DIFFICULTY.EASY);
    assert.equal(systemDifficultyOf(0.7), SYSTEM_DIFFICULTY.EASY);
    assert.equal(systemDifficultyOf(0.5), SYSTEM_DIFFICULTY.MEDIUM);
    assert.equal(systemDifficultyOf(0.4), SYSTEM_DIFFICULTY.MEDIUM);
    assert.equal(systemDifficultyOf(0.2), SYSTEM_DIFFICULTY.HARD);
  });

  /** Nobody has attempted it, so the cohort has said nothing — which is not the same as hard. */
  it('reads an unmeasured question as no band at all', () => {
    assert.equal(systemDifficultyOf(null), null);
  });
});

describe('paceIndexOf', () => {
  it('reads above one for slower than the field and below it for faster', () => {
    assert.equal(paceIndexOf(240, 1200, 10), 2);
    assert.equal(paceIndexOf(60, 1200, 10), 0.5);
  });

  it('has no answer where the cohort has no clock, rather than dividing by nothing', () => {
    assert.equal(paceIndexOf(240, 1200, 0), null);
    assert.equal(paceIndexOf(240, 0, 10), null);
    assert.equal(paceIndexOf(240, Number.NaN, 10), null);
  });
});

describe('QuestionReportService — the cohort half, which needs no gate', () => {
  it('answers with the rollup beside the student, and the pace they set on it', async () => {
    const { service } = bench();

    const report = await service.forAttempt(STUDENT, ATTEMPT);

    assert.equal(questionReportSchema.safeParse(report).success, true);
    assert.equal(report.cohortSize, 2);
    // 105 seconds against a cohort averaging 125 of them.
    assert.equal(report.paceIndex, 0.84);
    const first = report.questions[0];
    assert.equal(first?.accuracy, 0.8);
    assert.equal(first?.systemDifficulty, SYSTEM_DIFFICULTY.EASY);
    assert.equal(first?.attemptRate, 0.8);
    assert.equal(first?.cohortAverageTimeSec, 30);
  });

  it('carries the topper clock without ever reading their answers', async () => {
    const { service } = bench();

    const report = await service.forAttempt(STUDENT, ATTEMPT);

    assert.deepEqual(
      report.questions.map((row) => row.topperTimeSec),
      [20, 20, 20, 20],
    );
    const payload = JSON.stringify(report);
    assert.equal(payload.includes(TOPPER), false);
    assert.equal(payload.includes(TOPPER_ATTEMPT), false);
  });

  /** The rollup has not reached this question, and a report must not go counting for itself. */
  it('shows a dash for a question no rollup has counted yet', async () => {
    const { service } = bench();

    const report = await service.forAttempt(STUDENT, ATTEMPT);

    const tail = report.questions[2];
    assert.equal(tail?.accuracy, null);
    assert.equal(tail?.attemptRate, null);
    assert.equal(tail?.cohortAverageTimeSec, null);
    assert.equal(tail?.systemDifficulty, null);
  });
});

describe('QuestionReportService — the answer key it carries', () => {
  /** Nothing shuts a test, so the student's own EVALUATED sitting is the whole of the gate. */
  it('serves the key and the option split off a marked sitting', async () => {
    const { service } = bench();

    const report = await service.forAttempt(STUDENT, ATTEMPT);

    const first = report.questions[0];
    assert.equal(first?.correctOptionId, 'o1');
    // An option names the answer, so the typed key is only carried where there are no options.
    assert.equal(first?.correctAnswer, null);
    assert.equal(report.questions[3]?.correctAnswer, ANSWER_TEXT);
    assert.deepEqual(
      first?.optionCounts.map((option) => [option.position, option.count, option.isCorrect]),
      [
        [1, 6, true],
        [2, 0, false],
        [3, 2, false],
        [4, 0, false],
      ],
    );
  });

  /** The raw column never rides along: an option's `isCorrect` is the only shape the key takes. */
  it('never carries the stored answer key on the payload', async () => {
    const { service } = bench();

    const payload = JSON.stringify(await service.forAttempt(STUDENT, ATTEMPT));

    assert.equal(payload.includes('answerKey'), false);
  });
});

describe('QuestionReportService — the admin way in', () => {
  it('serves the same table for a student the admin branches reach', async () => {
    const { service } = bench();

    const report = await service.forStudent(STUDENT, ATTEMPT);

    assert.equal(report.attemptId, ATTEMPT);
    assert.equal(JSON.stringify(report).includes('answerKey'), false);
  });
});

import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  AppException,
  COHORT_COMPARISON_FLOOR,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  QUESTION_TYPE,
  TEST_SCOPE,
  questionReportSchema,
} from '@iace/contracts';
import { AttemptReportService } from '../src/attempts/attempt-report.service';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { QuestionReportService } from '../src/attempts/question-report.service';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FakeQueue, FakeStorage, fakeQueueFailures, FakeMetrics } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeStudent,
  resetDatabase,
  servedAnswers,
  sitPaper,
  testPrisma,
  type Paper,
} from './support/database';

const ANSWER_TEXT = 'Cuttack';
const TYPED_GUESS = 'Bhubaneswar';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const processor = new ScoringProcessor(
  prisma,
  new RollupQueue(new FakeQueue().asQueue()),
  new NotificationsService(prisma),
  fakeQueueFailures(),
  new PaperSheetService(prisma),
  new RollupService(prisma),
  new FakeMetrics().asService(),
);

const leaderboard = new LeaderboardService(prisma);
const service = new QuestionReportService(prisma, leaderboard);
const review = new AttemptReportService(
  prisma,
  leaderboard,
  new FakeStorage() as never,
  new PaperSheetService(prisma),
);

async function sat(paper: Paper, timeSpent: readonly number[], startedAt?: Date) {
  const student = await makeStudent(prisma);
  const attempt = await sitPaper(prisma, {
    paper,
    studentId: student.id,
    chosen: [RIGHT_OPTION, 'o3', null, null],
    typed: [null, null, null, TYPED_GUESS],
    timeSpent,
    ...(startedAt && { startedAt, submittedAt: new Date(startedAt.getTime() + 60_000) }),
  });
  await processor.score(attempt.id);
  return { studentId: student.id, attemptId: attempt.id };
}

/** One right, one wrong, one never touched, and a typed one; a rollup over the first two only. */
async function sittings() {
  const paper = await makePaper(prisma, {
    questions: [
      'Reasoning',
      { subject: 'Reasoning', difficulty: DIFFICULTY_LEVEL.HIGH },
      'Reasoning',
      {
        subject: 'Reasoning',
        type: QUESTION_TYPE.TEXT_FIELD,
        options: [],
        answerKey: { mode: 'EXACT', answers: { en: ANSWER_TEXT } },
      },
    ],
  });
  const mine = await sat(paper, [40, 50, 5, 10]);
  // The same marks in a minute, so the board seats them first.
  const topper = await sat(paper, [20, 20, 20, 20], new Date('2026-08-24T05:00:00.000Z'));
  const [first, second] = paper.items;
  const computedAt = new Date();
  await prisma.testStat.create({
    data: {
      testId: paper.testId,
      // The item rows below describe ten sittings, so the cohort is open to compare against.
      evaluatedCount: 10,
      sumTimeSec: 1250,
      computedAt,
    },
  });
  await prisma.testQuestionStat.createMany({
    data: [
      {
        testId: paper.testId,
        paperQuestionId: first?.paperQuestionId ?? '',
        questionId: first?.questionId ?? '',
        skippedCount: 2,
        correctCount: 6,
        wrongCount: 2,
        sumTimeSec: 300,
        optionCounts: { o1: 6, o3: 2 },
        computedAt,
      },
      {
        testId: paper.testId,
        paperQuestionId: second?.paperQuestionId ?? '',
        questionId: second?.questionId ?? '',
        skippedCount: 5,
        correctCount: 1,
        wrongCount: 4,
        sumTimeSec: 400,
        optionCounts: { o2: 1, o3: 4 },
        computedAt,
      },
    ],
  });
  return { mine, topper, testId: paper.testId, baseConfigId: paper.catalog.baseConfigId };
}

describe('QuestionReportService — the cohort half, which needs no gate', () => {
  it('reads each answer and its marks off the sheet, in the order the sitting was served', async () => {
    const onPaper = await makePaper(prisma, {
      questions: ['Reasoning', 'Reasoning', 'Reasoning', 'Reasoning'],
    });
    // Shuffled, and with a seed that really reorders this section — so a reader ignoring it still fails.
    await prisma.baseConfig.update({
      where: { id: onPaper.catalog.baseConfigId },
      data: { shuffleQuestions: true },
    });
    const student = await makeStudent(prisma);
    const attempt = await sitPaper(prisma, {
      paper: onPaper,
      studentId: student.id,
      chosen: [RIGHT_OPTION, 'o3', null, null],
      shuffleSeed: 1,
    });
    await processor.score(attempt.id);

    const report = await service.forAttempt(student.id, attempt.id);

    assert.notDeepEqual(
      report.questions.map((row) => row.questionId),
      onPaper.items.map((item) => item.questionId),
    );
    assert.deepEqual(
      report.questions.map((row) => [
        row.questionId,
        row.order,
        row.selectedOptionId,
        row.isCorrect,
        row.marksAwarded,
      ]),
      (await servedAnswers(prisma, attempt.id)).map((row) => [
        row.questionId,
        row.order,
        row.selectedOptionId,
        row.isCorrect,
        row.marksAwarded,
      ]),
    );
  });

  it('answers with the rollup beside the student, and the pace they set on it', async () => {
    const { mine } = await sittings();

    const report = await service.forAttempt(mine.studentId, mine.attemptId);

    assert.equal(questionReportSchema.safeParse(report).success, true);
    // 105 seconds against a cohort averaging 125 of them.
    assert.equal(report.paceIndex, 0.84);
    const first = report.questions[0];
    assert.equal(first?.accuracy, 0.75);
    assert.equal(first?.attemptRate, 0.8);
    assert.equal(first?.cohortAverageTimeSec, 30);
  });

  it('carries the topper clock without ever exposing who they are', async () => {
    const { mine, topper } = await sittings();

    const report = await service.forAttempt(mine.studentId, mine.attemptId);

    assert.deepEqual(
      report.questions.map((row) => row.topperTimeSec),
      [20, 20, 20, 20],
    );
    const payload = JSON.stringify(report);
    assert.equal(payload.includes(topper.studentId), false);
    assert.equal(payload.includes(topper.attemptId), false);
  });

  /** The rollup has not reached this question, and a report must not go counting for itself. */
  it('shows a dash for a question no rollup has counted yet', async () => {
    const { mine } = await sittings();

    const report = await service.forAttempt(mine.studentId, mine.attemptId);

    const tail = report.questions[2];
    assert.equal(tail?.accuracy, null);
    assert.equal(tail?.attemptRate, null);
    assert.equal(tail?.cohortAverageTimeSec, null);
  });
});

describe('QuestionReportService — the paper as this sitting was served it', () => {
  /** The failure this prevents: "Option 2" here naming a different row from the review's second. */
  it('numbers each option by the seat the review shows it in, on a paper that shuffles them', async () => {
    const onPaper = await makePaper(prisma, {
      questions: ['Reasoning', 'Reasoning', 'Reasoning'],
    });
    await prisma.baseConfig.update({
      where: { id: onPaper.catalog.baseConfigId },
      data: { shuffleOptions: true },
    });
    const student = await makeStudent(prisma);
    const attempt = await sitPaper(prisma, {
      paper: onPaper,
      studentId: student.id,
      chosen: [RIGHT_OPTION, 'o3', null],
      shuffleSeed: 1,
    });
    await processor.score(attempt.id);

    const report = await service.forAttempt(student.id, attempt.id);
    const reviewed = await review.solutions(student.id, attempt.id, {});

    const seated = report.questions.map((row) => row.optionCounts.map((option) => option.optionId));
    // A seed that really reorders them, so a reader numbering by the stored position still fails.
    assert.notDeepEqual(
      seated,
      report.questions.map(() => ['o1', 'o2', 'o3', 'o4']),
    );
    assert.deepEqual(
      seated,
      reviewed.questions.map((row) => row.options.map((option) => option.id)),
    );
    assert.deepEqual(
      report.questions.map((row) => row.optionCounts.map((option) => option.position)),
      report.questions.map(() => [1, 2, 3, 4]),
    );
    assert.deepEqual(
      report.questions.map((row) => row.correctOptionId),
      report.questions.map(() => RIGHT_OPTION),
    );
  });

  /** The failure this prevents: a sectional report listing sections the paper never served. */
  it('lists only the section a sectional test covers', async () => {
    const onPaper = await makePaper(prisma, {
      sections: ['Reasoning', 'Quant', 'English'],
      scope: TEST_SCOPE.SECTIONAL,
      questions: [{ subject: 'English', section: 2 }],
    });
    await prisma.test.update({
      where: { id: onPaper.testId },
      data: { scopeRef: { sectionId: onPaper.sectionIds[2] } },
    });
    const student = await makeStudent(prisma);
    const attempt = await sitPaper(prisma, {
      paper: onPaper,
      studentId: student.id,
      chosen: [RIGHT_OPTION],
    });
    await processor.score(attempt.id);

    const report = await service.forAttempt(student.id, attempt.id);

    assert.deepEqual(report.sections, [
      {
        id: onPaper.sectionIds[2],
        name: 'English',
        order: 3,
        questionCount: 10,
        durationSec: null,
      },
    ]);
  });
});

describe('QuestionReportService — the floor the comparison waits for', () => {
  /** The failure this prevents: "100% got it right" beside the first sitter's own right answer. */
  it('holds every cohort column back until enough students have sat the paper', async () => {
    const { mine, testId } = await sittings();
    await prisma.testStat.update({
      where: { testId },
      data: { evaluatedCount: COHORT_COMPARISON_FLOOR - 1 },
    });

    const report = await service.forAttempt(mine.studentId, mine.attemptId);

    assert.equal(report.paceIndex, null, 'a pace of 1.00 against yourself is not a comparison');
    assert.deepEqual(
      report.questions.map((row) => [row.accuracy, row.attemptRate, row.topperTimeSec]),
      report.questions.map(() => [null, null, null]),
    );
    // The option split goes with them: one vote is not a distribution.
    assert.equal(
      report.questions.every((row) => row.optionCounts.every((option) => option.count === 0)),
      true,
    );
    // Their own answers are untouched: a missing cohort costs the column, never the row.
    assert.deepEqual(
      report.questions.map((row) => row.isCorrect),
      [true, false, null, false],
    );
    questionReportSchema.parse(report);
  });
});

describe('QuestionReportService — the sittings it names', () => {
  /** The failure this prevents: "10 sittings" here beside "rank 2 of 2" on the score card. */
  it('counts them live, the n the score card ranks out of, however far the rollup lags', async () => {
    const { mine, testId } = await sittings();

    const report = await service.forAttempt(mine.studentId, mine.attemptId);
    const standing = await leaderboard.standing(testId, mine.attemptId);

    assert.equal(report.cohortSize, 2);
    assert.equal(report.cohortSize, standing?.cohortSize);
  });
});

describe('QuestionReportService — the sitting it will not report on', () => {
  const refusedWith = (code: string) => (error: unknown) =>
    AppException.is(error) && error.code === code;

  /** The failure this prevents: a voided sitting reading as marking still queued, behind a Retry that cannot work. */
  it('says a voided sitting was set aside, and an unmarked one only that it is not marked', async () => {
    const paper = await makePaper(prisma, { questions: ['Reasoning'] });
    const student = await makeStudent(prisma);
    const sitting = { paper, studentId: student.id, chosen: [RIGHT_OPTION] };
    const unmarked = await sitPaper(prisma, sitting);
    const voided = await sitPaper(prisma, {
      ...sitting,
      attemptNo: 2,
      isGraded: false,
      status: ATTEMPT_STATUS.VOIDED,
    });

    await assert.rejects(
      () => service.forAttempt(student.id, voided.id),
      refusedWith(ErrorCodes.SITTING_VOIDED),
    );
    await assert.rejects(
      () => service.forAttempt(student.id, unmarked.id),
      refusedWith(ErrorCodes.CONFLICT),
    );
  });
});

describe('QuestionReportService — the answer key it carries', () => {
  it('serves the key and the option split as stored, on a paper that shuffles no options', async () => {
    const { mine, baseConfigId } = await sittings();
    await prisma.baseConfig.update({
      where: { id: baseConfigId },
      data: { shuffleOptions: false },
    });

    const report = await service.forAttempt(mine.studentId, mine.attemptId);

    const first = report.questions[0];
    assert.equal(first?.correctOptionId, RIGHT_OPTION);
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
    const { mine } = await sittings();

    const report = await service.forAttempt(mine.studentId, mine.attemptId);

    assert.equal(JSON.stringify(report).includes('answerKey'), false);
  });
});

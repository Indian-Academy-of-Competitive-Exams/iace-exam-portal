import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { DIFFICULTY_LEVEL, QUESTION_TYPE, questionReportSchema } from '@iace/contracts';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { QuestionReportService } from '../src/attempts/question-report.service';
import { RollupOutbox } from '../src/attempts/rollup-outbox';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { FakeEventBus, FakeQueue, fakeQueueFailures } from '../test/support/fakes';
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
  new RollupOutbox(new FakeQueue().asQueue()),
  new FakeEventBus().asService(),
  new NotificationOutbox(new FakeQueue().asQueue()),
  fakeQueueFailures(),
  new PaperSheetService(prisma),
);

const service = new QuestionReportService(prisma);

async function sat(paper: Paper, timeSpent: readonly number[]) {
  const student = await makeStudent(prisma);
  const attempt = await sitPaper(prisma, {
    paper,
    studentId: student.id,
    chosen: [RIGHT_OPTION, 'o3', null, null],
    typed: [null, null, null, TYPED_GUESS],
    timeSpent,
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
  const topper = await sat(paper, [20, 20, 20, 20]);
  const [first, second] = paper.items;
  const computedAt = new Date();
  await prisma.testStat.create({
    data: {
      testId: paper.testId,
      evaluatedCount: 2,
      sumScore: 7.5,
      maxScore: 6,
      sumTimeSec: 250,
      topperAttemptId: topper.attemptId,
      computedAt,
    },
  });
  await prisma.testQuestionStat.createMany({
    data: [
      {
        testId: paper.testId,
        paperQuestionId: first?.paperQuestionId ?? '',
        questionId: first?.questionId ?? '',
        pValue: 0.8,
        attemptedCount: 8,
        skippedCount: 2,
        correctCount: 6,
        sumTimeSec: 300,
        optionCounts: { o1: 6, o3: 2 },
        computedAt,
      },
      {
        testId: paper.testId,
        paperQuestionId: second?.paperQuestionId ?? '',
        questionId: second?.questionId ?? '',
        pValue: 0.2,
        attemptedCount: 5,
        skippedCount: 5,
        correctCount: 1,
        sumTimeSec: 400,
        optionCounts: { o2: 1, o3: 4 },
        computedAt,
      },
    ],
  });
  return { mine, topper };
}

describe('QuestionReportService — the cohort half, which needs no gate', () => {
  it('reads each answer and its marks off the sheet, in the order the sitting was served', async () => {
    const { mine } = await sittings();
    await prisma.attemptQuestion.updateMany({
      where: { attemptId: mine.attemptId },
      data: { selectedOptionId: 'stale', isCorrect: null, marksAwarded: 0 },
    });

    const report = await service.forAttempt(mine.studentId, mine.attemptId);

    assert.deepEqual(
      report.questions.map((row) => [
        row.questionId,
        row.order,
        row.selectedOptionId,
        row.isCorrect,
        row.marksAwarded,
      ]),
      (await servedAnswers(prisma, mine.attemptId)).map((row) => [
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
    assert.equal(report.cohortSize, 2);
    // 105 seconds against a cohort averaging 125 of them.
    assert.equal(report.paceIndex, 0.84);
    const first = report.questions[0];
    assert.equal(first?.accuracy, 0.8);
    assert.equal(first?.attemptRate, 0.8);
    assert.equal(first?.cohortAverageTimeSec, 30);
  });

  it('carries the topper clock without ever reading their answers', async () => {
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

describe('QuestionReportService — the answer key it carries', () => {
  it('serves the key and the option split off a marked sitting', async () => {
    const { mine } = await sittings();

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
  it('never carries the stored answer key on the payload, on either way in', async () => {
    const { mine } = await sittings();

    const own = await service.forAttempt(mine.studentId, mine.attemptId);
    const admin = await service.forStudent(mine.studentId, mine.attemptId);

    assert.equal(admin.attemptId, mine.attemptId);
    for (const report of [own, admin]) {
      assert.equal(JSON.stringify(report).includes('answerKey'), false);
    }
  });
});

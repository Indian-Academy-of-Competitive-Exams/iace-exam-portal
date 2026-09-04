import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  type AppException,
} from '@iace/contracts';
import { PaperService } from '../src/tests/paper.service';
import { SCORING_REQUEST, ScoringOutbox } from '../src/attempts/scoring-outbox';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { AuditContext } from '../src/audit';
import {
  FakeQueue,
  FakeTestsPrisma,
  makeAttempt,
  makeBaseConfig,
  makeQuestion,
  makeSection,
  makeTest,
  rowAt,
  type FakeAttemptQuestionRow,
  type FakePaperRow,
} from './support/fakes';

const TEST_ID = 'tst_1';
const DROPPED_ROW = 'pq_1';

const row = (id: string, questionId: string, variant: number): FakePaperRow => ({
  id,
  testId: TEST_ID,
  baseConfigId: 'cfg_1',
  baseConfigSectionId: 'sec_1',
  questionId,
  questionVersionId: `${questionId}_v1`,
  variant,
  order: 1,
  marks: 2,
  negativeMarks: 0.5,
  status: PAPER_QUESTION_STATUS.ACTIVE,
});

/** The same question on two variants of one GENERATED paper, plus an unrelated one. */
const paper: FakePaperRow[] = [row('pq_1', 'q1', 0), row('pq_1_v1', 'q1', 1), row('pq_2', 'q2', 0)];

/** Three sittings: two ended and one still running, all of them served the row being dropped. */
const sittings = () => [
  makeAttempt({
    id: 'att_1',
    studentId: 'stu_1',
    testId: TEST_ID,
    status: ATTEMPT_STATUS.EVALUATED,
  }),
  makeAttempt({
    id: 'att_2',
    studentId: 'stu_2',
    testId: TEST_ID,
    status: ATTEMPT_STATUS.SUBMITTED,
  }),
  makeAttempt({
    id: 'att_3',
    studentId: 'stu_3',
    testId: TEST_ID,
    status: ATTEMPT_STATUS.IN_PROGRESS,
  }),
];

const served = (): FakeAttemptQuestionRow[] =>
  ['att_1', 'att_2', 'att_3'].map((attemptId) => ({
    attemptId,
    questionId: 'q1',
    paperQuestionId: DROPPED_ROW,
    questionVersionId: 'q1_v1',
    baseConfigSectionId: 'sec_1',
    order: 1,
    selectedOptionId: null,
    typedAnswer: null,
    state: ANSWER_STATE.NOT_VISITED,
    timeSpentSec: 0,
  }));

function bench(isLocked = true) {
  const prisma = new FakeTestsPrisma(
    [makeTest({ id: TEST_ID, isLocked })],
    [makeBaseConfig({ id: 'cfg_1', totalQuestions: 2 })],
    [makeSection({ id: 'sec_1', baseConfigId: 'cfg_1', questionCount: 2 })],
    [],
    ['q1', 'q2'].map((id) => makeQuestion({ id, currentVersionId: `${id}_v1` })),
    [...paper.map((row) => ({ ...row }))],
    [],
    sittings(),
    served(),
  );
  const stages = new ExamStagesService(prisma.asService(), new AuditContext());
  const configs = new BaseConfigsService(prisma.asService(), stages, new AuditContext());
  const queue = new FakeQueue();
  const outbox = new ScoringOutbox(prisma.asService(), queue.asQueue());
  return {
    prisma,
    queue,
    service: new PaperService(prisma.asService(), configs, outbox, new AuditContext()),
  };
}

const scoringRequests = (prisma: FakeTestsPrisma) =>
  prisma.outboxEvents.filter((row) => row.eventType === SCORING_REQUEST.EVENT_TYPE);

describe('dropping a question on a paper somebody has already sat', () => {
  it('marks the row and asks for every ended sitting that served it to be scored again', async () => {
    const { prisma, queue, service } = bench();

    await service.setQuestionStatus(TEST_ID, DROPPED_ROW, PAPER_QUESTION_STATUS.DROPPED);

    // Every variant carrying that question, because a faulty question is faulty on all of them.
    assert.deepEqual(
      prisma.paperQuestions.filter((paperRow) => paperRow.questionId === 'q1').map((r) => r.status),
      [PAPER_QUESTION_STATUS.DROPPED, PAPER_QUESTION_STATUS.DROPPED],
    );
    assert.deepEqual(
      scoringRequests(prisma)
        .map((event) => event.aggregateId)
        .sort(),
      ['att_1', 'att_2'],
    );
    // Handed on by the sweeper, not inline: a cohort is not something to relay in a request.
    assert.equal(queue.jobs.length, 0);
  });

  /** The failure this prevents: a second click re-scoring a whole cohort for no change at all. */
  it('does nothing at all when the status it is asked for is the one it already has', async () => {
    const { prisma, service } = bench();
    await service.setQuestionStatus(TEST_ID, DROPPED_ROW, PAPER_QUESTION_STATUS.DROPPED);
    const asked = scoringRequests(prisma).length;

    await service.setQuestionStatus(TEST_ID, DROPPED_ROW, PAPER_QUESTION_STATUS.DROPPED);

    assert.equal(scoringRequests(prisma).length, asked);
  });

  it('leaves every other question on the paper where it was', async () => {
    const { prisma, service } = bench();

    await service.setQuestionStatus(TEST_ID, DROPPED_ROW, PAPER_QUESTION_STATUS.BONUS);

    assert.equal(
      prisma.paperQuestions.find((paperRow) => paperRow.id === 'pq_2')?.status,
      PAPER_QUESTION_STATUS.ACTIVE,
    );
  });

  it('asks for nothing when the question is on a paper nobody has sat', async () => {
    const { prisma, service } = bench();
    prisma.attemptQuestions.length = 0;

    await service.setQuestionStatus(TEST_ID, DROPPED_ROW, PAPER_QUESTION_STATUS.DROPPED);

    assert.equal(scoringRequests(prisma).length, 0);
    assert.equal(
      prisma.paperQuestions.find((paperRow) => paperRow.id === DROPPED_ROW)?.status,
      PAPER_QUESTION_STATUS.DROPPED,
    );
  });

  /** One sitting, two served rows for the same question, is still one re-score. */
  it('asks once per sitting, however many rows of that question it served', async () => {
    const { prisma, service } = bench();
    prisma.attemptQuestions.push({
      ...rowAt(served()),
      questionId: 'q1',
      paperQuestionId: 'pq_1_v1',
      order: 2,
    });

    await service.setQuestionStatus(TEST_ID, DROPPED_ROW, PAPER_QUESTION_STATUS.DROPPED);

    assert.equal(scoringRequests(prisma).length, 2);
  });

  it('takes a dropped question back, which is another change and another re-score', async () => {
    const { prisma, service } = bench();
    await service.setQuestionStatus(TEST_ID, DROPPED_ROW, PAPER_QUESTION_STATUS.DROPPED);

    await service.setQuestionStatus(TEST_ID, DROPPED_ROW, PAPER_QUESTION_STATUS.ACTIVE);

    assert.equal(
      prisma.paperQuestions.find((paperRow) => paperRow.id === DROPPED_ROW)?.status,
      PAPER_QUESTION_STATUS.ACTIVE,
    );
    assert.equal(scoringRequests(prisma).length, 4);
  });

  it('refuses on a paper nobody has finalized, where the draft is the thing to edit', async () => {
    const { prisma, service } = bench(false);

    await assert.rejects(
      () => service.setQuestionStatus(TEST_ID, DROPPED_ROW, PAPER_QUESTION_STATUS.DROPPED),
      (error: AppException) => error.code === ErrorCodes.CONFLICT,
    );
    assert.equal(scoringRequests(prisma).length, 0);
  });

  it('refuses a row that belongs to another paper', async () => {
    const { service } = bench();

    await assert.rejects(
      () => service.setQuestionStatus(TEST_ID, 'pq_elsewhere', PAPER_QUESTION_STATUS.DROPPED),
      (error: AppException) => error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

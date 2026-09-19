import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ATTEMPT_STATUS,
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  type AppException,
  type PaperQuestionStatus,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { SCORING_REQUEST, ScoringOutbox } from '../src/attempts/scoring-outbox';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { PaperService } from '../src/tests/paper.service';
import { FakeQueue, FakeRedis } from '../test/support/fakes';
import {
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  uid,
} from './support/database';

const A_REASON = 'Answer key was wrong';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** A frozen two-question paper; two sittings ended and one still running, all served the first row. */
async function bench({ isLocked = true, sat = true } = {}) {
  const paper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
  await prisma.test.update({
    where: { id: paper.testId },
    data: { isLocked, ...(isLocked ? { finalizedAt: new Date() } : {}) },
  });
  const ended: string[] = [];
  if (sat) {
    for (const status of [
      ATTEMPT_STATUS.EVALUATED,
      ATTEMPT_STATUS.SUBMITTED,
      ATTEMPT_STATUS.IN_PROGRESS,
    ]) {
      const attempt = await sitPaper(prisma, {
        paper,
        studentId: (await makeStudent(prisma)).id,
        chosen: [null, null],
        status,
        ...(status === ATTEMPT_STATUS.IN_PROGRESS ? { submittedAt: null } : {}),
      });
      if (status !== ATTEMPT_STATUS.IN_PROGRESS) ended.push(attempt.id);
    }
  }
  const audit = new AuditContext();
  const stages = new ExamStagesService(prisma, audit);
  const queue = new FakeQueue();
  const service = new PaperService(
    prisma,
    new BaseConfigsService(prisma, stages, audit),
    new ScoringOutbox(prisma, queue.asQueue()),
    audit,
    new FakeRedis().asService(),
  );
  const [dropped, kept] = paper.items.map((item) => item.paperQuestionId);
  const set = (status: PaperQuestionStatus, row = dropped ?? '') =>
    service.setQuestionStatus(paper.testId, row, { status, reason: A_REASON });
  return { paper, ended, queue, audit, set, dropped: dropped ?? '', kept: kept ?? '' };
}

const scoringRequests = () =>
  prisma.outboxEvent.findMany({ where: { eventType: SCORING_REQUEST.EVENT_TYPE } });

const statusOf = async (id: string) =>
  (await prisma.paperQuestion.findUniqueOrThrow({ where: { id } })).status;

describe('dropping a question on a paper somebody has already sat', () => {
  it('marks the row and asks for every ended sitting that served it to be scored again', async () => {
    const { set, dropped, ended, queue } = await bench();

    await set(PAPER_QUESTION_STATUS.DROPPED);

    assert.equal(await statusOf(dropped), PAPER_QUESTION_STATUS.DROPPED);
    assert.deepEqual(
      (await scoringRequests()).map((event) => event.aggregateId).sort(),
      [...ended].sort(),
    );
    // Handed on by the sweeper, not inline: a cohort is not something to relay in a request.
    assert.equal(queue.jobs.length, 0);
  });

  /** The failure this prevents: a second click re-scoring a whole cohort for no change at all. */
  it('does nothing at all when the status it is asked for is the one it already has', async () => {
    const { set } = await bench();
    await set(PAPER_QUESTION_STATUS.DROPPED);
    const asked = (await scoringRequests()).length;

    await set(PAPER_QUESTION_STATUS.DROPPED);

    assert.equal((await scoringRequests()).length, asked);
  });

  it('leaves every other question on the paper where it was', async () => {
    const { set, kept } = await bench();

    await set(PAPER_QUESTION_STATUS.BONUS);

    assert.equal(await statusOf(kept), PAPER_QUESTION_STATUS.ACTIVE);
  });

  it('asks for nothing when the question is on a paper nobody has sat', async () => {
    const { set, dropped } = await bench({ sat: false });

    await set(PAPER_QUESTION_STATUS.DROPPED);

    assert.equal((await scoringRequests()).length, 0);
    assert.equal(await statusOf(dropped), PAPER_QUESTION_STATUS.DROPPED);
  });

  it('takes a dropped question back, which is another change and another re-score', async () => {
    const { set, dropped } = await bench();
    await set(PAPER_QUESTION_STATUS.DROPPED);

    await set(PAPER_QUESTION_STATUS.ACTIVE);

    assert.equal(await statusOf(dropped), PAPER_QUESTION_STATUS.ACTIVE);
    assert.equal((await scoringRequests()).length, 4);
  });

  it('refuses on a paper nobody has finalized, where the draft is the thing to edit', async () => {
    const { set } = await bench({ isLocked: false });

    await assert.rejects(
      () => set(PAPER_QUESTION_STATUS.DROPPED),
      (error: AppException) => error.code === ErrorCodes.CONFLICT,
    );
    assert.equal((await scoringRequests()).length, 0);
  });

  it('refuses a row that belongs to another paper', async () => {
    const { set } = await bench();

    await assert.rejects(
      () => set(PAPER_QUESTION_STATUS.DROPPED, uid()),
      (error: AppException) => error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('the audit row a disposition change leaves behind', () => {
  it('carries the row, the move it made, and the reason the admin gave for it', async () => {
    const { audit, set, dropped } = await bench();

    const store = await audit.run(async () => {
      await set(PAPER_QUESTION_STATUS.DROPPED);
      return audit.current();
    });

    // Against the ROW, not the test: "test updated" cannot settle a dispute about one question.
    assert.equal(store?.entityId, dropped);
    assert.deepEqual(store?.changed, {
      status: { from: PAPER_QUESTION_STATUS.ACTIVE, to: PAPER_QUESTION_STATUS.DROPPED },
      reason: { from: null, to: A_REASON },
    });
  });

  /** The failure this prevents: a re-click logging a change that moved nothing and re-scored nothing. */
  it('is not written when the status asked for is the one the row already has', async () => {
    const { audit, set } = await bench();
    await set(PAPER_QUESTION_STATUS.DROPPED);

    const store = await audit.run(async () => {
      await set(PAPER_QUESTION_STATUS.DROPPED);
      return audit.current();
    });

    assert.equal(store?.entityId, null);
    assert.equal(store?.changed, null);
  });
});

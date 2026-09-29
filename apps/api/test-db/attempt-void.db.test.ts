import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ATTEMPT_STATUS, AppException, ErrorCodes, type AttemptStatus } from '@iace/contracts';
import { AttemptResolutionService } from '../src/attempts/attempt-resolution.service';
import { SUPPORT_ACTIONS } from '../src/attempts/attempt-resolution';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { AuditContext } from '../src/audit';
import { ROLLUP_JOBS } from '../src/queue/queues';
import { FakeQueue, FakeRedis } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makeAdmin,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
} from './support/database';

const REASON = 'The hall lost power mid-paper';
const HOUR_MS = 60 * 60 * 1000;

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** One real sitting and the service over it; Redis, the queue and the catalog bust stay fakes. */
async function sitting(over: { status?: AttemptStatus; isGraded?: boolean } = {}) {
  const paper = await makePaper(prisma, { questions: ['Reasoning'] });
  const studentId = (await makeStudent(prisma)).id;
  const adminId = (await makeAdmin(prisma)).id;
  const status = over.status ?? ATTEMPT_STATUS.EVALUATED;
  const live = status === ATTEMPT_STATUS.IN_PROGRESS;
  const startedAt = new Date(Date.now() - HOUR_MS);
  const attempt = await sitPaper(prisma, {
    paper,
    studentId,
    chosen: [RIGHT_OPTION],
    status,
    isGraded: over.isGraded ?? true,
    startedAt,
    ...(live ? { submittedAt: null } : {}),
  });
  const state = new AttemptStateService(
    prisma,
    new FakeRedis().asService(),
    new PaperSheetService(prisma),
  );
  if (live) {
    await state.open({
      id: attempt.id,
      studentId,
      testId: paper.testId,
      startedAt,
      endsAt: new Date(Date.now() + HOUR_MS),
    });
  }
  const rollupQueue = new FakeQueue();
  const audit = new AuditContext();
  const service = new AttemptResolutionService(
    prisma,
    state,
    {} as never,
    new RollupQueue(rollupQueue.asQueue()),
    audit,
  );
  const voiding = (regrantRanked = false) =>
    service.void(attempt.id, { reason: REASON, regrantRanked }, adminId);
  return {
    attemptId: attempt.id,
    testId: paper.testId,
    studentId,
    adminId,
    state,
    rollupQueue,
    audit,
    voiding,
  };
}

const row = (id: string) => prisma.attempt.findUniqueOrThrow({ where: { id } });

describe('voiding a sitting — archived, and taken out of everything that counted it', () => {
  it('archives rather than deletes, and records who stood it down and why', async () => {
    const { attemptId, adminId, voiding } = await sitting();

    const resolved = await voiding();

    const voided = await row(attemptId);
    assert.equal(voided.status, ATTEMPT_STATUS.VOIDED);
    assert.equal(voided.voidReason, REASON);
    assert.equal(voided.voidedById, adminId);
    assert.notEqual(voided.voidedAt, null);
    assert.equal(resolved.status, ATTEMPT_STATUS.VOIDED);
  });

  /** The bug this prevents: a voided sitting that keeps skewing the cohort's percentile. */
  it('asks for every aggregate that counted it to be recounted', async () => {
    const { testId, studentId, rollupQueue, voiding } = await sitting();

    await voiding();

    assert.deepEqual(
      rollupQueue.jobs.map((job) => [job.name, job.data]),
      [
        [ROLLUP_JOBS.REBUILD_TEST, { testId }],
        [ROLLUP_JOBS.REBUILD_STUDENT, { studentId }],
      ],
    );
  });

  /** The bug this prevents: a student still saving into a sitting that is void, and a stale read skipping the recount. */
  it('takes the live key of a sitting still being answered, and still asks for the recount', async () => {
    const { attemptId, state, rollupQueue, voiding } = await sitting({
      status: ATTEMPT_STATUS.IN_PROGRESS,
    });
    assert.ok(await state.read(attemptId));

    await voiding();

    assert.equal(await state.read(attemptId), null);
    assert.equal(rollupQueue.jobs.length, 2);
  });

  it('leaves the ranked slot spent unless the regrant was asked for', async () => {
    const { attemptId, voiding } = await sitting();

    const resolved = await voiding();

    assert.equal((await row(attemptId)).isGraded, true);
    assert.equal(resolved.rankedRegranted, false);
  });

  /** Clearing `isGraded` on the void IS the regrant: no sitting holds the slot, so the next one ranks. */
  it('hands the slot back when the regrant is asked for on a ranked sitting', async () => {
    const { attemptId, voiding } = await sitting();

    const resolved = await voiding(true);

    assert.equal((await row(attemptId)).isGraded, false);
    assert.equal(resolved.rankedRegranted, true);
  });

  it('has nothing to hand back on a retake, whatever was ticked', async () => {
    const { attemptId, voiding } = await sitting({ isGraded: false });

    const resolved = await voiding(true);

    assert.equal((await row(attemptId)).isGraded, false);
    assert.equal(resolved.rankedRegranted, false);
  });

  it('files the audit row against the student, naming the action and the reason', async () => {
    const { studentId, audit, voiding } = await sitting();

    await audit.run(async () => {
      await voiding();
      const filed = audit.current();
      assert.equal(filed?.entityId, studentId);
      assert.deepEqual(filed?.changed?.supportAction, { from: null, to: SUPPORT_ACTIONS.VOID });
      assert.deepEqual(filed?.changed?.reason, { from: null, to: REASON });
    });
  });

  it('refuses a second void rather than voiding it twice', async () => {
    const { voiding } = await sitting();
    await voiding();

    await assert.rejects(
      voiding(),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });
});

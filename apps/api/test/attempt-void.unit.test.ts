import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ATTEMPT_STATUS, AppException, ErrorCodes, type AttemptStatus } from '@iace/contracts';
import { AttemptResolutionService } from '../src/attempts/attempt-resolution.service';
import { SUPPORT_ACTIONS } from '../src/attempts/attempt-resolution';

const ADMIN = 'adm_1';
const REASON = 'The hall lost power mid-paper';

interface Row {
  id: string;
  studentId: string;
  testId: string;
  status: AttemptStatus;
  endsAt: Date;
  isGraded: boolean;
  voidedAt: Date | null;
  voidReason: string | null;
  voidedById?: string | null;
}

/** Hand-rolled doubles: this asserts what a void ASKS FOR, so each collaborator only records. */
function build(over: Partial<Row> = {}) {
  const row: Row = {
    id: 'att_1',
    studentId: 'stu_1',
    testId: 'tst_1',
    status: ATTEMPT_STATUS.EVALUATED,
    endsAt: new Date('2026-09-09T10:00:00.000Z'),
    isGraded: true,
    voidedAt: null,
    voidReason: null,
    ...over,
  };

  const asked = {
    forgotten: [] as string[],
    boardRebuilds: [] as string[],
    testRebuilds: [] as string[],
    studentRebuilds: [] as string[],
    stateTaken: [] as string[],
    invalidated: [] as string[],
    changed: null as Record<string, { from: unknown; to: unknown }> | null,
    entityId: null as string | null,
  };

  const prisma = {
    attempt: {
      findUnique: () => Promise.resolve({ ...row }),
      update: ({ data }: { data: Partial<Row> }) => {
        Object.assign(row, data);
        return Promise.resolve(row);
      },
    },
  } as never;

  const state = {
    take: (id: string) => {
      asked.stateTaken.push(id);
      return Promise.resolve(null);
    },
  } as never;

  const leaderboard = {
    forget: (testId: string, attemptId: string) => {
      asked.forgotten.push(`${testId}:${attemptId}`);
      return Promise.resolve();
    },
    askForRebuild: (testId: string) => {
      asked.boardRebuilds.push(testId);
      return Promise.resolve();
    },
  } as never;

  const rollup = {
    rebuild: (testId: string) => {
      asked.testRebuilds.push(testId);
      return Promise.resolve();
    },
    rebuildStudent: (studentId: string) => {
      asked.studentRebuilds.push(studentId);
      return Promise.resolve();
    },
  } as never;

  const access = {
    invalidateStudent: (studentId: string) => {
      asked.invalidated.push(studentId);
      return Promise.resolve();
    },
  } as never;

  const audit = {
    setEntityId: (id: string) => {
      asked.entityId = id;
    },
    setChanged: (diff: Record<string, { from: unknown; to: unknown }>) => {
      asked.changed = diff;
    },
  } as never;

  const service = new AttemptResolutionService(
    prisma,
    state,
    {} as never,
    leaderboard,
    rollup,
    access,
    audit,
  );
  return { service, row, asked };
}

describe('voiding a sitting — archived, and taken out of everything that counted it', () => {
  it('archives rather than deletes, and records who stood it down and why', async () => {
    const { service, row } = build();

    const resolved = await service.void('att_1', { reason: REASON, regrantRanked: false }, ADMIN);

    assert.equal(row.status, ATTEMPT_STATUS.VOIDED);
    assert.equal(row.voidReason, REASON);
    assert.equal(row.voidedById, ADMIN);
    assert.notEqual(row.voidedAt, null);
    assert.equal(resolved.status, ATTEMPT_STATUS.VOIDED);
  });

  /** The bug this prevents: a voided sitting that keeps skewing the cohort's percentile. */
  it('forgets the board row and asks for every aggregate that counted it to be recounted', async () => {
    const { service, asked } = build({ status: ATTEMPT_STATUS.EVALUATED });

    await service.void('att_1', { reason: REASON, regrantRanked: false }, ADMIN);

    assert.deepEqual(asked.forgotten, ['tst_1:att_1']);
    assert.deepEqual(asked.boardRebuilds, ['tst_1']);
    assert.deepEqual(asked.testRebuilds, ['tst_1']);
    assert.deepEqual(asked.studentRebuilds, ['stu_1']);
  });

  /** Nothing counted an unfinished sitting, so there is nothing to recount and no board to touch. */
  it('asks for no recount when the sitting had never been marked', async () => {
    const { service, asked } = build({ status: ATTEMPT_STATUS.IN_PROGRESS });

    await service.void('att_1', { reason: REASON, regrantRanked: false }, ADMIN);

    assert.deepEqual(asked.testRebuilds, []);
    assert.deepEqual(asked.studentRebuilds, []);
    assert.deepEqual(asked.forgotten, []);
    // The live key still goes, or the student would keep saving into a sitting that is void.
    assert.deepEqual(asked.stateTaken, ['att_1']);
  });

  it('leaves the ranked slot spent unless the regrant was asked for', async () => {
    const { service, row, asked } = build();

    const resolved = await service.void('att_1', { reason: REASON, regrantRanked: false }, ADMIN);

    assert.equal(row.isGraded, true);
    assert.equal(resolved.rankedRegranted, false);
    assert.equal(asked.invalidated[0], 'stu_1');
  });

  /** Clearing `isGraded` on the void IS the regrant: no sitting holds the slot, so the next one ranks. */
  it('hands the slot back when the regrant is asked for on a ranked sitting', async () => {
    const { service, row } = build();

    const resolved = await service.void('att_1', { reason: REASON, regrantRanked: true }, ADMIN);

    assert.equal(row.isGraded, false);
    assert.equal(resolved.rankedRegranted, true);
  });

  it('has nothing to hand back on a retake, whatever was ticked', async () => {
    const { service, row } = build({ isGraded: false });

    const resolved = await service.void('att_1', { reason: REASON, regrantRanked: true }, ADMIN);

    assert.equal(row.isGraded, false);
    assert.equal(resolved.rankedRegranted, false);
  });

  it('files the audit row against the student, naming the action and the reason', async () => {
    const { service, asked } = build();

    await service.void('att_1', { reason: REASON, regrantRanked: false }, ADMIN);

    assert.equal(asked.entityId, 'stu_1');
    assert.deepEqual(asked.changed?.supportAction, { from: null, to: SUPPORT_ACTIONS.VOID });
    assert.deepEqual(asked.changed?.reason, { from: null, to: REASON });
  });

  it('refuses a second void rather than voiding it twice', async () => {
    const { service } = build({ status: ATTEMPT_STATUS.VOIDED });

    await assert.rejects(
      () => service.void('att_1', { reason: REASON, regrantRanked: false }, ADMIN),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );
  });
});

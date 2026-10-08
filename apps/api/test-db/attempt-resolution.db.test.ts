import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { after, beforeEach, describe, it } from 'node:test';
import { type Prisma } from '@prisma/client';
import { ATTEMPT_STATUS, AppException, ErrorCodes, type FieldDiff } from '@iace/contracts';
import { AttemptResolutionService } from '../src/attempts/attempt-resolution.service';
import { SUPPORT_ACTIONS, resolutionBlocker } from '../src/attempts/attempt-resolution';
import { AttemptSheetService } from '../src/attempts/attempt-sheet.service';
import { AttemptStateService } from '../src/attempts/attempt-state.service';
import { ScoringQueue } from '../src/attempts/scoring-queue';
import { SubmitService } from '../src/attempts/submit.service';
import { AuditContext } from '../src/audit';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { type PrismaService } from '../src/prisma/prisma.service';
import { ROLLUP_JOBS } from '../src/queue/queues';
import { redisKeys } from '../src/redis/redis.keys';
import { FakeQueue, FakeRedis, fakeQueueFailures, FakeMetrics } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makeAdmin,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  uid,
} from './support/database';

const RIGHT = RIGHT_OPTION;
const WRONG = 'o2';
const ADMIN = uid();
const REASON = 'Reconciling a race with the scorer';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const studentStat = (studentId: string) => prisma.studentStat.findUnique({ where: { studentId } });

/** Doubles for everything a void touches besides the row and the rollup: irrelevant to this race. */
function support() {
  const state = { take: () => Promise.resolve(null) } as never;
  const audit = { setEntityId: () => undefined, setChanged: () => undefined } as never;
  return { state, audit };
}

/** The real client, held open right after the scorer's last write until the test lets it commit. */
function stallingScorer(
  client: PrismaService,
  gate: Promise<void>,
  markReached: () => void,
): PrismaService {
  return new Proxy(client, {
    get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: object) => Promise<unknown>, options?: object) =>
        target.$transaction(
          (tx) =>
            work(
              new Proxy(tx as object, {
                get(txTarget, txKey) {
                  if (txKey !== 'notification') return Reflect.get(txTarget, txKey) as unknown;
                  const delegate = Reflect.get(txTarget, txKey) as object;
                  return new Proxy(delegate, {
                    get(delTarget, method) {
                      const call = Reflect.get(delTarget, method) as unknown;
                      if (method !== 'createMany') return call;
                      return async (...args: unknown[]) => {
                        const result = await (call as (...a: unknown[]) => Promise<unknown>).apply(
                          delTarget,
                          args,
                        );
                        markReached();
                        await gate;
                        return result;
                      };
                    },
                  });
                },
              }),
            ),
          options,
        );
    },
  });
}

describe('AttemptResolutionService — voiding a sitting the scorer is mid-flight on', () => {
  /** The failure this prevents: a fold that committed after void's read judged safe to skip forever. */
  it('reverses the student rollup even off a snapshot read before the fold committed', async () => {
    const paper = await makePaper(prisma, {
      questions: ['Reasoning', 'Reasoning', 'Maths', 'Maths'],
    });
    const { id: studentId } = await makeStudent(prisma);
    const attempt = await sitPaper(prisma, {
      paper,
      studentId,
      chosen: [RIGHT, WRONG, null, RIGHT],
    });

    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markReached = (): void => undefined;
    const reached = new Promise<void>((resolve) => {
      markReached = resolve;
    });

    const scoring = new ScoringProcessor(
      stallingScorer(prisma, gate, markReached),
      new RollupQueue(new FakeQueue().asQueue()),
      new NotificationsService(prisma),
      fakeQueueFailures(),
      new PaperSheetService(prisma),
      new RollupService(prisma),
      new FakeMetrics().asService(),
    );
    const rollupQueue = new FakeQueue();
    const { state, audit } = support();
    const resolution = new AttemptResolutionService(
      prisma,
      state,
      {} as never,
      {} as never,
      new RollupQueue(rollupQueue.asQueue()),
      audit,
    );

    const scored = scoring.score(attempt.id);
    await reached;
    // The scorer's fold is written but not committed: nothing outside its transaction can see it yet.
    assert.equal((await studentStat(studentId))?.testsEvaluated ?? 0, 0);

    const voided = resolution.void(attempt.id, { reason: REASON, regrantRanked: false }, ADMIN);
    const raced = await Promise.race([
      voided.then(() => 'voided'),
      delay(200).then(() => 'blocked'),
    ]);
    assert.equal(raced, 'blocked', "the void must block on the scorer's row lock, not run past it");

    release();
    await scored;
    await voided;

    assert.equal((await studentStat(studentId))?.testsEvaluated, 1, "the scorer's fold committed");
    const row = await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
    assert.equal(row.status, ATTEMPT_STATUS.VOIDED);

    const rebuildJob = rollupQueue.jobs.find((job) => job.name === ROLLUP_JOBS.REBUILD_STUDENT);
    assert.ok(rebuildJob, 'the void asked for the student to be recounted off its stale snapshot');

    await new RollupService(prisma).rebuildStudent(studentId);
    const reversed = await studentStat(studentId);
    assert.equal(
      reversed?.testsEvaluated,
      0,
      'the voided sitting no longer counts toward the student',
    );
  });
});

const MINUTE_MS = 60 * 1000;
const HALF_HOUR_MS = 30 * MINUTE_MS;

/** The real client, running `meanwhile` once, right after the read a support action judges the sitting by. */
function afterTheRead(client: PrismaService, meanwhile: () => Promise<unknown>): PrismaService {
  let pending = true;
  return new Proxy(client, {
    get(target, key) {
      if (key !== 'attempt') return Reflect.get(target, key) as unknown;
      return new Proxy(target.attempt, {
        get(delegate, method) {
          if (method !== 'findUnique') return Reflect.get(delegate, method) as unknown;
          return async (args: Prisma.AttemptFindUniqueArgs) => {
            const row = await delegate.findUnique(args);
            if (pending) {
              pending = false;
              await meanwhile();
            }
            return row;
          };
        },
      });
    },
  });
}

/** A sitting with its live key open, half an hour from its deadline unless started earlier, and the console over it. */
async function desk(startedAt = new Date(Date.now() - HALF_HOUR_MS)) {
  const paper = await makePaper(prisma, { questions: ['Reasoning'] });
  const studentId = (await makeStudent(prisma)).id;
  const attempt = await sitPaper(prisma, {
    paper,
    studentId,
    chosen: [null],
    status: ATTEMPT_STATUS.IN_PROGRESS,
    startedAt,
    submittedAt: null,
  });
  const { endsAt } = await prisma.attempt.findUniqueOrThrow({ where: { id: attempt.id } });
  const papers = new PaperSheetService(prisma);
  const redis = new FakeRedis();
  const state = new AttemptStateService(prisma, redis.asService(), papers);
  const sheets = new AttemptSheetService(prisma, papers);
  const scoring = new ScoringQueue(new FakeQueue().asQueue());
  const submit = new SubmitService(prisma, state, scoring, new FakeMetrics().asService(), sheets);
  const audit = new AuditContext();
  const rollup = new RollupQueue(new FakeQueue().asQueue());
  const live = { id: attempt.id, studentId, testId: paper.testId, startedAt, endsAt };
  await state.open(live);
  return {
    attemptId: attempt.id,
    studentId,
    endsAt,
    live,
    redis,
    state,
    submit,
    audit,
    /** The live key as a state service reading Postgres through `client` sees it. */
    stateOn: (client: PrismaService) =>
      new AttemptStateService(client, redis.asService(), new PaperSheetService(client)),
    /** The console, reading and writing through `client`, over the live key `held` reaches. */
    on: (client: PrismaService = prisma, held: AttemptStateService = state) =>
      new AttemptResolutionService(client, held, sheets, submit, rollup, audit),
  };
}

type Desk = Awaited<ReturnType<typeof desk>>;

/** One request's worth of audit: what the action answered, and what it filed before it did. */
function filed<T>(audit: AuditContext, action: () => Promise<T>) {
  return audit.run(async () => {
    const outcome = await action().then(
      (answered) => ({ answered, refused: null }),
      (refused: unknown) => ({ answered: null, refused }),
    );
    return { ...outcome, changed: audit.current()?.changed ?? (null as FieldDiff | null) };
  });
}

const conflictSaying = (refused: unknown, message: string | null): boolean =>
  AppException.is(refused) && refused.code === ErrorCodes.CONFLICT && refused.message === message;

const rowOf = (id: string) => prisma.attempt.findUniqueOrThrow({ where: { id } });

describe('AttemptResolutionService — an action that lost the sitting to another', () => {
  const landing: Record<string, (built: Desk, adminId: string) => Promise<unknown>> = {
    "the student's own submit": (built) => built.submit.submit(built.studentId, built.attemptId),
    'a force-submit': (built) => built.on().forceSubmit(built.attemptId, { reason: REASON }),
    'a void': (built, adminId) =>
      built.on().void(built.attemptId, { reason: REASON, regrantRanked: false }, adminId),
  };

  for (const [what, land] of Object.entries(landing)) {
    /** The failure this prevents: minutes added to, and audited against, a sitting that had ended. */
    it(`refuses an extend that read the sitting before ${what} landed`, async () => {
      const built = await desk();
      const adminId = (await makeAdmin(prisma)).id;
      // In a request of its own, as it would be: what it files is not the extend's to answer for.
      const racing = built.on(
        afterTheRead(prisma, () => built.audit.run(() => land(built, adminId))),
      );

      const extend = await filed(built.audit, () =>
        racing.extend(built.attemptId, { minutes: 15, reason: REASON }),
      );

      assert.ok(
        conflictSaying(
          extend.refused,
          resolutionBlocker(SUPPORT_ACTIONS.EXTEND, ATTEMPT_STATUS.SUBMITTED),
        ),
      );
      assert.equal(extend.changed, null, 'a refused extend files nothing');
      assert.equal((await rowOf(built.attemptId)).endsAt.getTime(), built.endsAt.getTime());
    });
  }

  /** The failure this prevents: the second void rewriting who stood the sitting down, and why. */
  it('gives two voids at once to one of them, and keeps that one’s account of it', async () => {
    const built = await desk();
    const [first, second] = [(await makeAdmin(prisma)).id, (await makeAdmin(prisma)).id];
    const voiding = (adminId: string, regrantRanked: boolean) =>
      filed(built.audit, () =>
        built.on().void(built.attemptId, { reason: `By ${adminId}`, regrantRanked }, adminId),
      );

    const voids = await Promise.all([voiding(first, true), voiding(second, false)]);

    const [won, ...others] = voids.filter((call) => call.answered !== null);
    const lost = voids.filter((call) => call.refused !== null);
    assert.equal(others.length, 0, 'only one void may answer');
    assert.equal(lost.length, 1);
    assert.ok(
      conflictSaying(
        lost[0]?.refused,
        resolutionBlocker(SUPPORT_ACTIONS.VOID, ATTEMPT_STATUS.VOIDED),
      ),
    );
    assert.equal(lost[0]?.changed, null, 'the void that lost files nothing');

    const row = await rowOf(built.attemptId);
    const winner = won?.answered?.rankedRegranted ? first : second;
    assert.deepEqual([row.voidedById, row.voidReason], [winner, `By ${winner}`]);
    assert.equal(row.voidedAt?.toISOString(), won?.answered?.voidedAt);
    assert.equal(row.isGraded, !won?.answered?.rankedRegranted);
    assert.equal(won?.answered?.isGraded, row.isGraded);
  });

  /** The failure this prevents: a force-submit audited, and answered 201, for a sitting another call ended. */
  it('answers only the force-submit that ended the sitting when two land together', async () => {
    const built = await desk();
    const forcing = () =>
      filed(built.audit, () => built.on().forceSubmit(built.attemptId, { reason: REASON }));

    const calls = await Promise.all([forcing(), forcing()]);

    const lost = calls.filter((call) => call.refused !== null);
    assert.equal(calls.filter((call) => call.answered !== null).length, 1);
    assert.equal(lost.length, 1);
    assert.ok(
      conflictSaying(
        lost[0]?.refused,
        resolutionBlocker(SUPPORT_ACTIONS.FORCE_SUBMIT, ATTEMPT_STATUS.SUBMITTED),
      ),
    );
    assert.equal(lost[0]?.changed, null);
  });

  it('refuses a force-submit that read the sitting before a void landed', async () => {
    const built = await desk();
    const adminId = (await makeAdmin(prisma)).id;
    const racing = built.on(
      afterTheRead(prisma, () =>
        built.audit.run(() =>
          built.on().void(built.attemptId, { reason: REASON, regrantRanked: false }, adminId),
        ),
      ),
    );

    const forced = await filed(built.audit, () =>
      racing.forceSubmit(built.attemptId, { reason: REASON }),
    );

    assert.ok(
      conflictSaying(
        forced.refused,
        resolutionBlocker(SUPPORT_ACTIONS.FORCE_SUBMIT, ATTEMPT_STATUS.SUBMITTED),
      ),
    );
    assert.equal(forced.changed, null);
    assert.equal((await rowOf(built.attemptId)).status, ATTEMPT_STATUS.VOIDED);
  });

  it('answers and files the force-submit that did end the sitting', async () => {
    const built = await desk();

    const forced = await filed(built.audit, () =>
      built.on().forceSubmit(built.attemptId, { reason: REASON }),
    );

    assert.equal(forced.answered?.status, ATTEMPT_STATUS.SUBMITTED);
    assert.deepEqual(forced.changed?.status, {
      from: ATTEMPT_STATUS.IN_PROGRESS,
      to: ATTEMPT_STATUS.SUBMITTED,
    });
  });
});

describe('AttemptResolutionService — a deadline moved from two sides at once', () => {
  const deadlines = async (built: Desk) => ({
    row: (await rowOf(built.attemptId)).endsAt.toISOString(),
    key: (await built.state.read(built.attemptId))?.endsAt,
  });

  /** The failure this prevents: both extends counted from the deadline they read, and one of them lost. */
  it('counts both of two extends that land together, and files what each one did', async () => {
    const built = await desk();
    const extending = (minutes: number) =>
      filed(built.audit, () => built.on().extend(built.attemptId, { minutes, reason: REASON }));

    const calls = await Promise.all([extending(15), extending(30)]);

    const both = new Date(built.endsAt.getTime() + 45 * MINUTE_MS).toISOString();
    assert.deepEqual(await deadlines(built), { row: both, key: both });
    const moves = calls
      .map((call) => ({
        from: String(call.changed?.endsAt?.from),
        to: String(call.changed?.endsAt?.to),
        minutes: Number(call.changed?.minutes?.to),
      }))
      .sort((a, b) => a.from.localeCompare(b.from));
    assert.deepEqual(
      [moves[0]?.from, moves[0]?.to, moves[1]?.to],
      [built.endsAt.toISOString(), moves[1]?.from, both],
    );
    for (const move of moves) {
      assert.equal(Date.parse(move.to) - Date.parse(move.from), move.minutes * MINUTE_MS);
    }
  });

  /** Fifteen minutes added to a deadline an hour gone would buy nothing, so a stuck sitting counts from now. */
  it('counts from now once the deadline has already gone', async () => {
    const built = await desk(new Date(Date.now() - 4 * HALF_HOUR_MS));
    const now = new Date();

    const extended = await built.on().extend(built.attemptId, { minutes: 15, reason: REASON }, now);

    const fromNow = new Date(now.getTime() + 15 * MINUTE_MS).toISOString();
    assert.equal(extended.endsAt, fromNow);
    assert.deepEqual(await deadlines(built), { row: fromNow, key: fromNow });
  });

  /** The failure this prevents: a 409 for an extend that did move the row, retried into double the minutes. */
  it('answers the extend whose live key gave way, and the key follows the row on the next open', async () => {
    const built = await desk();
    const pushDeadline = built.state.pushDeadline.bind(built.state);
    built.state.pushDeadline = () => Promise.reject(new AppException(ErrorCodes.CONFLICT));

    const extend = await filed(built.audit, () =>
      built.on().extend(built.attemptId, { minutes: 15, reason: REASON }),
    );
    built.state.pushDeadline = pushDeadline;

    const moved = new Date(built.endsAt.getTime() + 15 * MINUTE_MS);
    assert.equal(extend.refused, null);
    assert.equal(extend.changed?.endsAt?.to, moved.toISOString());
    assert.equal((await rowOf(built.attemptId)).endsAt.toISOString(), moved.toISOString());

    await built.state.open({ ...built.live, endsAt: moved });
    assert.equal((await built.state.read(built.attemptId))?.endsAt, moved.toISOString());
  });

  /** The failure this prevents: a reset rebuilding the key around the deadline it read before the extend. */
  it('keeps an extension that landed while the live sitting was being put back', async () => {
    const built = await desk();
    const rebuilding = built.stateOn(
      afterTheRead(prisma, () =>
        built.audit.run(() => built.on().extend(built.attemptId, { minutes: 15, reason: REASON })),
      ),
    );

    await built.on(prisma, rebuilding).reset(built.attemptId, { reason: REASON });

    const extended = new Date(built.endsAt.getTime() + 15 * MINUTE_MS).toISOString();
    assert.deepEqual(await deadlines(built), { row: extended, key: extended });
  });

  /** A lost key is what a reset is for, and an extend that finds none has nothing to move but the row. */
  it('keeps an extension that landed while a lost key was being put back', async () => {
    const built = await desk();
    await built.redis.del(redisKeys.attemptState(built.attemptId));
    const rebuilding = built.stateOn(
      afterTheRead(prisma, () =>
        built.audit.run(() => built.on().extend(built.attemptId, { minutes: 15, reason: REASON })),
      ),
    );

    await built.on(prisma, rebuilding).reset(built.attemptId, { reason: REASON });

    const extended = new Date(built.endsAt.getTime() + 15 * MINUTE_MS).toISOString();
    assert.deepEqual(await deadlines(built), { row: extended, key: extended });
  });
});

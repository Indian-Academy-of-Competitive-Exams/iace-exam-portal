import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { type Type } from '@nestjs/common';
import {
  ANSWER_STATE,
  ATTEMPT_STATUS,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  EVALUATION_MODE,
  FEATURE_KEYS,
  PERMISSION_LEVELS,
} from '@iace/contracts';
import {
  EVERY_BRANCH,
  IS_PUBLIC_KEY,
  REQUIRED_FEATURE_KEY,
  type BranchScope,
  type RequiredFeature,
} from '../src/common/security';
import { AuditContext } from '../src/audit';
import {
  AdminPerformanceShareController,
  MePerformanceShareController,
  PublicReportController,
} from '../src/attempts/performance-share.controller';
import { PerformanceShareService } from '../src/attempts/performance-share.service';
import { PerformanceAnalyticsService } from '../src/attempts/performance.service';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { newShareToken, shareExpiresAt, shareIsLive } from '../src/attempts/performance-share';
import {
  FakePerformancePrisma,
  FakeQueue,
  FakeRedis,
  FakeSharePrisma,
  makeAttempt,
  makeScoredTest,
  makeServedAnswer,
  makeShare,
  makeShareSitting,
  mcqOptions,
  type FakeAttemptRow,
  type FakePerformanceData,
  type FakeServedAnswerRow,
  type FakeShareSitting,
} from './support/fakes';

const STUDENT = 'stu_1';
const RIVAL = 'stu_2';
const ADMIN = 'adm_1';
const RIVAL_NAME = 'Nobody Else';
const ANSWER_TEXT = 'Option 1 is the right one';
const REFUSAL = 'This report is not available';

/** Exactly what a token buys. A new key here is a security decision, not a refactor. */
const PUBLIC_FIELDS = [
  'averageScore',
  'bands',
  'branchName',
  'cohortSize',
  'maxMarks',
  'percentile',
  'rank',
  'score',
  'sections',
  'studentName',
  'submittedAt',
  'testTitle',
  'topperScore',
];

const SHAPE = makeScoredTest({
  title: 'SSC CGL Tier 1 — Mock 8',
  evaluationMode: EVALUATION_MODE.RANKED,
  sections: [
    {
      id: 'sec_1',
      name: 'Reasoning',
      order: 1,
      questionCount: 3,
      marksPerQuestion: 2,
      durationSec: null,
    },
  ],
});

function served(attemptId: string): FakeServedAnswerRow[] {
  return [
    makeServedAnswer({
      attemptId,
      questionId: 'q1',
      paperQuestionId: 'pq_1',
      order: 1,
      selectedOptionId: 'o1',
      isCorrect: true,
      marksAwarded: 2,
      timeSpentSec: 40,
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
      timeSpentSec: 50,
      state: ANSWER_STATE.ANSWERED,
      options: mcqOptions(2),
    }),
    makeServedAnswer({ attemptId, questionId: 'q3', paperQuestionId: 'pq_3', marksAwarded: 0 }),
  ];
}

function sittings(crowd: number): FakeAttemptRow[] {
  const others = Array.from({ length: crowd }, (_unused, at) =>
    makeAttempt({
      id: `att_1${at}`,
      testId: 'tst_1',
      studentId: `stu_1${at}`,
      status: ATTEMPT_STATUS.EVALUATED,
      submittedAt: new Date('2026-08-29T06:00:00.000Z'),
      score: 2 + at,
    }),
  );
  return [
    makeAttempt({
      id: 'att_1',
      testId: 'tst_1',
      studentId: STUDENT,
      status: ATTEMPT_STATUS.EVALUATED,
      submittedAt: new Date('2026-08-29T06:00:00.000Z'),
      score: 1.5,
      lastRank: 58,
      lastPercentile: 82,
      sectionScores: [
        {
          baseConfigSectionId: 'sec_1',
          score: 1.5,
          correctCount: 1,
          wrongCount: 1,
          unattemptedCount: 1,
          timeSpentSec: 95,
        },
      ],
    }),
    makeAttempt({
      id: 'att_9',
      testId: 'tst_1',
      studentId: RIVAL,
      status: ATTEMPT_STATUS.EVALUATED,
      submittedAt: new Date('2026-08-29T06:00:00.000Z'),
      score: 5.5,
    }),
    ...others,
  ];
}

function bench(
  shares: ReturnType<typeof makeShare>[] = [],
  sitting: Partial<FakeShareSitting> = {},
  crowd = 0,
) {
  const attempts = sittings(crowd);
  const data: FakePerformanceData = {
    attempts,
    served: attempts.flatMap((row) => served(row.id)),
    shape: SHAPE,
    students: [
      { id: STUDENT, deletedAt: null },
      { id: RIVAL, deletedAt: null },
    ],
    series: [],
    seriesTests: [],
    testStats: [],
    sectionStats: [],
    questionStats: [],
  };
  const redis = new FakeRedis();
  const reportPrisma = new FakePerformancePrisma(data);
  const analytics = new PerformanceAnalyticsService(
    reportPrisma.asService(),
    new LeaderboardService(
      reportPrisma.asService(),
      new FakeRedis().asService(),
      new FakeQueue().asQueue(),
    ),
  );
  const sharePrisma = new FakeSharePrisma(shares, [
    makeShareSitting({ id: 'att_1', studentId: STUDENT, title: SHAPE.title, ...sitting }),
    makeShareSitting({
      id: 'att_9',
      studentId: RIVAL,
      title: SHAPE.title,
      fullName: RIVAL_NAME,
      branch: 'DILSUKHNAGAR',
    }),
  ]);
  return {
    sharePrisma,
    redis,
    service: new PerformanceShareService(
      sharePrisma.asService(),
      analytics,
      new AuditContext(),
      redis.asService(),
    ),
  };
}

type Reflected = Type<unknown> | ((...args: never[]) => unknown);

const refusedWith = (message: string) => (error: { code?: string; message?: string }) =>
  error.code === ErrorCodes.NOT_FOUND && error.message === message;

// --------------------------------------------------------------------------- the token itself
// ---------------------------------------------------------------------------

describe('the share token', () => {
  /** The failure this prevents: a cuid, which is time-ordered, so one link hands you its neighbours. */
  it('is long, random and never repeats', () => {
    const minted = new Set(Array.from({ length: 2000 }, () => newShareToken()));

    assert.equal(minted.size, 2000);
    for (const token of minted) {
      assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    }
  });
});

describe('when a link runs out', () => {
  const now = new Date('2026-09-01T06:00:00.000Z');

  it('is live until it is revoked or its expiry passes', () => {
    assert.equal(shareIsLive({ revokedAt: null, expiresAt: null }, now), true);
    assert.equal(
      shareIsLive({ revokedAt: null, expiresAt: new Date('2026-09-30T00:00:00.000Z') }, now),
      true,
    );
    assert.equal(
      shareIsLive({ revokedAt: null, expiresAt: new Date('2026-08-30T00:00:00.000Z') }, now),
      false,
    );
    assert.equal(shareIsLive({ revokedAt: now, expiresAt: null }, now), false);
  });

  it('gives an unstated expiry thirty institute days, and keeps an explicit null permanent', () => {
    const defaulted = shareExpiresAt(undefined, now);
    const permanent = shareExpiresAt(null, now);
    const chosen = shareExpiresAt('2026-09-10', now);

    // Thirty institute days on from 1 Sep, expiring at the END of 1 Oct in Kolkata.
    assert.equal(defaulted?.toISOString(), '2026-10-01T18:29:59.999Z');
    assert.equal(permanent, null);
    assert.equal(chosen?.toISOString(), '2026-09-10T18:29:59.999Z');
  });

  /** The failure this prevents: minting a link that is dead the moment it is copied. */
  it('refuses an expiry that has already gone', () => {
    assert.throws(
      () => shareExpiresAt('2026-08-20', now),
      (error: { code?: string }) => error.code === ErrorCodes.VALIDATION_ERROR,
    );
  });
});

// --------------------------------------------------------------------------- what a token buys
// ---------------------------------------------------------------------------

describe('reading a shared report', () => {
  it('serves the shared student their own curated report and nothing else', async () => {
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })]);

    const report = await service.readPublic('live-token');

    assert.deepEqual(Object.keys(report).toSorted(), PUBLIC_FIELDS);
    assert.equal(report.studentName, 'Harshith Diyyala');
    assert.equal(report.branchName, 'AMEERPET');
    assert.equal(report.testTitle, SHAPE.title);
    assert.equal(report.rank, 58);
    assert.equal(report.percentile, 82);
    assert.equal(report.sections[0]?.name, 'Reasoning');
  });

  /** The fake hands over the answer key and the rival's row; leaving both out is the code's job. */
  it('carries no answer key, no per-question row and no other student', async () => {
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })]);

    const serialised = JSON.stringify(await service.readPublic('live-token'));

    assert.equal(serialised.includes(ANSWER_TEXT), false);
    assert.equal(serialised.includes('answerKey'), false);
    assert.equal(serialised.includes('isCorrect'), false);
    assert.equal(serialised.includes(RIVAL_NAME), false);
    assert.equal(serialised.includes(RIVAL), false);
    assert.equal(serialised.includes('att_9'), false);
    assert.equal(serialised.includes('att_1'), false);
  });

  /** The cohort reaches the public payload as a distribution: bands and counts, never rows. */
  it('describes the cohort by counts alone', async () => {
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })], {}, 3);

    const report = await service.readPublic('live-token');

    assert.equal(report.cohortSize, 5);
    assert.equal(report.topperScore, 5.5);
    assert.ok(report.bands.length > 0);
    for (const band of report.bands) {
      assert.deepEqual(Object.keys(band).toSorted(), ['count', 'from', 'isYours', 'to']);
    }
  });

  /** The floor is five, not three: four sitters still narrow the topper to one of three rivals. */
  it('withholds them one sitter short of the floor, and publishes them at it', async () => {
    const short = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })], {}, 2);
    const enough = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })], {}, 3);

    const withheld = await short.service.readPublic('live-token');
    const published = await enough.service.readPublic('live-token');

    assert.equal(withheld.cohortSize, 4);
    assert.equal(withheld.topperScore, null);
    assert.equal(withheld.averageScore, null);
    assert.deepEqual(withheld.bands, []);
    assert.equal(published.cohortSize, 5);
    assert.notEqual(published.topperScore, null);
  });

  /** The failure this prevents: two sitters, so the topper IS the one other student in the room. */
  it('publishes no topper, average or curve for a cohort too small to hide in', async () => {
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })]);

    const report = await service.readPublic('live-token');

    assert.equal(report.cohortSize, 2);
    assert.equal(report.topperScore, null);
    assert.equal(report.averageScore, null);
    assert.deepEqual(report.bands, []);
    assert.equal(report.rank, 58);
  });
});

describe('what one link may cost Postgres', () => {
  /** The failure this prevents: a revoked link still served from a cache until its TTL runs out. */
  it('drops the cached report the moment the link is revoked', async () => {
    const { service } = bench([
      makeShare({ id: 'shr_1', token: 'live-token', attemptId: 'att_1' }),
    ]);

    await service.readPublic('live-token');
    await service.revoke(STUDENT, 'shr_1', EVERY_BRANCH);

    await assert.rejects(() => service.readPublic('live-token'), refusedWith(REFUSAL));
  });

  /** The failure this prevents: N readers of one pasted link, N full-cohort scans on Postgres. */
  it('serves a repeated read from Redis, and only until the short TTL runs out', async () => {
    const { service, sharePrisma, redis } = bench([
      makeShare({ token: 'live-token', attemptId: 'att_1' }),
    ]);

    const first = await service.readPublic('live-token');
    sharePrisma.shares.length = 0;
    const cached = await service.readPublic('live-token');
    redis.advanceSeconds(31);

    assert.deepEqual(cached, first);
    await assert.rejects(() => service.readPublic('live-token'), refusedWith(REFUSAL));
  });

  /** The failure this prevents: an unauthenticated route with no brake on it at all. */
  it('refuses one link that keeps missing the cache', async () => {
    const { service } = bench();

    for (let read = 0; read < 20; read += 1) {
      await assert.rejects(() => service.readPublic('never-minted'), refusedWith(REFUSAL));
    }

    await assert.rejects(
      () => service.readPublic('never-minted'),
      (error: { code?: string }) => error.code === ErrorCodes.RATE_LIMITED,
    );
  });
});

describe('refusing a link', () => {
  it('refuses a revoked token', async () => {
    const { service } = bench([
      makeShare({ token: 'dead-token', revokedAt: new Date('2026-08-31T06:00:00.000Z') }),
    ]);

    await assert.rejects(() => service.readPublic('dead-token'), refusedWith(REFUSAL));
  });

  it('refuses an expired token', async () => {
    const { service } = bench([
      makeShare({ token: 'old-token', expiresAt: new Date('2026-08-01T06:00:00.000Z') }),
    ]);

    await assert.rejects(() => service.readPublic('old-token'), refusedWith(REFUSAL));
  });

  /** The refusal must not say whether the token was ever real, so all three read the same. */
  it('refuses an unknown token in exactly the same words', async () => {
    const { service } = bench([makeShare({ token: 'live-token' })]);

    await assert.rejects(() => service.readPublic('never-minted'), refusedWith(REFUSAL));
  });

  it('refuses a link whose sitting is no longer readable', async () => {
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_404' })]);

    await assert.rejects(() => service.readPublic('live-token'), refusedWith(REFUSAL));
  });

  /** The failure this prevents: a deleted student's name and branch still served to the internet. */
  it('refuses a link whose student has been deleted', async () => {
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })], {
      studentDeletedAt: new Date('2026-08-31T06:00:00.000Z'),
    });

    await assert.rejects(() => service.readPublic('live-token'), refusedWith(REFUSAL));
  });
});

// --------------------------------------------------------------------------- minting and pulling
// ---------------------------------------------------------------------------

describe('an admin holding STUDENT_PERFORMANCE', () => {
  it('generates a link, then revokes it and closes the door', async () => {
    const { service } = bench();

    const share = await service.create(STUDENT, { attemptId: 'att_1' }, ADMIN, EVERY_BRANCH);
    const token = share.token ?? '';
    const opened = await service.readPublic(token);
    const revoked = await service.revoke(STUDENT, share.id, EVERY_BRANCH);

    assert.equal(share.isLive, true);
    assert.equal(share.testTitle, SHAPE.title);
    assert.equal(opened.studentName, 'Harshith Diyyala');
    assert.equal(revoked.isLive, false);
    assert.notEqual(revoked.revokedAt, null);
    await assert.rejects(
      () => service.readPublic(token),
      refusedWith('This report is not available'),
    );
  });

  /** The failure this prevents: a second revoke re-dating the row, moving when the door shut. */
  it('keeps the first revocation date when a second revoke lands', async () => {
    const shut = new Date('2026-08-25T06:00:00.000Z');
    const { service } = bench([makeShare({ id: 'shr_9', attemptId: 'att_1', revokedAt: shut })]);

    const again = await service.revoke(STUDENT, 'shr_9', EVERY_BRANCH);

    assert.equal(again.revokedAt, shut.toISOString());
    assert.equal(again.isLive, false);
  });

  it('cannot mint a link to a sitting that is not this student’s', async () => {
    const { service } = bench();

    await assert.rejects(
      () => service.create(STUDENT, { attemptId: 'att_9' }, ADMIN, EVERY_BRANCH),
      refusedWith('No such sitting'),
    );
  });

  it('cannot revoke a link belonging to somebody else', async () => {
    const { service } = bench();
    const share = await service.create(STUDENT, { attemptId: 'att_1' }, ADMIN, EVERY_BRANCH);

    await assert.rejects(
      () => service.revoke(RIVAL, share.id, EVERY_BRANCH),
      refusedWith('No such shared report'),
    );
  });
});

describe('an admin who holds only some branches', () => {
  const elsewhere: BranchScope = { all: false, branchIds: ['br_other'] };

  /** The failure this prevents: minting a permanent public link to a student nobody let them see. */
  it('cannot mint, revoke or list a link for a student outside them', async () => {
    const { service } = bench([
      makeShare({ id: 'shr_9', token: 'live-token', attemptId: 'att_1' }),
    ]);
    const missing = refusedWith('No such student');

    await assert.rejects(
      () => service.create(STUDENT, { attemptId: 'att_1' }, ADMIN, elsewhere),
      missing,
    );
    await assert.rejects(() => service.revoke(STUDENT, 'shr_9', elsewhere), missing);
    await assert.rejects(() => service.list(STUDENT, elsewhere, true), missing);
  });

  it('reaches a student who is in one of them', async () => {
    const { service } = bench();

    const held = await service.list(STUDENT, { all: false, branchIds: ['br_1'] }, true);

    assert.deepEqual(
      held.sittings.map((row) => row.attemptId),
      ['att_1'],
    );
  });

  /** The failure this prevents: a READ-only admin copying a working link they cannot take down. */
  it('is handed no token at READ, and the real one at WRITE', async () => {
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })]);

    const read = await service.list(STUDENT, EVERY_BRANCH, false);
    const write = await service.list(STUDENT, EVERY_BRANCH, true);

    assert.equal(read.shares[0]?.token, null);
    assert.equal(write.shares[0]?.token, 'live-token');
  });
});

describe('the student', () => {
  it('lists their own links and the sittings a new one could open', async () => {
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })]);

    const held = await service.list(STUDENT, EVERY_BRANCH, true);

    assert.equal(held.shares.length, 1);
    assert.equal(held.shares[0]?.attemptId, 'att_1');
    assert.deepEqual(
      held.sittings.map((row) => row.attemptId),
      ['att_1'],
    );
  });
});

// --------------------------------------------------------------------------- who may knock
// ---------------------------------------------------------------------------

describe('the public opt-out', () => {
  const reflector = new Reflector();
  const isPublic = (handler: Reflected, target: Reflected) =>
    reflector.getAllAndOverride<boolean | undefined, string>(IS_PUBLIC_KEY, [handler, target]) ===
    true;

  /** The one route that must be reachable without a token. */
  it('opens the token read', () => {
    assert.equal(isPublic(PublicReportController.prototype.read, PublicReportController), true);
  });

  /** The failure this prevents: @Public() spreading from the read to something that writes. */
  it('leaves minting and revoking behind the guard, on both portals', () => {
    const guarded = [
      [MePerformanceShareController.prototype.list, MePerformanceShareController],
      [MePerformanceShareController.prototype.create, MePerformanceShareController],
      [MePerformanceShareController.prototype.revoke, MePerformanceShareController],
      [AdminPerformanceShareController.prototype.list, AdminPerformanceShareController],
      [AdminPerformanceShareController.prototype.create, AdminPerformanceShareController],
      [AdminPerformanceShareController.prototype.revoke, AdminPerformanceShareController],
    ] as const;

    for (const [handler, target] of guarded) {
      assert.equal(isPublic(handler, target), false);
    }
  });

  const demanded = (handler: Reflected) =>
    reflector.getAllAndOverride<RequiredFeature | undefined, string>(REQUIRED_FEATURE_KEY, [
      handler,
      AdminPerformanceShareController,
    ]);

  /** The failure this prevents: an admin route that any signed-in admin can reach for free. */
  it('charges every admin route STUDENT_PERFORMANCE, at the level the act deserves', () => {
    const priced = [
      [AdminPerformanceShareController.prototype.list, PERMISSION_LEVELS.READ],
      [AdminPerformanceShareController.prototype.create, PERMISSION_LEVELS.WRITE],
      [AdminPerformanceShareController.prototype.revoke, PERMISSION_LEVELS.WRITE],
    ] as const;

    for (const [handler, level] of priced) {
      assert.deepEqual(demanded(handler), { key: FEATURE_KEYS.STUDENT_PERFORMANCE, level });
    }
  });
});

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
  PERFORMANCE_SHARE_DEFAULT_DAYS,
  sharedReportSchema,
} from '@iace/contracts';
import { IS_PUBLIC_KEY } from '../src/common/security';
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
} from './support/fakes';

const STUDENT = 'stu_1';
const RIVAL = 'stu_2';
const ADMIN = 'adm_1';
const RIVAL_NAME = 'Nobody Else';
const ANSWER_TEXT = 'Option 1 is the right one';

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

function sittings(): FakeAttemptRow[] {
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
  ];
}

function bench(shares: ReturnType<typeof makeShare>[] = []) {
  const attempts = sittings();
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
    makeShareSitting({ id: 'att_1', studentId: STUDENT, title: SHAPE.title }),
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
    service: new PerformanceShareService(sharePrisma.asService(), analytics),
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
    assert.equal(PERFORMANCE_SHARE_DEFAULT_DAYS, 30);
    assert.equal(permanent, null);
    assert.equal(chosen?.toISOString(), '2026-09-10T18:29:59.999Z');
  });
});

// --------------------------------------------------------------------------- what a token buys
// ---------------------------------------------------------------------------

describe('reading a shared report', () => {
  it('serves the shared student their own curated report and nothing else', async () => {
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })]);

    const report = await service.readPublic('live-token');

    assert.equal(sharedReportSchema.safeParse(report).success, true);
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
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })]);

    const report = await service.readPublic('live-token');

    assert.equal(report.cohortSize, 2);
    assert.equal(report.topperScore, 5.5);
    assert.ok(report.bands.length > 0);
    for (const band of report.bands) {
      assert.deepEqual(Object.keys(band).toSorted(), ['count', 'from', 'isYours', 'to']);
    }
  });
});

describe('refusing a link', () => {
  const REFUSAL = 'This report is not available';

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
});

// --------------------------------------------------------------------------- minting and pulling
// ---------------------------------------------------------------------------

describe('an admin holding STUDENT_PERFORMANCE', () => {
  it('generates a link, then revokes it and closes the door', async () => {
    const { service } = bench();

    const share = await service.create(STUDENT, { attemptId: 'att_1' }, ADMIN);
    const opened = await service.readPublic(share.token);
    const revoked = await service.revoke(STUDENT, share.id);

    assert.equal(share.isLive, true);
    assert.equal(share.testTitle, SHAPE.title);
    assert.equal(opened.studentName, 'Harshith Diyyala');
    assert.equal(revoked.isLive, false);
    assert.notEqual(revoked.revokedAt, null);
    await assert.rejects(
      () => service.readPublic(share.token),
      refusedWith('This report is not available'),
    );
  });

  /** Revoking twice keeps the first date: when the door shut is a fact, not a click count. */
  it('revokes idempotently', async () => {
    const { service } = bench();
    const share = await service.create(STUDENT, { attemptId: 'att_1' }, ADMIN);

    const first = await service.revoke(STUDENT, share.id);
    const second = await service.revoke(STUDENT, share.id);

    assert.equal(second.revokedAt, first.revokedAt);
  });

  it('cannot mint a link to a sitting that is not this student’s', async () => {
    const { service } = bench();

    await assert.rejects(
      () => service.create(STUDENT, { attemptId: 'att_9' }, ADMIN),
      refusedWith('No such sitting'),
    );
  });

  it('cannot revoke a link belonging to somebody else', async () => {
    const { service } = bench();
    const share = await service.create(STUDENT, { attemptId: 'att_1' }, ADMIN);

    await assert.rejects(
      () => service.revoke(RIVAL, share.id),
      refusedWith('No such shared report'),
    );
  });
});

describe('the student', () => {
  it('lists their own links and the sittings a new one could open', async () => {
    const { service } = bench([makeShare({ token: 'live-token', attemptId: 'att_1' })]);

    const held = await service.list(STUDENT);

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
});

import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ATTEMPT_STATUS, ErrorCodes, PERFORMANCE_SCOPES } from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { PerformanceShareService } from '../src/attempts/performance-share.service';
import { PerformanceAnalyticsService } from '../src/attempts/performance.service';
import { RollupOutbox } from '../src/attempts/rollup-outbox';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { FakeEventBus, FakeQueue, FakeRedis, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makeAdmin,
  makeBranch,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  type Paper,
  type SitInput,
} from './support/database';

const TITLE = 'SSC CGL Tier 1 — Mock 8';
const OUR_NAME = 'Harshith Diyyala';
const OUR_BRANCH = 'AMEERPET';
const RIVAL_NAME = 'Nobody Else';
const REFUSAL = 'This report is not available';
const WRONG = 'o3';

/** What the crowd chose, in turn: 2, 3.5 and 4 marks, every one of them above the shared 1.5. */
const CROWD_CHOICES = [
  [RIGHT_OPTION, null, null],
  [RIGHT_OPTION, RIGHT_OPTION, WRONG],
  [RIGHT_OPTION, RIGHT_OPTION, null],
] as const;

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const processor = new ScoringProcessor(
  prisma,
  new RollupOutbox(new FakeQueue().asQueue()),
  new FakeEventBus().asService(),
  new NotificationOutbox(new FakeQueue().asQueue()),
  fakeQueueFailures(),
);

const analytics = new PerformanceAnalyticsService(prisma, new LeaderboardService(prisma));

async function sit(paper: Paper, studentId: string, chosen: SitInput['chosen']) {
  const attempt = await sitPaper(prisma, { paper, studentId, chosen });
  await processor.score(attempt.id);
  return attempt.id;
}

/** Ours scored lowest, so it sits last in a cohort of the rival, the crowd and itself. */
async function bench(crowd = 0) {
  const paper = await makePaper(prisma, {
    title: TITLE,
    sections: ['Reasoning'],
    questions: ['Reasoning', 'Reasoning', 'Reasoning'],
  });
  const ours = await makeBranch(prisma, OUR_BRANCH);
  const theirs = await makeBranch(prisma, 'DILSUKHNAGAR');
  const student = (await makeStudent(prisma, { fullName: OUR_NAME, currentBranchId: ours.id })).id;
  const rival = (await makeStudent(prisma, { fullName: RIVAL_NAME, currentBranchId: theirs.id }))
    .id;

  const attempt = await sit(paper, student, [RIGHT_OPTION, WRONG, null]);
  const rivalAttempt = await sit(paper, rival, [RIGHT_OPTION, RIGHT_OPTION, RIGHT_OPTION]);
  const others: string[] = [];
  for (let at = 0; at < crowd; at += 1) {
    const other = (await makeStudent(prisma)).id;
    others.push(other, await sit(paper, other, CROWD_CHOICES[at % CROWD_CHOICES.length] ?? []));
  }

  const redis = new FakeRedis();
  const service = new PerformanceShareService(
    prisma,
    analytics,
    new AuditContext(),
    redis.asService(),
  );
  return { paper, student, rival, attempt, rivalAttempt, others, redis, service };
}

const share = (
  attemptId: string,
  over: { token?: string; revokedAt?: Date; expiresAt?: Date } = {},
) =>
  prisma.performanceShare.create({
    data: { token: over.token ?? 'live-token', attemptId, ...over },
    select: { id: true },
  });

const refusedWith = (message: string) => (error: { code?: string; message?: string }) =>
  error.code === ErrorCodes.NOT_FOUND && error.message === message;

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

describe('reading a shared report', () => {
  it('serves the shared student their own curated report and nothing else', async () => {
    const { service, attempt } = await bench();
    await share(attempt);

    const report = await service.readPublic('live-token');

    assert.deepEqual(Object.keys(report).toSorted(), PUBLIC_FIELDS);
    assert.equal(report.studentName, OUR_NAME);
    assert.equal(report.branchName, OUR_BRANCH);
    assert.equal(report.testTitle, TITLE);
    assert.equal(report.rank, 2);
    assert.equal(report.percentile, 25);
    assert.equal(report.sections[0]?.name, 'Reasoning');
  });

  /** The cohort reaches the public payload as a distribution: bands and counts, never rows. */
  it('describes the cohort by counts alone', async () => {
    const { service, attempt } = await bench(3);
    await share(attempt);

    const report = await service.readPublic('live-token');

    assert.equal(report.cohortSize, 5);
    assert.equal(report.topperScore, 6);
    assert.ok(report.bands.length > 0);
    for (const band of report.bands) {
      assert.deepEqual(Object.keys(band).toSorted(), ['count', 'from', 'isYours', 'to']);
    }
  });

  /** The floor is five, not three: four sitters still narrow the topper to one of three rivals. */
  it('withholds them one sitter short of the floor, and publishes them at it', async () => {
    const short = await bench(2);
    await share(short.attempt);
    const withheld = await short.service.readPublic('live-token');
    assert.equal(withheld.cohortSize, 4);
    assert.equal(withheld.topperScore, null);
    assert.equal(withheld.averageScore, null);
    assert.deepEqual(withheld.bands, []);

    await resetDatabase(prisma);
    const enough = await bench(3);
    await share(enough.attempt);
    const published = await enough.service.readPublic('live-token');
    assert.equal(published.cohortSize, 5);
    assert.notEqual(published.topperScore, null);
  });

  /** The failure this prevents: two sitters, so the topper IS the one other student in the room. */
  it('publishes no topper, average or curve for a cohort too small to hide in', async () => {
    const { service, attempt } = await bench();
    await share(attempt);

    const report = await service.readPublic('live-token');

    assert.equal(report.cohortSize, 2);
    assert.equal(report.topperScore, null);
    assert.equal(report.averageScore, null);
    assert.deepEqual(report.bands, []);
    assert.equal(report.rank, 2);
  });
});

describe('the link and the signed-in report, over one cohort', () => {
  const signedIn = (student: string, attemptId: string) =>
    analytics.report(student, { scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId });

  /** The two must agree, or the link is publishing a second truth. */
  it('publishes the same standing through the link as the signed-in report shows', async () => {
    const { service, student, attempt } = await bench(4);
    const report = await signedIn(student, attempt);

    const link = await service.create(student, { attemptId: attempt }, null);
    const opened = await service.readPublic(link.token ?? '');

    assert.equal(opened.score, report.composition.net);
    assert.equal(opened.maxMarks, report.composition.maxMarks);
    assert.equal(opened.rank, report.cohort?.rank);
    assert.equal(opened.percentile, report.cohort?.percentile);
    assert.equal(opened.cohortSize, report.cohort?.cohortSize);
    assert.equal(opened.topperScore, report.cohort?.topperScore);
    assert.deepEqual(opened.bands, report.cohort?.bands);
  });

  /** The one guarantee both payloads exist to keep, asserted where they meet. */
  it('carries no answer key and no other student on either payload', async () => {
    const { service, student, attempt, rival, rivalAttempt, others } = await bench(4);
    const link = await service.create(student, { attemptId: attempt }, null);

    const payloads = [
      JSON.stringify(await signedIn(student, attempt)),
      JSON.stringify(await service.readPublic(link.token ?? '')),
    ];

    for (const payload of payloads) {
      assert.equal(payload.includes('answerKey'), false);
      assert.equal(payload.includes('isCorrect'), false);
      assert.equal(payload.includes('Option 1'), false);
      assert.equal(payload.includes(RIVAL_NAME), false);
      for (const other of [rival, rivalAttempt, ...others]) {
        assert.equal(payload.includes(other), false);
      }
    }
  });
});

describe('what one link may cost Postgres', () => {
  /** The failure this prevents: a revoked link still served from a cache until its TTL runs out. */
  it('drops the cached report the moment the link is revoked', async () => {
    const { service, student, attempt } = await bench();
    const link = await share(attempt);

    await service.readPublic('live-token');
    await service.revoke(student, link.id);

    await assert.rejects(() => service.readPublic('live-token'), refusedWith(REFUSAL));
  });

  /** The failure this prevents: N readers of one pasted link, N full-cohort scans on Postgres. */
  it('serves a repeated read from Redis, and only until the short TTL runs out', async () => {
    const { service, redis, attempt } = await bench();
    await share(attempt);

    const first = await service.readPublic('live-token');
    await prisma.performanceShare.deleteMany();
    const cached = await service.readPublic('live-token');
    redis.advanceSeconds(31);

    assert.deepEqual(cached, first);
    await assert.rejects(() => service.readPublic('live-token'), refusedWith(REFUSAL));
  });

  /** The failure this prevents: an unauthenticated route with no brake on it at all. */
  it('refuses one link that keeps missing the cache', async () => {
    const { service } = await bench();

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
    const { service, attempt } = await bench();
    await share(attempt, { token: 'dead-token', revokedAt: new Date('2026-08-31T06:00:00.000Z') });

    await assert.rejects(() => service.readPublic('dead-token'), refusedWith(REFUSAL));
  });

  it('refuses an expired token', async () => {
    const { service, attempt } = await bench();
    await share(attempt, { token: 'old-token', expiresAt: new Date('2026-08-01T06:00:00.000Z') });

    await assert.rejects(() => service.readPublic('old-token'), refusedWith(REFUSAL));
  });

  /** The refusal must not say whether the token was ever real, so all three read the same. */
  it('refuses an unknown token in exactly the same words', async () => {
    const { service, attempt } = await bench();
    await share(attempt);

    await assert.rejects(() => service.readPublic('never-minted'), refusedWith(REFUSAL));
  });

  it('refuses a link whose sitting is not a marked one', async () => {
    const { service, paper, student } = await bench();
    const unmarked = await sitPaper(prisma, {
      paper,
      studentId: student,
      chosen: [RIGHT_OPTION, null, null],
      attemptNo: 2,
      isGraded: false,
      status: ATTEMPT_STATUS.SUBMITTED,
    });
    await share(unmarked.id);

    await assert.rejects(() => service.readPublic('live-token'), refusedWith(REFUSAL));
  });

  /** The failure this prevents: a deleted student's name and branch still served to the internet. */
  it('refuses a link whose student has been deleted', async () => {
    const { service, student, attempt } = await bench();
    await share(attempt);
    await prisma.student.update({
      where: { id: student },
      data: { deletedAt: new Date('2026-08-31T06:00:00.000Z') },
    });

    await assert.rejects(() => service.readPublic('live-token'), refusedWith(REFUSAL));
  });
});

describe('an admin holding STUDENT_PERFORMANCE', () => {
  it('generates a link, then revokes it and closes the door', async () => {
    const { service, student, attempt } = await bench();
    const admin = await makeAdmin(prisma);

    const link = await service.create(student, { attemptId: attempt }, admin.id);
    const token = link.token ?? '';
    const opened = await service.readPublic(token);
    const revoked = await service.revoke(student, link.id);

    assert.equal(link.isLive, true);
    assert.equal(link.testTitle, TITLE);
    assert.equal(opened.studentName, OUR_NAME);
    assert.equal(revoked.isLive, false);
    assert.notEqual(revoked.revokedAt, null);
    await assert.rejects(() => service.readPublic(token), refusedWith(REFUSAL));
  });

  /** The failure this prevents: a second revoke re-dating the row, moving when the door shut. */
  it('keeps the first revocation date when a second revoke lands', async () => {
    const shut = new Date('2026-08-25T06:00:00.000Z');
    const { service, student, attempt } = await bench();
    const link = await share(attempt, { revokedAt: shut });

    const again = await service.revoke(student, link.id);

    assert.equal(again.revokedAt, shut.toISOString());
    assert.equal(again.isLive, false);
  });

  it('cannot mint a link to a sitting that is not this student’s', async () => {
    const { service, student, rivalAttempt } = await bench();
    const admin = await makeAdmin(prisma);

    await assert.rejects(
      () => service.create(student, { attemptId: rivalAttempt }, admin.id),
      refusedWith('No such sitting'),
    );
  });

  it('cannot revoke a link belonging to somebody else', async () => {
    const { service, student, rival, attempt } = await bench();
    const link = await service.create(student, { attemptId: attempt }, null);

    await assert.rejects(
      () => service.revoke(rival, link.id),
      refusedWith('No such shared report'),
    );
  });

  /** The failure this prevents: a READ-only admin copying a working link they cannot take down. */
  it('is handed no token at READ, and the real one at WRITE', async () => {
    const { service, student, attempt } = await bench();
    await share(attempt);

    const read = await service.list(student, false);
    const write = await service.list(student, true);

    assert.equal(read.shares[0]?.token, null);
    assert.equal(write.shares[0]?.token, 'live-token');
  });
});

describe('the student', () => {
  it('lists their own links and the sittings a new one could open', async () => {
    const { service, student, attempt } = await bench();
    await share(attempt);

    const held = await service.list(student, true);

    assert.equal(held.shares.length, 1);
    assert.equal(held.shares[0]?.attemptId, attempt);
    assert.deepEqual(
      held.sittings.map((row) => row.attemptId),
      [attempt],
    );
  });
});

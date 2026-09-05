/**
 * Phase 4.5, end to end: one cohort sits one paper, the worker marks it, the report reads off
 * what the worker wrote, a link publishes that report to the open internet, and revoking it shuts
 * the door. Scoring, the board, the report and the share all meet over one set of rows and one
 * Redis, so a leak or a drift between them shows up here rather than in production.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ANSWER_STATE, ATTEMPT_STATUS, ErrorCodes, PERFORMANCE_SCOPES } from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { PerformanceAnalyticsService } from '../src/attempts/performance.service';
import { PerformanceShareService } from '../src/attempts/performance-share.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { redisKeys } from '../src/redis/redis.keys';
import {
  FakeEventBus,
  FakePerformancePrisma,
  FakeQueue,
  fakeRollupOutbox,
  FakeRedis,
  FakeScoringPrisma,
  FakeSharePrisma,
  makeAttempt,
  makeScoredTest,
  makeServedAnswer,
  makeShareSitting,
  mcqOptions,
  type FakeAttemptRow,
  type FakeServedAnswerRow,
} from './support/fakes';

const TEST_ID = 'tst_1';
const OURS = 'att_1';
const OUR_STUDENT = 'stu_1';
const OUR_NAME = 'Harshith Diyyala';
const OUR_BRANCH = 'AMEERPET';
const RIVAL_NAME = 'Nobody Else';
const ANSWER_TEXT = 'The second option is the right one';
const REFUSAL = 'This report is not available';

const STARTED = new Date('2026-08-29T04:00:00.000Z');
const RIGHT = 'o2';
const WRONG = 'o1';

/** Two marks a question, half a mark off for a wrong one, over two named sections. */
const SHAPE = makeScoredTest({
  title: 'SSC CGL Tier 1 — Mock 8',
  totalQuestions: 4,
  totalMarks: 8,
  sections: [
    {
      id: 'sec_1',
      name: 'Reasoning',
      order: 1,
      questionCount: 2,
      marksPerQuestion: 2,
      durationSec: null,
    },
    {
      id: 'sec_2',
      name: 'Quantitative Aptitude',
      order: 2,
      questionCount: 2,
      marksPerQuestion: 2,
      durationSec: null,
    },
  ],
});

/** Six sitters, so the cohort clears the floor a public link needs to hide anybody in. */
const COHORT: Readonly<Record<string, readonly (string | null)[]>> = {
  att_1: [RIGHT, WRONG, RIGHT, null],
  att_2: [RIGHT, RIGHT, RIGHT, RIGHT],
  att_3: [RIGHT, RIGHT, RIGHT, null],
  att_4: [RIGHT, RIGHT, null, null],
  att_5: [RIGHT, null, null, null],
  att_6: [RIGHT, WRONG, WRONG, WRONG],
};

/** What the paper pays each of them, so the board and the curve have something to say. */
const MARKS: Readonly<Record<string, number>> = {
  att_1: 3.5,
  att_2: 8,
  att_3: 6,
  att_4: 4,
  att_5: 2,
  att_6: 0.5,
};

const MINUTES: Readonly<Record<string, number>> = {
  att_1: 30,
  att_2: 25,
  att_3: 28,
  att_4: 32,
  att_5: 20,
  att_6: 35,
};

const attemptIds = Object.keys(COHORT);
const studentOf = (attemptId: string) => attemptId.replace('att_', 'stu_');

function sitting(attemptId: string): FakeAttemptRow {
  return makeAttempt({
    id: attemptId,
    testId: TEST_ID,
    studentId: studentOf(attemptId),
    status: ATTEMPT_STATUS.SUBMITTED,
    startedAt: STARTED,
    submittedAt: new Date(STARTED.getTime() + (MINUTES[attemptId] ?? 0) * 60_000),
    score: null,
  });
}

/** The fake hands the key and the options over on every row; leaving them out is the code's job. */
function served(attemptId: string): FakeServedAnswerRow[] {
  return (COHORT[attemptId] ?? []).map((selectedOptionId, seat) =>
    makeServedAnswer({
      attemptId,
      questionId: `q${seat + 1}`,
      paperQuestionId: `pq_${seat + 1}`,
      baseConfigSectionId: seat < 2 ? 'sec_1' : 'sec_2',
      subjectId: seat < 2 ? 'sub_1' : 'sub_2',
      subjectName: seat < 2 ? 'Reasoning' : 'Quantitative Aptitude',
      order: seat + 1,
      options: mcqOptions(2),
      answerKey: { mode: 'EXACT', answers: { en: ANSWER_TEXT } },
      selectedOptionId,
      state: selectedOptionId === null ? ANSWER_STATE.NOT_VISITED : ANSWER_STATE.ANSWERED,
      timeSpentSec: 45,
    }),
  );
}

function platform() {
  const attempts = attemptIds.map(sitting);
  const rows = attemptIds.flatMap(served);
  const redis = new FakeRedis();
  const scoringPrisma = new FakeScoringPrisma(attempts, rows, SHAPE);
  const leaderboard = new LeaderboardService(
    scoringPrisma.asService(),
    redis.asService(),
    new FakeQueue().asQueue(),
  );
  const reportPrisma = new FakePerformancePrisma({
    attempts,
    served: rows,
    shape: SHAPE,
    students: attemptIds.map((id) => ({
      id: studentOf(id),
      deletedAt: null,
      currentBranchId: 'br_1',
    })),
    series: [],
    tests: [],
    testStats: [],
    sectionStats: [],
    questionStats: [],
  });
  const analytics = new PerformanceAnalyticsService(reportPrisma.asService(), leaderboard);
  const sharePrisma = new FakeSharePrisma(
    [],
    attemptIds.map((id) =>
      makeShareSitting({
        id,
        studentId: studentOf(id),
        title: SHAPE.title,
        submittedAt: new Date(STARTED.getTime() + (MINUTES[id] ?? 0) * 60_000),
        fullName: id === OURS ? OUR_NAME : RIVAL_NAME,
        branch: id === OURS ? OUR_BRANCH : 'DILSUKHNAGAR',
      }),
    ),
  );

  return {
    attempts,
    redis,
    analytics,
    scoring: new ScoringProcessor(
      scoringPrisma.asService(),
      leaderboard,
      fakeRollupOutbox(scoringPrisma, new FakeQueue()),
      new FakeEventBus().asService(),
    ),
    shares: new PerformanceShareService(
      sharePrisma.asService(),
      analytics,
      new AuditContext(),
      redis.asService(),
    ),
  };
}

/** What the relay and the worker do between them, with the queue taken out of the middle. */
async function scoreEveryone(scoring: ScoringProcessor): Promise<void> {
  for (const attemptId of attemptIds) await scoring.score(attemptId);
}

const ourReport = (analytics: PerformanceAnalyticsService) =>
  analytics.report(OUR_STUDENT, { scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId: OURS });

const refused = (error: { code?: string; message?: string }) =>
  error.code === ErrorCodes.NOT_FOUND && error.message === REFUSAL;

describe('a cohort, scored and reported and published', () => {
  it('marks every sitting off the key and puts the whole cohort on one board', async () => {
    const { scoring, redis, attempts } = platform();

    await scoreEveryone(scoring);

    assert.deepEqual(
      attempts.map((row) => [row.id, row.score]),
      attemptIds.map((id) => [id, MARKS[id]]),
    );
    assert.ok(attempts.every((row) => row.status === ATTEMPT_STATUS.EVALUATED));
    assert.deepEqual(redis.descending(redisKeys.testLeaderboard(TEST_ID)), [
      'att_2',
      'att_3',
      'att_4',
      'att_1',
      'att_5',
      'att_6',
    ]);
  });

  it('reads one student’s report off the rows the worker wrote and the board it built', async () => {
    const { scoring, analytics } = platform();
    await scoreEveryone(scoring);

    const report = await ourReport(analytics);

    assert.equal(report.composition.net, MARKS[OURS]);
    assert.equal(report.composition.maxMarks, 8);
    assert.equal(report.cohort?.rank, 4);
    assert.equal(report.cohort?.cohortSize, 6);
    assert.equal(report.cohort?.topperScore, 8);
    assert.equal(report.cohort?.averageScore, 4);
    assert.deepEqual(
      report.sections.map((section) => section.name),
      ['Reasoning', 'Quantitative Aptitude'],
    );
  });

  it('mints a link, serves it with no token of any kind, then revokes it and refuses it', async () => {
    const { scoring, shares } = platform();
    await scoreEveryone(scoring);

    const link = await shares.create(OUR_STUDENT, { attemptId: OURS }, null);
    const opened = await shares.readPublic(link.token ?? '');
    const pulled = await shares.revoke(OUR_STUDENT, link.id);

    assert.equal(link.isLive, true);
    assert.equal(opened.studentName, OUR_NAME);
    assert.equal(opened.branchName, OUR_BRANCH);
    assert.equal(opened.testTitle, SHAPE.title);
    assert.equal(pulled.isLive, false);
    await assert.rejects(() => shares.readPublic(link.token ?? ''), refused);
  });

  /** The signed-in report and the public one must agree, or the link is publishing a second truth. */
  it('publishes the same standing through the link as the signed-in report shows', async () => {
    const { scoring, analytics, shares } = platform();
    await scoreEveryone(scoring);
    const report = await ourReport(analytics);

    const link = await shares.create(OUR_STUDENT, { attemptId: OURS }, null);
    const opened = await shares.readPublic(link.token ?? '');

    assert.equal(opened.score, report.composition.net);
    assert.equal(opened.maxMarks, report.composition.maxMarks);
    assert.equal(opened.rank, report.cohort?.rank);
    assert.equal(opened.percentile, report.cohort?.percentile);
    assert.equal(opened.cohortSize, report.cohort?.cohortSize);
    assert.equal(opened.topperScore, report.cohort?.topperScore);
    assert.deepEqual(opened.bands, report.cohort?.bands);
  });

  /** The one guarantee the whole run exists to keep, asserted where the two payloads meet. */
  it('carries no answer key and no other student on either payload', async () => {
    const { scoring, analytics, shares } = platform();
    await scoreEveryone(scoring);

    const link = await shares.create(OUR_STUDENT, { attemptId: OURS }, null);
    const payloads = [
      JSON.stringify(await ourReport(analytics)),
      JSON.stringify(await shares.readPublic(link.token ?? '')),
    ];

    for (const payload of payloads) {
      assert.equal(payload.includes(ANSWER_TEXT), false);
      assert.equal(payload.includes('answerKey'), false);
      assert.equal(payload.includes('Option 2'), false);
      assert.equal(payload.includes(RIVAL_NAME), false);
      for (const other of attemptIds.filter((id) => id !== OURS)) {
        assert.equal(payload.includes(other), false);
        assert.equal(payload.includes(studentOf(other)), false);
      }
    }
  });
});

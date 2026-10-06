import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ATTEMPT_STATUS, ErrorCodes, fieldEffortSchema, type AppException } from '@iace/contracts';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { PerformanceAnalyticsService } from '../src/attempts/performance.service';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FakeMetrics, FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  type Paper,
  type SitInput,
} from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const rollup = new RollupService(prisma);
const processor = new ScoringProcessor(
  prisma,
  new RollupQueue(new FakeQueue().asQueue()),
  new NotificationsService(prisma),
  fakeQueueFailures(),
  new PaperSheetService(prisma),
  rollup,
  new FakeMetrics().asService(),
);

/** A fresh service each read, so no test answers from a field another one held. */
const analytics = () => new PerformanceAnalyticsService(prisma, new LeaderboardService(prisma));

/** Two sections of two questions, every one keyed to `RIGHT_OPTION`. */
const paper = () =>
  makePaper(prisma, {
    sections: ['Section A', 'Section B'],
    questions: [
      'Reasoning',
      'Reasoning',
      { subject: 'Reasoning', section: 1 },
      { subject: 'Reasoning', section: 1 },
    ],
  });

type Sat = Pick<SitInput, 'chosen' | 'timeSpent'> & Partial<SitInput> & { marked?: boolean };

async function sat(onPaper: Paper, input: Sat) {
  const { marked = true, studentId, ...sitting } = input;
  const owner = studentId ?? (await makeStudent(prisma)).id;
  const attempt = await sitPaper(prisma, { paper: onPaper, studentId: owner, ...sitting });
  if (marked) await processor.score(attempt.id);
  return { studentId: owner, attemptId: attempt.id };
}

const ALL_RIGHT = [RIGHT_OPTION, RIGHT_OPTION, RIGHT_OPTION, RIGHT_OPTION];
const ONE_RIGHT = [RIGHT_OPTION, null, null, null];

/** The topper answers all four; the other answers one. Counted into the rollup like a sweep would. */
async function cohortOfTwo(onPaper: Paper) {
  const topper = await sat(onPaper, { chosen: ALL_RIGHT, timeSpent: [10, 20, 30, 40] });
  const other = await sat(onPaper, { chosen: ONE_RIGHT, timeSpent: [50, 10, 0, 20] });
  await rollup.recountTest(onPaper.testId);
  return { topper, other };
}

const refusedWith = (code: string) => (error: AppException) => error.code === code;

describe('the field beside a handed-in paper', () => {
  it('answers an unmarked sitting with the cohort average and the topper, in effort alone', async () => {
    const onPaper = await paper();
    await cohortOfTwo(onPaper);
    const mine = await sat(onPaper, { chosen: ONE_RIGHT, timeSpent: [5, 5, 5, 5], marked: false });

    const field = await analytics().fieldEffort(mine.studentId, mine.attemptId);
    const [a = '', b = ''] = onPaper.sectionIds;
    const bySection = (x: { baseConfigSectionId: string }, y: { baseConfigSectionId: string }) =>
      x.baseConfigSectionId.localeCompare(y.baseConfigSectionId);

    // The raw answer, whole: a parse would strip a mark that had leaked into it.
    assert.deepEqual(
      { ...field, average: [...field.average].sort(bySection) },
      {
        testId: onPaper.testId,
        attemptNo: 1,
        cohortSize: 2,
        average: [
          { baseConfigSectionId: a, attempted: 1.5, timeSpentSec: 45 },
          { baseConfigSectionId: b, attempted: 1, timeSpentSec: 45 },
        ].sort(bySection),
        topper: [
          { baseConfigSectionId: a, attempted: 2, timeSpentSec: 30 },
          { baseConfigSectionId: b, attempted: 2, timeSpentSec: 70 },
        ],
        previous: null,
      },
    );
    assert.doesNotThrow(() => fieldEffortSchema.parse(field));
  });

  /** The failure this prevents: a first sitter shown a field of nobody, or a rank-one of themselves. */
  it('has no field to show while nobody is ranked', async () => {
    const onPaper = await paper();
    const mine = await sat(onPaper, { chosen: ALL_RIGHT, timeSpent: [5, 5, 5, 5], marked: false });

    const field = await analytics().fieldEffort(mine.studentId, mine.attemptId);

    assert.deepEqual(
      { size: field.cohortSize, average: field.average, topper: field.topper },
      { size: 0, average: [], topper: null },
    );
  });

  /** Equal bars beside "Topper" would tell a student their rank on a page that carries no marks. */
  it('never draws a student beside themselves as the topper, whoever read the held field first', async () => {
    const onPaper = await paper();
    const { topper, other } = await cohortOfTwo(onPaper);
    const retake = await sat(onPaper, {
      studentId: topper.studentId,
      chosen: ONE_RIGHT,
      timeSpent: [5, 5, 5, 5],
      attemptNo: 2,
      isGraded: false,
      marked: false,
    });
    // One service, so every read after the first answers from the field it is holding.
    const held = analytics();

    const theirs = await held.fieldEffort(topper.studentId, topper.attemptId);
    const others = await held.fieldEffort(other.studentId, other.attemptId);
    const again = await held.fieldEffort(topper.studentId, topper.attemptId);
    const retaken = await held.fieldEffort(retake.studentId, retake.attemptId);

    assert.equal(theirs.topper, null);
    assert.equal(theirs.cohortSize, 2);
    assert.notEqual(others.topper, null);
    assert.equal(again.topper, null);
    assert.equal(retaken.topper, null);
    assert.notEqual(retaken.previous, null);
  });

  it('lays a retake beside the last marked sitting of the same paper', async () => {
    const onPaper = await paper();
    const first = await sat(onPaper, { chosen: ONE_RIGHT, timeSpent: [50, 10, 0, 20] });
    const again = await sat(onPaper, {
      studentId: first.studentId,
      chosen: ALL_RIGHT,
      timeSpent: [5, 5, 5, 5],
      attemptNo: 2,
      isGraded: false,
      marked: false,
    });

    const field = await analytics().fieldEffort(again.studentId, again.attemptId);
    const [a = '', b = ''] = onPaper.sectionIds;

    assert.equal(field.attemptNo, 2);
    assert.deepEqual(field.previous, [
      { baseConfigSectionId: a, attempted: 1, timeSpentSec: 60 },
      { baseConfigSectionId: b, attempted: 0, timeSpentSec: 20 },
    ]);
  });

  it('refuses a sitting that is somebody else’s, and one still being sat', async () => {
    const onPaper = await paper();
    const mine = await sat(onPaper, { chosen: ONE_RIGHT, timeSpent: [5, 5, 5, 5], marked: false });
    const stranger = await makeStudent(prisma);
    const sitting = await sat(onPaper, {
      chosen: ONE_RIGHT,
      timeSpent: [5, 5, 5, 5],
      status: ATTEMPT_STATUS.IN_PROGRESS,
      submittedAt: null,
      marked: false,
    });

    await assert.rejects(
      analytics().fieldEffort(stranger.id, mine.attemptId),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
    await assert.rejects(
      analytics().fieldEffort(sitting.studentId, sitting.attemptId),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});

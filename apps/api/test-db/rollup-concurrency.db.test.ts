/**
 * The rollup's writers, driven so they overlap. The rest of the tier runs one thing at a time,
 * which is why a lock-order inversion between two of them hides from it.
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { type PrismaService } from '../src/prisma/prisma.service';
import { FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makePaper,
  makeStudent,
  resetDatabase,
  sitPaper,
  testPrisma,
  type Paper,
} from './support/database';

const WRONG = 'o2';
const SUBJECTS = ['Reasoning', 'Reasoning', 'Maths', 'Maths'];

/** Long enough for the other transaction to take the row it opens with. */
const OVERLAP_MS = 300;

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const scorer = new ScoringProcessor(
  prisma,
  new RollupQueue(new FakeQueue().asQueue()),
  new NotificationOutbox(new FakeQueue().asQueue()),
  fakeQueueFailures(),
  new PaperSheetService(prisma),
  new RollupService(prisma),
);

/** Three sittings on one paper, scored, so three counting requests are pending. */
async function cohort(): Promise<{ paper: Paper; studentIds: string[] }> {
  const paper = await makePaper(prisma, { questions: SUBJECTS });
  const studentIds: string[] = [];
  for (const chosen of [
    [RIGHT_OPTION, RIGHT_OPTION, WRONG, null],
    [RIGHT_OPTION, WRONG, null, null],
    [WRONG, WRONG, null, null],
  ]) {
    const studentId = (await makeStudent(prisma)).id;
    const attempt = await sitPaper(prisma, { paper, studentId, chosen });
    await scorer.score(attempt.id);
    studentIds.push(studentId);
  }
  return { paper, studentIds };
}

function barrier(): { opened: Promise<void>; open: () => void } {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** The real client, holding a transaction open just before its first write to `table`. */
function pausingBefore(
  client: PrismaService,
  table: string,
  arrive: () => void,
  release: Promise<void>,
): PrismaService {
  let armed = true;
  const pause = (tx: object) =>
    new Proxy(tx, {
      get(target, key) {
        const held = Reflect.get(target, key) as unknown;
        if (key !== '$executeRaw' || !armed) return held;
        const call = (args: unknown[]) =>
          Reflect.apply(held as (...a: unknown[]) => unknown, target, args);
        return async (...args: unknown[]) => {
          const sql = Array.isArray(args[0]) ? args[0].join(' ') : '';
          if (!sql.includes(table)) return call(args);
          armed = false;
          arrive();
          await release;
          return call(args);
        };
      },
    });
  return new Proxy(client, {
    get(target, key) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: object) => Promise<unknown>, options?: object) =>
        target.$transaction((tx) => work(pause(tx)), options);
    },
  });
}

const testStat = (testId: string) => prisma.testStat.findUnique({ where: { testId } });
const studentStat = (studentId: string) => prisma.studentStat.findUnique({ where: { studentId } });

describe('RollupService — a sweep and a rebuild that overlap', () => {
  /** The inversion this closes: two writers of one test taking its three tables in opposite orders. */
  it('lets a test rebuild overlap a sweep without either being killed', async () => {
    const { paper } = await cohort();
    const arrived = barrier();
    const release = barrier();
    // Held after `TestStat` and before the sections, so the rebuild meets a lock the sweep owns.
    const paused = new RollupService(
      pausingBefore(prisma, 'TestSectionStat', arrived.open, release.opened),
    );

    const sweeping = paused.sweepCohorts();
    await arrived.opened;
    const rebuilding = new RollupService(prisma).rebuildTest(paper.testId);
    await delay(OVERLAP_MS);
    release.open();

    const [swept] = await Promise.all([sweeping, rebuilding]);
    assert.equal(swept, 1, 'the sweep counted its test rather than dying on the rebuild');
    assert.equal((await testStat(paper.testId))?.evaluatedCount, 3);
  });

  /** The student's side left the fold: the overlap that remains is a rebuild inside an evaluation. */
  it('counts a sitting whose evaluation a student rebuild runs inside', async () => {
    const paper = await makePaper(prisma, { questions: SUBJECTS });
    const other = await makePaper(prisma, { questions: SUBJECTS });
    const studentId = (await makeStudent(prisma)).id;
    const sat = await sitPaper(prisma, {
      paper,
      studentId,
      chosen: [RIGHT_OPTION, RIGHT_OPTION, WRONG, null],
    });
    await scorer.score(sat.id);
    const second = await sitPaper(prisma, {
      paper: other,
      studentId,
      chosen: [RIGHT_OPTION, WRONG, null, null],
    });

    const arrived = barrier();
    const release = barrier();
    const paused = new ScoringProcessor(
      pausingBefore(prisma, 'StudentStat', arrived.open, release.opened),
      new RollupQueue(new FakeQueue().asQueue()),
      new NotificationOutbox(new FakeQueue().asQueue()),
      fakeQueueFailures(),
      new PaperSheetService(prisma),
      new RollupService(prisma),
    );

    const scoring = paused.score(second.id);
    await arrived.opened;
    // Reads the student's sittings without seeing the one still being marked, then writes outright.
    await new RollupService(prisma).rebuildStudent(studentId);
    release.open();
    await scoring;

    assert.equal((await studentStat(studentId))?.testsAttempted, 2);
  });
});

describe('RollupService — a rebuild that lands before the fold it overtakes', () => {
  /** The guarantee any redesign has to keep: a rebuilt total is not added to a second time. */
  it('counts each sitting once when the rebuild runs first', async () => {
    const { paper } = await cohort();
    const rollup = new RollupService(prisma);

    await rollup.rebuildTest(paper.testId);
    const rebuilt = await testStat(paper.testId);
    await rollup.sweepCohorts();

    const after = await testStat(paper.testId);
    assert.equal(after?.evaluatedCount, 3);
    assert.equal(Number(after?.sumScore), Number(rebuilt?.sumScore));
  });

  it('counts each student once when their rebuild runs first', async () => {
    const { studentIds } = await cohort();
    const rollup = new RollupService(prisma);
    const studentId = studentIds[0] ?? '';

    await rollup.rebuildStudent(studentId);
    await rollup.sweepCohorts();

    assert.equal((await studentStat(studentId))?.testsAttempted, 1);
  });
});

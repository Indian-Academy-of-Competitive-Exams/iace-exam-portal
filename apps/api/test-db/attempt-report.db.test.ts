import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  PERFORMANCE_SCOPES,
  scoreCardSchema,
  type AppException,
  type PerformanceReport,
} from '@iace/contracts';
import { AttemptReportService } from '../src/attempts/attempt-report.service';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { PerformanceAnalyticsService } from '../src/attempts/performance.service';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { NotificationsService } from '../src/notifications/notifications.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { FakeQueue, FakeStorage, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  disposeQuestion,
  makeCatalog,
  makePaper,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  sitPaper,
  testPrisma,
  type Paper,
  type SitInput,
} from './support/database';

const MINUTE_MS = 60_000;
const QUERY_BUDGET = { SCORE_CARD: 14, REFUSAL: 2 } as const;
const STARTED = new Date('2026-09-01T05:00:00.000Z');
const WRONG = 'o2';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const processor = new ScoringProcessor(
  prisma,
  new RollupQueue(new FakeQueue().asQueue()),
  new NotificationsService(prisma),
  fakeQueueFailures(),
  new PaperSheetService(prisma),
  new RollupService(prisma),
);

const reports = (client: PrismaService = prisma) =>
  new AttemptReportService(client, new LeaderboardService(client), new FakeStorage() as never);

const analytics = (client: PrismaService = prisma) =>
  new PerformanceAnalyticsService(client, new LeaderboardService(client));

type Sat = Omit<SitInput, 'paper' | 'studentId' | 'chosen'>;

type Figures = Pick<
  PerformanceReport,
  'cohort' | 'composition' | 'sections' | 'time' | 'paceIndex'
>;

/** A sitting of the paper by a new student, marked by the real scorer unless told not to be. */
async function sat(
  paper: Paper,
  chosen: SitInput['chosen'],
  over: Sat & { marked?: boolean } = {},
) {
  const { marked = true, ...sitting } = over;
  const student = await makeStudent(prisma);
  const attempt = await sitPaper(prisma, { paper, studentId: student.id, chosen, ...sitting });
  if (marked) await processor.score(attempt.id);
  return { studentId: student.id, attemptId: attempt.id };
}

const text = (value: string) => [{ type: 'TEXT', text: value }];

const refusedWith = (code: string) => (error: AppException) => error.code === code;

/** What one read costs, counted on a client of its own so no other read lands in the count. */
async function queriesOf(read: (client: PrismaService) => Promise<unknown>): Promise<number> {
  const counted = testPrisma();
  let queries = 0;
  counted.$on('query', () => {
    queries += 1;
  });
  try {
    await read(counted);
  } finally {
    await counted.$disconnect();
  }
  return queries;
}

describe('the Score Card', () => {
  const NEVER_SHOWN = 'o_never_shown';

  /** Two sections of two; the second question is keyed to an option the student never picked. */
  const paper = () =>
    makePaper(prisma, {
      sections: ['Section A', 'Section B'],
      questions: [
        'Reasoning',
        {
          subject: 'Reasoning',
          options: [
            { id: 'o1', position: 1, isCorrect: false, text: { en: text('Mine') } },
            { id: NEVER_SHOWN, position: 2, isCorrect: true, text: { en: text('Right') } },
          ],
        },
        { subject: 'Reasoning', section: 1 },
        { subject: 'Reasoning', section: 1 },
      ],
    });

  const mine = (onPaper: Paper, over: Sat & { marked?: boolean } = {}) =>
    sat(onPaper, [RIGHT_OPTION, 'o1', null, null], {
      states: [undefined, undefined, undefined, ANSWER_STATE.NOT_ANSWERED],
      timeSpent: [40, 60, 0, 15],
      startedAt: STARTED,
      submittedAt: new Date(STARTED.getTime() + 20 * MINUTE_MS),
      ...over,
    });

  /** The invariant the whole payload exists to protect. */
  it('never says what the right answer was, on a question they missed', async () => {
    const { studentId, attemptId } = await mine(await paper());

    const card = await analytics().scoreCard(studentId, attemptId);

    assert.equal(scoreCardSchema.safeParse(card).success, true);
    assert.equal(card.composition.lostToWrong, 2);
    assert.ok(!JSON.stringify(card).includes(NEVER_SHOWN), 'the key must not reach a score card');
  });

  /** The failure this prevents: a student's card and an admin's view of the one sitting disagreeing. */
  it('carries the very figures the admin reads for the same sitting', async () => {
    const onPaper = await paper();
    const { studentId, attemptId } = await mine(onPaper);
    await sat(onPaper, [RIGHT_OPTION, NEVER_SHOWN, RIGHT_OPTION, RIGHT_OPTION]);
    const figures = ({ cohort, composition, sections, time, paceIndex }: Figures) => ({
      cohort,
      composition,
      sections,
      time,
      paceIndex,
    });

    const card = await analytics().scoreCard(studentId, attemptId);
    const report = await analytics().report(studentId, {
      scope: PERFORMANCE_SCOPES.ATTEMPT,
      attemptId,
    });

    assert.deepEqual(figures(card), figures(report));
    assert.deepEqual([card.cohort?.rank, card.cohort?.cohortSize], [card.rank, card.cohortSize]);
  });

  /** The rush after a test opens thousands of these at once, so every query here is paid that often. */
  it('opens within its query budget, with a rollup and its topper behind it', async () => {
    const onPaper = await paper();
    const { studentId, attemptId } = await mine(onPaper);
    await sat(onPaper, [RIGHT_OPTION, NEVER_SHOWN, RIGHT_OPTION, RIGHT_OPTION]);
    await new RollupService(prisma).rebuildTest(onPaper.testId);

    const queries = await queriesOf((client) => analytics(client).scoreCard(studentId, attemptId));

    assert.ok(queries <= QUERY_BUDGET.SCORE_CARD, `one score card cost ${queries} queries`);
  });

  /** A student retrying "No marks yet" in the rush must not pay for the card they cannot see yet. */
  it('refuses an unmarked paper within its own, narrower budget', async () => {
    const { studentId, attemptId } = await mine(await paper(), { marked: false });

    const queries = await queriesOf((client) =>
      assert.rejects(
        () => analytics(client).scoreCard(studentId, attemptId),
        refusedWith(ErrorCodes.CONFLICT),
      ),
    );

    assert.ok(queries <= QUERY_BUDGET.REFUSAL, `one refusal cost ${queries} queries`);
  });

  it('reports the marks, the counts and the percentage the paper was worth', async () => {
    const { studentId, attemptId } = await mine(await paper());

    const card = await analytics().scoreCard(studentId, attemptId);

    assert.equal(card.score, 1.5);
    assert.equal(card.maxMarks, 8);
    assert.equal(card.percentage, 18.75);
    assert.deepEqual([card.correctCount, card.wrongCount, card.unattemptedCount], [1, 1, 2]);
    assert.equal(card.timeTakenSec, 1200);
  });

  it('lays this sitting over every section, and prices each from the paper', async () => {
    const { studentId, attemptId } = await mine(await paper());

    const card = await analytics().scoreCard(studentId, attemptId);

    assert.deepEqual(
      card.sections.map((section) => [section.name, section.score, section.unattemptedCount]),
      [
        ['Section A', 1.5, 0],
        ['Section B', 0, 2],
      ],
    );
    assert.equal(card.sections[1]?.maxMarks, 4);
  });

  it('reads the rank, the percentile and the cohort off the live standing', async () => {
    const onPaper = await paper();
    const { studentId, attemptId } = await mine(onPaper);
    await sat(onPaper, [RIGHT_OPTION, NEVER_SHOWN, RIGHT_OPTION, RIGHT_OPTION]);

    const card = await analytics().scoreCard(studentId, attemptId);

    assert.deepEqual([card.rank, card.percentile, card.cohortSize], [2, 25, 2]);
  });

  /** The failure this prevents: a retake quoting a rank, when only the ranked sitting has a standing. */
  it('shows no rank for a sitting outside the cohort', async () => {
    const { studentId, attemptId } = await mine(await paper(), { isGraded: false, attemptNo: 2 });

    const card = await analytics().scoreCard(studentId, attemptId);

    assert.deepEqual([card.rank, card.percentile, card.cohortSize], [null, null, null]);
  });

  it('refuses a paper nobody has marked yet, and says why', async () => {
    const { studentId, attemptId } = await mine(await paper(), { marked: false });

    await assert.rejects(
      () => analytics().scoreCard(studentId, attemptId),
      refusedWith(ErrorCodes.CONFLICT),
    );
  });

  /** The acceptance for a drop: every sitting that attempted it moves, and equal marks rank on time. */
  it('re-ranks the cohort when a dropped question levels two students on marks', async () => {
    const onPaper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning', 'Reasoning'] });
    const taking = (minutes: number) => ({
      startedAt: STARTED,
      submittedAt: new Date(STARTED.getTime() + minutes * MINUTE_MS),
    });
    const ace = await sat(onPaper, [RIGHT_OPTION, RIGHT_OPTION, RIGHT_OPTION], taking(25));
    const middle = await sat(onPaper, [WRONG, RIGHT_OPTION, RIGHT_OPTION], taking(20));
    const last = await sat(onPaper, [WRONG, WRONG, null], taking(30));
    const cards = () =>
      Promise.all(
        [ace, middle, last].map(async (one) => {
          const card = await analytics().scoreCard(one.studentId, one.attemptId);
          return [card.score, card.rank];
        }),
      );
    assert.deepEqual(await cards(), [
      [6, 1],
      [3.5, 2],
      [-1, 3],
    ]);

    await disposeQuestion(prisma, onPaper, 0, PAPER_QUESTION_STATUS.DROPPED);
    for (const one of [ace, middle, last]) await processor.score(one.attemptId);

    assert.deepEqual(await cards(), [
      [6, 2],
      [6, 1],
      [1.5, 3],
    ]);
  });

  it('reads another student’s sitting as missing rather than as refused', async () => {
    const onPaper = await paper();
    const { attemptId } = await mine(onPaper);
    const someoneElse = await sat(onPaper, [null, null, null, null]);

    await assert.rejects(
      () => analytics().scoreCard(someoneElse.studentId, attemptId),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('the Solution Report', () => {
  const RIGHT = 'o_right';
  const WORKING = 'Because 7 × 6 is 42.';

  const reviewed = async (over: Sat & { marked?: boolean } = {}) => {
    const onPaper = await makePaper(prisma, {
      questions: [
        {
          subject: 'Quant',
          content: {
            en: { stem: text('What is 7 × 6?'), solution: text(WORKING) },
            hi: { stem: text('saat guna chhah kya hai?') },
          },
          options: [
            { id: 'o_wrong', position: 1, isCorrect: false, text: { en: text('41') } },
            { id: RIGHT, position: 2, isCorrect: true, text: { en: text('42') } },
          ],
        },
        'Quant',
      ],
    });
    return sat(onPaper, ['o_wrong', null], {
      timeSpent: [55, 0],
      languages: ['EN', 'HI'],
      ...over,
    });
  };

  it('serves the right answer and the working once the sitting is marked', async () => {
    const { studentId, attemptId } = await reviewed();

    const report = await reports().solutions(studentId, attemptId);
    const missed = report.questions[0];

    assert.equal(report.attemptId, attemptId);
    assert.equal(missed?.options.find((option) => option.isCorrect)?.id, RIGHT);
    assert.equal(missed?.selectedOptionId, 'o_wrong');
    assert.equal(missed?.isCorrect, false);
    assert.equal(missed?.timeSpentSec, 55);
    assert.ok(JSON.stringify(missed?.content).includes(WORKING), 'the working must be shown');
  });

  /** The failure this prevents: a refusal that had already loaded the key it was refusing. */
  it('refuses an unmarked sitting without ever having fetched the key', async () => {
    const { studentId, attemptId } = await reviewed({ marked: false });
    const reads: unknown[] = [];
    const attempts = new Proxy(prisma.attempt, {
      get(target, key: string | symbol) {
        const member = Reflect.get(target, key) as unknown;
        if (key !== 'findFirst' || typeof member !== 'function') return member;
        return (args: unknown) => {
          reads.push(args);
          return member.call(target, args) as unknown;
        };
      },
    });
    const watched = new Proxy(prisma, {
      get: (target, key: string | symbol) =>
        key === 'attempt' ? attempts : (Reflect.get(target, key) as unknown),
    });

    await assert.rejects(
      () => reports(watched).solutions(studentId, attemptId),
      (error: AppException) => {
        assert.equal(error.code, ErrorCodes.CONFLICT);
        const thrown = JSON.stringify({ ...error, message: error.message });
        assert.ok(!thrown.includes(RIGHT), 'the refusal must not carry the correct option');
        assert.ok(!thrown.includes(WORKING), 'the refusal must not carry the working');
        return true;
      },
    );

    assert.equal(reads.length, 1);
    assert.ok(!JSON.stringify(reads).includes('questionVersion'), 'the gate must not load the key');
  });

  it('serves the options in the order the student sat them, not the order they are stored', async () => {
    const { studentId, attemptId } = await reviewed({ shuffleSeed: 12345 });

    const report = await reports().solutions(studentId, attemptId);

    const ids = report.questions[0]?.options.map((option) => option.id) ?? [];
    assert.deepEqual([...ids].sort(), [RIGHT, 'o_wrong']);
  });

  it('keeps only the languages the sitting was taken in', async () => {
    const { studentId, attemptId } = await reviewed({ languages: ['EN'] });

    const shown = JSON.stringify((await reports().solutions(studentId, attemptId)).questions[0]);

    assert.ok(shown.includes('What is 7'), 'the English stem must be there');
    assert.ok(!shown.includes('saat guna chhah'), 'a language nobody sat must not be');
  });

  it('refuses a paper nobody has marked yet', async () => {
    const { studentId, attemptId } = await reviewed({ marked: false });

    await assert.rejects(
      () => reports().solutions(studentId, attemptId),
      refusedWith(ErrorCodes.CONFLICT),
    );
  });

  it('reads another student’s review as missing rather than as refused', async () => {
    const { attemptId } = await reviewed();
    const someoneElse = await makeStudent(prisma);

    await assert.rejects(
      () => reports().solutions(someoneElse.id, attemptId),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  /** Fails if solutions' `urls.size === 0` shortcut returns: a key-less legacy image would survive. */
  it('strips an external src a key-less legacy solution image quotes', async () => {
    const onPaper = await makePaper(prisma, {
      questions: [
        {
          subject: 'Quant',
          content: {
            en: {
              stem: text('What is 7 × 6?'),
              solution: text('<p>Because<img src="https://tracker.example/x.gif"></p>'),
            },
          },
          options: [
            { id: 'o_wrong', position: 1, isCorrect: false, text: { en: text('41') } },
            { id: RIGHT, position: 2, isCorrect: true, text: { en: text('42') } },
          ],
        },
      ],
    });
    const { studentId, attemptId } = await sat(onPaper, ['o_wrong'], { languages: ['EN'] });

    const shown = JSON.stringify((await reports().solutions(studentId, attemptId)).questions[0]);

    assert.doesNotMatch(shown, /tracker\.example/);
  });
});

describe('the trend across every test a student has sat', () => {
  it('reads oldest first, so a chart draws left to right', async () => {
    const onPaper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
    const recent = await sat(onPaper, [RIGHT_OPTION, RIGHT_OPTION], { submittedAt: STARTED });
    const earlier = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
    const old = await sitPaper(prisma, {
      paper: earlier,
      studentId: recent.studentId,
      chosen: [RIGHT_OPTION, WRONG],
      submittedAt: new Date('2026-08-01T05:00:00.000Z'),
    });
    await processor.score(old.id);

    const trend = await reports().performance(recent.studentId);

    assert.deepEqual(
      trend.points.map((point) => point.attemptId),
      [old.id, recent.attemptId],
    );
    assert.equal(trend.testsSat, 2);
    assert.equal(trend.points[0]?.accuracy, 50);
    const card = await analytics().scoreCard(recent.studentId, old.id);
    assert.equal(trend.sittings?.[0]?.maxMarks, card.maxMarks);
    assert.equal(trend.sittings?.[0]?.percentage, card.percentage);
  });

  it('plots each sitting at its standing now, a retake at none, and nobody else’s', async () => {
    const onPaper = await makePaper(prisma, { questions: ['Reasoning', 'Reasoning'] });
    const mine = await sat(onPaper, [RIGHT_OPTION, WRONG], { submittedAt: STARTED });
    await sat(onPaper, [RIGHT_OPTION, RIGHT_OPTION]);
    const retake = await sitPaper(prisma, {
      paper: onPaper,
      studentId: mine.studentId,
      chosen: [RIGHT_OPTION, RIGHT_OPTION],
      attemptNo: 2,
      isGraded: false,
      submittedAt: new Date('2026-09-02T05:00:00.000Z'),
    });
    await processor.score(retake.id);

    const trend = await reports().performance(mine.studentId);

    assert.deepEqual(
      trend.points.map((point) => [point.attemptId, point.isGraded, point.rank, point.percentile]),
      [
        [mine.attemptId, true, 2, 25],
        [retake.id, false, null, null],
      ],
    );
  });

  /** The defect this prevents: standings scanned every sitting ever made, not just the 20 plotted. */
  it('still ranks every plotted sitting once history runs past the trend length', async () => {
    const catalog = await makeCatalog(prisma);
    const student = await makeStudent(prisma);
    const dayMs = 24 * 60 * 60 * 1000;
    const sittings: string[] = [];
    for (let day = 0; day < 25; day += 1) {
      const testId = (await makeTest(prisma, catalog)).id;
      const submittedAt = new Date(STARTED.getTime() + day * dayMs);
      const sitting = await makeSitting(prisma, {
        testId,
        studentId: student.id,
        score: 10,
        submittedAt,
      });
      sittings.push(sitting.id);
    }

    const trend = await reports().performance(student.id);

    assert.equal(trend.testsSat, 25);
    assert.deepEqual(
      trend.points.map((point) => point.attemptId),
      sittings.slice(5),
    );
    assert.ok(trend.points.every((point) => point.rank === 1 && point.percentile === 100));
  });

  /** The defect this prevents: a tile, a picker or a paper's history forgetting the 21st sitting back. */
  it('lists every sitting past the trend length, each with its marks and its report', async () => {
    const catalog = await makeCatalog(prisma);
    const student = await makeStudent(prisma);
    const dayMs = 24 * 60 * 60 * 1000;
    const sittings: string[] = [];
    for (let day = 0; day < 25; day += 1) {
      const testId = (await makeTest(prisma, catalog)).id;
      const submittedAt = new Date(STARTED.getTime() + day * dayMs);
      const sitting = await makeSitting(prisma, {
        testId,
        studentId: student.id,
        score: day,
        submittedAt,
      });
      sittings.push(sitting.id);
    }

    const trend = await reports().performance(student.id);

    assert.equal(trend.points.length, 20);
    assert.deepEqual(
      trend.sittings?.map((sitting) => [sitting.attemptId, sitting.score]),
      sittings.map((attemptId, day) => [attemptId, day]),
    );
  });
});

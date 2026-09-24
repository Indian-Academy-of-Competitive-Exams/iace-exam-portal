import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ANSWER_STATE,
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  type AppException,
} from '@iace/contracts';
import { AttemptReportService } from '../src/attempts/attempt-report.service';
import { LeaderboardService } from '../src/attempts/leaderboard.service';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import type { PrismaService } from '../src/prisma/prisma.service';
import { FakeQueue, FakeStorage, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  disposeQuestion,
  makePaper,
  makeStudent,
  resetDatabase,
  servedAnswers,
  sitPaper,
  testPrisma,
  type Paper,
  type SitInput,
} from './support/database';

const MINUTE_MS = 60_000;
const STARTED = new Date('2026-09-01T05:00:00.000Z');
const WRONG = 'o2';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const processor = new ScoringProcessor(
  prisma,
  new RollupQueue(new FakeQueue().asQueue()),
  new NotificationOutbox(new FakeQueue().asQueue()),
  fakeQueueFailures(),
  new PaperSheetService(prisma),
  new RollupService(prisma),
);

const reports = (client: PrismaService = prisma) =>
  new AttemptReportService(client, new LeaderboardService(client), new FakeStorage() as never);

type Sat = Omit<SitInput, 'paper' | 'studentId' | 'chosen'>;

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

  it('reads each answer and its marks off the sheet, in the order the sitting was served', async () => {
    const onPaper = await paper();
    // Shuffled, and with a seed that really moves Section B — so a reader ignoring it still fails.
    await prisma.baseConfig.update({
      where: { id: onPaper.catalog.baseConfigId },
      data: { shuffleQuestions: true },
    });
    const { studentId, attemptId } = await mine(onPaper, { shuffleSeed: 1 });

    const card = await reports().scoreCard(studentId, attemptId);

    assert.notDeepEqual(
      card.questions.map((row) => row.questionId),
      onPaper.items.map((item) => item.questionId),
    );
    assert.deepEqual(
      card.questions.map((row) => [
        row.questionId,
        row.order,
        row.selectedOptionId,
        row.isCorrect,
        row.marksAwarded,
      ]),
      (await servedAnswers(prisma, attemptId)).map((row) => [
        row.questionId,
        row.order,
        row.selectedOptionId,
        row.isCorrect,
        row.marksAwarded,
      ]),
    );
  });

  /** The invariant the whole payload exists to protect. */
  it('never says what the right answer was, on a question they missed', async () => {
    const { studentId, attemptId } = await mine(await paper());

    const card = await reports().scoreCard(studentId, attemptId);
    const missed = card.questions[1];

    assert.equal(missed?.isCorrect, false);
    assert.equal(missed?.selectedOptionId, 'o1');
    assert.ok(!JSON.stringify(card).includes(NEVER_SHOWN), 'the key must not reach a score card');
  });

  it('reports the marks, the counts and the percentage the paper was worth', async () => {
    const { studentId, attemptId } = await mine(await paper());

    const card = await reports().scoreCard(studentId, attemptId);

    assert.equal(card.score, 1.5);
    assert.equal(card.maxMarks, 8);
    assert.equal(card.percentage, 18.75);
    assert.deepEqual([card.correctCount, card.wrongCount, card.unattemptedCount], [1, 1, 2]);
    assert.equal(card.timeTakenSec, 1200);
  });

  it('lays this sitting over every section, and prices each from the paper', async () => {
    const { studentId, attemptId } = await mine(await paper());

    const card = await reports().scoreCard(studentId, attemptId);

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

    const card = await reports().scoreCard(studentId, attemptId);

    assert.deepEqual([card.rank, card.percentile, card.cohortSize], [2, 25, 2]);
  });

  /** The failure this prevents: a retake quoting a rank, when only the ranked sitting has a standing. */
  it('shows no rank for a sitting outside the cohort', async () => {
    const { studentId, attemptId } = await mine(await paper(), { isGraded: false, attemptNo: 2 });

    const card = await reports().scoreCard(studentId, attemptId);

    assert.deepEqual([card.rank, card.percentile, card.cohortSize], [null, null, null]);
  });

  it('refuses a paper nobody has marked yet, and says why', async () => {
    const { studentId, attemptId } = await mine(await paper(), { marked: false });

    await assert.rejects(
      () => reports().scoreCard(studentId, attemptId),
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
          const card = await reports().scoreCard(one.studentId, one.attemptId);
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
      () => reports().scoreCard(someoneElse.studentId, attemptId),
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
      trend.points.map((point) => [point.attemptId, point.rank, point.percentile]),
      [
        [mine.attemptId, 2, 25],
        [retake.id, null, null],
      ],
    );
  });
});

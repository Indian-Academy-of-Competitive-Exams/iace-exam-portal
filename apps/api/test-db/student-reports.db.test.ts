import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  REPORT_KEYS,
  REPORT_PARAMS,
  TEST_SERIES_KIND,
  TEST_STATUS,
  reportChoicesQuerySchema,
} from '@iace/contracts';
import { PaperSheetService } from '../src/attempts/paper-sheet.service';
import { RollupService } from '../src/attempts/rollup.service';
import { RollupQueue } from '../src/attempts/rollup-queue';
import { ScoringProcessor } from '../src/attempts/scoring.processor';
import { NotificationsService } from '../src/notifications/notifications.service';
import { FakeMetrics, FakeQueue, fakeQueueFailures } from '../test/support/fakes';
import {
  RIGHT_OPTION,
  makeCatalog,
  makePaper,
  makeSitting,
  makeStudent,
  makeTest,
  resetDatabase,
  sitPaper,
  testPrisma,
  uid,
  type Paper,
  type SitInput,
} from './support/database';
import { figureOf, reportsOver, tableOf } from './support/reports';

const WRONG = 'o3';

const prisma = testPrisma();
const { reports, read } = reportsOver(prisma);

/** The real scorer, so a sitting carries the verdicts, section scores and rollups a report reads. */
const scorer = new ScoringProcessor(
  prisma,
  new RollupQueue(new FakeQueue().asQueue()),
  new NotificationsService(prisma),
  fakeQueueFailures(),
  new PaperSheetService(prisma),
  new RollupService(prisma),
  new FakeMetrics().asService(),
);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const student = async (fullName: string) => (await makeStudent(prisma, { fullName })).id;

async function sit(paper: Paper, studentId: string, chosen: SitInput['chosen'], submittedAt: Date) {
  const attempt = await sitPaper(prisma, { paper, studentId, chosen, submittedAt });
  await scorer.score(attempt.id);
  return attempt.id;
}

/** One question in each of two sections, priced at 2 with half a mark off. */
const twoSections = (title: string) =>
  makePaper(prisma, {
    title,
    sections: ['Quant', 'English'],
    questions: [
      { subject: 'Maths', section: 0 },
      { subject: 'English', section: 1 },
    ],
  });

const refusal = (code: string) => (error: unknown) => AppException.is(error) && error.code === code;

const WEEK = { from: '2026-06-08', to: '2026-06-14' };
const IN_WEEK = new Date('2026-06-09T06:00:00.000Z');
const WEEK_BEFORE = new Date('2026-06-03T06:00:00.000Z');

describe('the weekly student report', () => {
  it('reads the period’s sittings at their live standing, beside the period before', async () => {
    const paper = await twoSections('Mock 2');
    const earlier = await twoSections('Mock 1');
    const ana = await student('Ana');
    await sit(paper, ana, [RIGHT_OPTION, WRONG], IN_WEEK);
    await sit(paper, await student('Bala'), [RIGHT_OPTION, RIGHT_OPTION], IN_WEEK);
    await sit(earlier, ana, [RIGHT_OPTION, RIGHT_OPTION], WEEK_BEFORE);

    const document = await read(REPORT_KEYS.STUDENT_WEEKLY, { studentId: ana, ...WEEK });

    assert.equal(figureOf(document, 'Tests sat'), 1);
    assert.equal(figureOf(document, 'Average percentile, period before'), 100);
    assert.deepEqual(
      tableOf(document, 'Sittings').map((row) => [
        row.Test,
        row.Score,
        row['Out of'],
        row.Rank,
        row['Ranked sittings'],
      ]),
      [['Mock 2', 1.5, 4, 2, 2]],
    );
    assert.deepEqual(
      tableOf(document, 'Subjects').map((row) => [row.Subject, row.Correct, row.Wrong]),
      [
        ['English', 0, 1],
        ['Quant', 1, 0],
      ],
    );
  });

  it('answers not found for a student who is not there', async () => {
    await assert.rejects(
      read(REPORT_KEYS.STUDENT_WEEKLY, { studentId: uid(), ...WEEK }),
      refusal(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('the score card', () => {
  it('prints the sitting’s marks out of the paper’s, and its place in the cohort', async () => {
    const paper = await twoSections('Mock 2');
    const ana = await student('Ana');
    const attemptId = await sit(paper, ana, [RIGHT_OPTION, WRONG], IN_WEEK);
    await sit(paper, await student('Bala'), [RIGHT_OPTION, RIGHT_OPTION], IN_WEEK);

    const document = await read(REPORT_KEYS.STUDENT_SCORE_CARD, { studentId: ana, attemptId });

    assert.equal(figureOf(document, 'Score'), '1.5 / 4');
    assert.equal(figureOf(document, 'Rank'), '2 of 2');
    assert.deepEqual(
      tableOf(document, 'Sections').map((row) => [row.Section, row.Score]),
      [
        ['Quant', 2],
        ['English', -0.5],
      ],
    );
  });

  it('refuses a sitting that is somebody else’s', async () => {
    const paper = await twoSections('Mock 2');
    const ana = await student('Ana');
    const balas = await sit(paper, await student('Bala'), [RIGHT_OPTION, WRONG], IN_WEEK);

    await assert.rejects(
      read(REPORT_KEYS.STUDENT_SCORE_CARD, { studentId: ana, attemptId: balas }),
      refusal(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('the progress letter to parents', () => {
  it('opens by naming the student, and closes on what a rank is and who signs', async () => {
    const paper = await twoSections('Mock 2');
    const ana = await student('Ana');
    await sit(paper, ana, [RIGHT_OPTION, WRONG], IN_WEEK);

    const letter = await read(REPORT_KEYS.STUDENT_PARENT_LETTER, { studentId: ana, ...WEEK });

    assert.equal(letter.preface[0], 'Dear Parent,');
    assert.match(
      letter.preface[1] ?? '',
      /Ana did in the IACE tests sat from 8 Jun 2026 to 14 Jun 2026/,
    );
    assert.equal(letter.closing.length, 2);
    assert.equal(tableOf(letter, 'Sittings').length, 1);
  });
});

describe('the cumulative student report', () => {
  it('reads the lifetime figures the scorer folded, and lists every marked sitting', async () => {
    const ana = await student('Ana');
    await sit(await twoSections('Mock 1'), ana, [RIGHT_OPTION, RIGHT_OPTION], WEEK_BEFORE);
    await sit(await twoSections('Mock 2'), ana, [RIGHT_OPTION, WRONG], IN_WEEK);

    const document = await read(REPORT_KEYS.STUDENT_CUMULATIVE, { studentId: ana });

    assert.equal(figureOf(document, 'Tests sat'), 2);
    assert.equal(figureOf(document, 'Accuracy (%)'), 75);
    assert.deepEqual(
      tableOf(document, 'Sittings').map((row) => row.Test),
      ['Mock 1', 'Mock 2'],
    );
    assert.deepEqual(
      tableOf(document, 'Subjects').map((row) => [row.Subject, row.Answered, row.Correct]),
      [
        ['English', 2, 1],
        ['Maths', 2, 2],
      ],
    );
  });
});

describe('the topic-wise accuracy', () => {
  it('puts the weakest topic first, and counts a blank as met but not answered', async () => {
    const paper = await makePaper(prisma, {
      title: 'Mock 1',
      questions: ['Maths', 'English', 'Reasoning'],
    });
    const grammar = await prisma.topic.create({
      data: { id: uid(), name: 'Grammar', subjectId: paper.items[1]?.subjectId ?? '' },
    });
    await prisma.question.update({
      where: { id: paper.items[1]?.questionId },
      data: { topicId: grammar.id },
    });
    const ana = await student('Ana');
    await sit(paper, ana, [RIGHT_OPTION, WRONG, null], IN_WEEK);

    const rows = tableOf(await read(REPORT_KEYS.STUDENT_TOPICS, { studentId: ana }), 'Topics');

    assert.deepEqual(
      rows.map((row) => [row.Subject, row.Topic, row['Questions met'], row.Answered, row.Correct]),
      [
        ['English', 'Grammar', 1, 1, 0],
        ['Maths', 'No topic', 1, 1, 1],
        ['Reasoning', 'No topic', 1, 0, 0],
      ],
    );
    assert.equal(rows[2]?.['Accuracy (%)'], null);
  });
});

describe('the tests missed', () => {
  it('lists the open tests a student reaches and holds no sitting of', async () => {
    const catalog = await makeCatalog(prisma);
    await prisma.testSeries.update({
      where: { id: catalog.testSeriesId },
      data: { kind: TEST_SERIES_KIND.FREE },
    });
    const live = { status: TEST_STATUS.ACTIVE, finalizedAt: new Date() };
    const sat = await makeTest(prisma, catalog, { ...live, title: 'Sat' });
    await makeTest(prisma, catalog, { ...live, title: 'Unsat' });
    await makeTest(prisma, catalog, {
      ...live,
      title: 'Opens later',
      opensAt: new Date(Date.now() + 86_400_000),
    });
    await makeTest(prisma, catalog, { title: 'Draft' });
    const ana = await student('Ana');
    await makeSitting(prisma, { testId: sat.id, studentId: ana, score: 10 });

    const document = await read(REPORT_KEYS.STUDENT_MISSED, { studentId: ana });

    assert.equal(figureOf(document, 'Open tests reached'), 2);
    assert.deepEqual(
      tableOf(document, 'Tests missed').map((row) => row.Test),
      ['Unsat'],
    );
  });
});

describe('a student’s own reports', () => {
  it('reads the caller’s report whoever the query names', async () => {
    const paper = await twoSections('Mock 2');
    const ana = await student('Ana');
    const bala = await student('Bala');
    await sit(paper, ana, [RIGHT_OPTION, WRONG], IN_WEEK);
    await sit(paper, bala, [RIGHT_OPTION, RIGHT_OPTION], IN_WEEK);

    const document = await reports.own(ana, REPORT_KEYS.STUDENT_CUMULATIVE, { studentId: bala });

    assert.deepEqual(document.about[0], { label: 'Student', value: 'Ana' });
  });

  it('refuses the score card of a sitting that is somebody else’s', async () => {
    const paper = await twoSections('Mock 2');
    const ana = await student('Ana');
    const balas = await sit(paper, await student('Bala'), [RIGHT_OPTION, WRONG], IN_WEEK);

    await assert.rejects(
      reports.own(ana, REPORT_KEYS.STUDENT_SCORE_CARD, { attemptId: balas }),
      refusal(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('a report’s choices', () => {
  const asked = (input: unknown) => reportChoicesQuerySchema.parse(input);

  it('finds a student by name', async () => {
    await student('Ana Kumari');
    await student('Bala');

    const page = await reports.choices(REPORT_PARAMS.STUDENT, asked({ q: 'kumari' }));

    assert.deepEqual(
      page.items.map((choice) => choice.label),
      ['Ana Kumari'],
    );
    assert.equal(page.total, 1);
  });

  it('offers one student’s marked sittings, and none without being told whose', async () => {
    const paper = await twoSections('Mock 2');
    const ana = await student('Ana');
    const marked = await sit(paper, ana, [RIGHT_OPTION, WRONG], IN_WEEK);
    await sit(paper, await student('Bala'), [RIGHT_OPTION, WRONG], IN_WEEK);
    await sitPaper(prisma, { paper: await twoSections('Unmarked'), studentId: ana, chosen: [] });

    const page = await reports.choices(REPORT_PARAMS.ATTEMPT, asked({ studentId: ana }));

    assert.deepEqual(
      page.items.map((choice) => [choice.value, choice.label]),
      [[marked, 'Mock 2 · 9 Jun 2026']],
    );
    await assert.rejects(
      reports.choices(REPORT_PARAMS.ATTEMPT, asked({})),
      refusal(ErrorCodes.VALIDATION_ERROR),
    );
  });
});

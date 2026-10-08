import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ASSIGNMENT_ROLES,
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  PAPER_SOURCES,
  QUESTION_STATUS,
  REPORT_KEYS,
  SEND_BACK_REASONS,
  type AssignmentRole,
} from '@iace/contracts';
import {
  makeAdmin,
  makePaper,
  makeQuestion,
  makeSubject,
  resetDatabase,
  testPrisma,
  uid,
  type Paper,
} from './support/database';
import { figureOf, reportsOver, tableOf } from './support/reports';

const prisma = testPrisma();
const { read } = reportsOver(prisma);

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const WEEK = { from: '2026-06-08', to: '2026-06-14' };
const IN_WEEK = new Date('2026-06-09T06:00:00.000Z');
const WEEK_BEFORE = new Date('2026-06-03T06:00:00.000Z');
const DAY_MS = 86_400_000;

const admin = async (fullName: string) => (await makeAdmin(prisma, { fullName })).id;

function assign(
  paper: Paper,
  assigneeId: string,
  role: AssignmentRole,
  over: { dueAt?: Date; finalizedAt?: Date; replacedAt?: Date; section?: number } = {},
) {
  const { section = 0, ...stamps } = over;
  return prisma.questionAssignment.create({
    data: {
      id: uid(),
      testId: paper.testId,
      baseConfigId: paper.catalog.baseConfigId,
      baseConfigSectionId: paper.sectionIds[section] ?? '',
      assigneeId,
      role,
      ...stamps,
    },
  });
}

const review = (paper: Paper, at: number, data: object) =>
  prisma.questionReview.create({
    data: {
      id: uid(),
      testId: paper.testId,
      baseConfigSectionId: paper.items[at]?.sectionId ?? '',
      questionId: paper.items[at]?.questionId ?? '',
      ...data,
    },
  });

describe('the authoring progress', () => {
  it('sets a section’s two seats side by side, with what its reader has checked and sent back', async () => {
    const paper = await makePaper(prisma, { sections: ['Quant'], questions: ['Maths', 'Maths'] });
    const typist = await admin('Typist One');
    const reader = await admin('Reader One');
    await assign(paper, typist, ASSIGNMENT_ROLES.TYPIST, { finalizedAt: IN_WEEK });
    await assign(paper, reader, ASSIGNMENT_ROLES.PROOFREADER);
    await assign(paper, await admin('Taken Off'), ASSIGNMENT_ROLES.TYPIST, {
      replacedAt: WEEK_BEFORE,
    });
    await review(paper, 0, { checkedAt: IN_WEEK });
    await review(paper, 1, { sentBackAt: IN_WEEK, reason: SEND_BACK_REASONS.SPELLING });

    const document = await read(REPORT_KEYS.AUTHORING_PROGRESS, { testId: paper.testId });

    assert.equal(figureOf(document, 'Typed'), 1);
    assert.equal(figureOf(document, 'Read'), 0);
    assert.deepEqual(
      tableOf(document, 'Sections').map((row) => [
        row.Section,
        row.Questions,
        row.Typist,
        row['Proof-reader'],
        row.Checked,
        row['Sent back, open'],
      ]),
      [['Quant', 2, 'Typist One', 'Reader One', 1, 1]],
    );
  });

  it('answers not found for a test that is not there', async () => {
    await assert.rejects(
      read(REPORT_KEYS.AUTHORING_PROGRESS, { testId: uid() }),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

describe('the overdue sections', () => {
  it('lists what is outstanding past its day, and nothing done, replaced or not yet due', async () => {
    const paper = await makePaper(prisma, {
      sections: ['Quant', 'English', 'Reasoning', 'Awareness'],
      questions: ['Maths'],
    });
    const late = new Date(Date.now() - 3 * DAY_MS - 60_000);
    const who = await admin('Late Typist');
    await assign(paper, who, ASSIGNMENT_ROLES.TYPIST, { dueAt: late, section: 0 });
    await assign(paper, who, ASSIGNMENT_ROLES.TYPIST, {
      dueAt: late,
      finalizedAt: new Date(),
      section: 1,
    });
    await assign(paper, who, ASSIGNMENT_ROLES.TYPIST, {
      dueAt: late,
      replacedAt: new Date(),
      section: 2,
    });
    await assign(paper, who, ASSIGNMENT_ROLES.TYPIST, {
      dueAt: new Date(Date.now() + DAY_MS),
      section: 3,
    });
    await prisma.test.update({
      where: { id: paper.testId },
      data: { paperSource: PAPER_SOURCES.FRAMED },
    });
    // A picked paper's typist has no Done to give, so a day gone by is not theirs to be late for.
    const picked = await makePaper(prisma, { sections: ['Picked'], questions: ['Maths'] });
    await prisma.test.update({
      where: { id: picked.testId },
      data: { paperSource: PAPER_SOURCES.PICKED },
    });
    await assign(picked, who, ASSIGNMENT_ROLES.TYPIST, { dueAt: late });

    const rows = tableOf(await read(REPORT_KEYS.OVERDUE_ASSIGNMENTS, {}), 'Overdue');

    assert.deepEqual(
      rows.map((row) => [row.Section, row.Role, row['Held by'], row['Days late']]),
      [['Quant', 'Typist', 'Late Typist', 3]],
    );
  });
});

describe('the staff output', () => {
  it('counts what each person stamped in the period, and nothing stamped outside it', async () => {
    const paper = await makePaper(prisma, { sections: ['Quant'], questions: ['Maths', 'Maths'] });
    const typist = await admin('Typist One');
    const reader = await admin('Reader One');
    const [first, second] = paper.items;
    await prisma.question.update({
      where: { id: first?.questionId },
      data: { createdById: typist, createdAt: IN_WEEK },
    });
    await prisma.question.update({
      where: { id: second?.questionId },
      data: { createdById: typist, createdAt: WEEK_BEFORE },
    });
    await assign(paper, typist, ASSIGNMENT_ROLES.TYPIST, { finalizedAt: IN_WEEK });
    await review(paper, 0, { checkedAt: IN_WEEK, checkedById: reader });
    await review(paper, 1, { checkedAt: WEEK_BEFORE, checkedById: reader });

    const rows = tableOf(await read(REPORT_KEYS.STAFF_OUTPUT, WEEK), 'Staff output');

    assert.deepEqual(
      rows.map((row) => [
        row.Admin,
        row['Questions typed'],
        row['Sections typed'],
        row['Questions checked'],
      ]),
      [
        ['Reader One', 0, 0, 1],
        ['Typist One', 1, 1, 0],
      ],
    );
  });
});

describe('the questions sent back', () => {
  it('counts each typist’s send-backs by reason, and how many they have fixed', async () => {
    const paper = await makePaper(prisma, { questions: ['Maths', 'Maths'] });
    const typist = await admin('Typist One');
    await prisma.question.updateMany({ data: { createdById: typist } });
    await review(paper, 0, {
      sentBackAt: IN_WEEK,
      reason: SEND_BACK_REASONS.SPELLING,
      fixedAt: IN_WEEK,
    });
    await review(paper, 1, { sentBackAt: IN_WEEK, reason: SEND_BACK_REASONS.ANSWER_OPTION });

    const document = await read(REPORT_KEYS.SEND_BACKS, WEEK);

    assert.deepEqual(
      tableOf(document, 'Send-backs').map((row) => [
        row.Typist,
        row.Spelling,
        row['Answer or option'],
        row['Sent back'],
        row.Fixed,
      ]),
      [['Typist One', 1, 1, 2, 1]],
    );
  });
});

describe('the question bank inventory', () => {
  it('splits a subject’s active questions by difficulty, and counts the archived apart', async () => {
    const maths = (await makeSubject(prisma, 'Maths')).id;
    await makeQuestion(prisma, { subjectId: maths, difficulty: DIFFICULTY_LEVEL.LOW });
    await makeQuestion(prisma, { subjectId: maths, difficulty: DIFFICULTY_LEVEL.HIGH });
    await makeQuestion(prisma, {
      subjectId: maths,
      difficulty: DIFFICULTY_LEVEL.HIGH,
      status: QUESTION_STATUS.ARCHIVED,
    });

    const [row] = tableOf(await read(REPORT_KEYS.BANK_INVENTORY, {}), 'Subjects');

    assert.deepEqual(
      [row?.Subject, row?.Active, row?.Low, row?.Medium, row?.High, row?.Archived],
      ['Maths', 2, 1, 0, 1, 1],
    );
  });
});

describe('the question usage', () => {
  it('counts a question as used by the papers that carry it, and says how many never were', async () => {
    const first = await makePaper(prisma, { questions: ['Maths'] });
    const [used] = first.items;
    const second = await makePaper(prisma, { questions: ['Maths'] });
    await prisma.paperQuestion.create({
      data: {
        id: uid(),
        testId: second.testId,
        baseConfigId: second.catalog.baseConfigId,
        baseConfigSectionId: second.sectionIds[0] ?? '',
        questionId: used?.questionId ?? '',
        questionVersionId: used?.versionId ?? '',
        order: 2,
        marks: 2,
        negativeMarks: 0.5,
      },
    });
    await makeQuestion(prisma, { subjectId: used?.subjectId ?? '' });

    const document = await read(REPORT_KEYS.QUESTION_USAGE, { top: 1 });

    assert.equal(figureOf(document, 'Never used'), 1);
    assert.deepEqual(
      tableOf(document, 'Subjects').map((row) => [row.Subject, row['Used on a paper']]),
      [['Maths', 2]],
    );
    assert.deepEqual(
      tableOf(document, 'Most used').map((row) => row.Papers),
      [2],
    );
  });
});

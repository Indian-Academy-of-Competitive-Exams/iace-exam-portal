import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ASSIGNMENT_ROLES,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  QUESTION_STATUS,
  authoringHistoryQuerySchema,
  questionDraftSchema,
  type AuthoringHistoryQueryInput,
  type QuestionDraftInput,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { AuthoringService } from '../src/questions/authoring.service';
import { QuestionsService } from '../src/questions/questions.service';
import { FakeRedis, FakeStorage } from '../test/support/fakes';
import {
  BANK,
  makeBankQuestion,
  makeCatalog,
  makeQuestionBank,
  makeSection,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const MINE = randomUUID();
const THEIRS = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

type Seeded = Omit<Parameters<typeof makeBankQuestion>[1], 'subjectId'>;

async function build(seeded: Seeded[] = []) {
  await makeQuestionBank(prisma, { [MINE]: 'Mine', [THEIRS]: 'Theirs' });
  for (const question of seeded) {
    await makeBankQuestion(prisma, {
      subjectId: BANK.QUANT,
      topicId: BANK.ARITHMETIC,
      ...question,
    });
  }
  const questions = new QuestionsService(prisma, new AuditContext(), new FakeStorage() as never);
  return new AuthoringService(prisma, new FakeRedis().asService(), questions);
}

const draft = (over: Partial<QuestionDraftInput> = {}) =>
  questionDraftSchema.parse({
    subjectId: BANK.QUANT,
    topicId: BANK.ARITHMETIC,
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    stem: { en: 'What is 20% of 150?' },
    options: [
      { position: 1, isCorrect: false, text: { en: '25' } },
      { position: 2, isCorrect: true, text: { en: '30' } },
      { position: 3, isCorrect: false, text: { en: '35' } },
      { position: 4, isCorrect: false, text: { en: '40' } },
    ],
    ...over,
  });

const query = (over: AuthoringHistoryQueryInput = {}) => authoringHistoryQuerySchema.parse(over);

async function makeAssignment(assigneeId: string) {
  const catalog = await makeCatalog(prisma);
  const test = await makeTest(prisma, catalog);
  const section = await makeSection(prisma, catalog);
  return prisma.questionAssignment.create({
    data: {
      id: uid(),
      testId: test.id,
      baseConfigId: catalog.baseConfigId,
      baseConfigSectionId: section.id,
      assigneeId,
      role: ASSIGNMENT_ROLES.TYPIST,
    },
    select: { id: true },
  });
}

const refusedWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

describe('AuthoringService.create', () => {
  it('writes the question and its first version, credited to the author', async () => {
    const authoring = await build();

    const { question } = await authoring.create(draft(), MINE);

    assert.equal(question.status, QUESTION_STATUS.ACTIVE);
    assert.equal(question.version, 1);
    const row = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    assert.equal(row.createdById, MINE);
    assert.equal(await prisma.questionVersion.count(), 1);
  });

  /** The bug this closes: the screen wrote the row and mentioned the duplicate afterwards. */
  it('refuses a question the bank already holds', async () => {
    const authoring = await build();
    const first = await authoring.create(draft(), MINE);

    await assert.rejects(
      () => authoring.create(draft(), MINE),
      (error: AppException) => error.code === ErrorCodes.CONFLICT,
    );

    assert.equal(await prisma.question.count(), 1);
    assert.ok(first.question.id);
  });

  it('names the question a draft repeats, before anything is written', async () => {
    const authoring = await build();
    const first = await authoring.create(draft(), MINE);

    const found = await authoring.duplicateFor(questionDraftSchema.parse(draft()), null);

    assert.equal(found?.id, first.question.id);
    assert.equal(found?.stemPreview, 'What is 20% of 150?');
    assert.equal(await prisma.question.count(), 1);
  });

  /** An edit is not its own duplicate, or nobody could ever save a question twice. */
  it('does not call a question a repeat of itself', async () => {
    const authoring = await build();
    const first = await authoring.create(draft(), MINE);

    const found = await authoring.duplicateFor(
      questionDraftSchema.parse(draft()),
      first.question.id,
    );

    assert.equal(found, null);
  });

  it('says nothing about a duplicate when there is not one', async () => {
    const authoring = await build();

    assert.equal((await authoring.create(draft(), MINE)).duplicateOf, null);
  });

  it('refuses a question the shared rules refuse, on the same codes', async () => {
    const authoring = await build();

    await assert.rejects(
      () => authoring.create(draft({ stem: {} }), MINE),
      (error: unknown) =>
        refusedWith(ErrorCodes.VALIDATION_ERROR)(error) &&
        AppException.is(error) &&
        Boolean(error.fieldErrors?.['stem.en']),
    );
  });
});

describe('AuthoringService.create — assignment provenance', () => {
  it('ties a created question to the caller’s own assignment', async () => {
    const authoring = await build();
    const assignment = await makeAssignment(MINE);

    const { question } = await authoring.create(draft(), MINE, assignment.id);

    const row = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    assert.equal(row.assignmentId, assignment.id);
  });

  /** Not theirs reads as not there: the same guard `finalize` uses on the assignment itself. */
  it('refuses an assignment that is not the caller’s own', async () => {
    const authoring = await build();
    const assignment = await makeAssignment(THEIRS);

    await assert.rejects(
      () => authoring.create(draft(), MINE, assignment.id),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
    assert.equal(await prisma.question.count(), 0);
  });

  /** The override: a super admin types into a section whoever holds it, or nobody does. */
  it('lets a super admin write against an assignment that is not theirs', async () => {
    const authoring = await build();
    const assignment = await makeAssignment(THEIRS);

    const { question } = await authoring.create(draft(), MINE, assignment.id, true);

    const row = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    assert.equal(row.assignmentId, assignment.id);
  });
});

describe('AuthoringService.release', () => {
  /** The failure this prevents: a reader given every keystroke as it lands, with no way to tell. */
  it('hands over everything not yet handed over, and counts only what moved', async () => {
    const authoring = await build();
    const assignment = await makeAssignment(MINE);
    const first = await authoring.create(draft(), MINE, assignment.id);

    const once = await authoring.release(assignment.id, MINE);
    const second = await authoring.create(
      draft({ stem: { en: 'Written after the hand-over' } }),
      MINE,
      assignment.id,
    );
    const twice = await authoring.release(assignment.id, MINE);

    assert.deepEqual(once, { handedOver: 1, released: 1 });
    assert.deepEqual(twice, { handedOver: 1, released: 2 }, 'the first one does not move again');

    const rows = await prisma.question.findMany({
      where: { id: { in: [first.question.id, second.question.id] } },
      select: { releasedAt: true },
    });
    assert.ok(rows.every((row) => row.releasedAt !== null));
  });

  it('refuses an assignment that is not the caller’s own', async () => {
    const authoring = await build();
    const assignment = await makeAssignment(THEIRS);

    await assert.rejects(
      () => authoring.release(assignment.id, MINE),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('AuthoringService.remove', () => {
  /** Typing twenty-five for a target of twenty and dropping five is the point of this. */
  it('deletes a question the caller wrote', async () => {
    const authoring = await build();
    const assignment = await makeAssignment(MINE);
    const { question } = await authoring.create(draft(), MINE, assignment.id);

    await authoring.remove(question.id, MINE);

    assert.equal(await prisma.question.count({ where: { id: question.id } }), 0);
  });

  it('refuses a question somebody else wrote', async () => {
    const authoring = await build();
    const assignment = await makeAssignment(MINE);
    const { question } = await authoring.create(draft(), MINE, assignment.id);

    await assert.rejects(
      () => authoring.remove(question.id, THEIRS),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
    assert.equal(await prisma.question.count({ where: { id: question.id } }), 1);
  });
});

describe('AuthoringService.history', () => {
  it("shows the author their own work and nobody else's", async () => {
    const qstMine = randomUUID();
    const authoring = await build([
      { id: qstMine, createdById: MINE },
      { id: randomUUID(), createdById: THEIRS },
      { id: randomUUID() },
    ]);

    const page = await authoring.history(query(), MINE);

    assert.deepEqual(
      page.items.map((row) => row.id),
      [qstMine],
    );
    assert.equal(page.total, 1);
  });

  it('lists the archived too, which the bank hides — it is a record of what was written', async () => {
    const authoring = await build([
      { id: randomUUID(), createdById: MINE, status: QUESTION_STATUS.ACTIVE },
      { id: randomUUID(), createdById: MINE, status: QUESTION_STATUS.ARCHIVED },
    ]);

    assert.equal((await authoring.history(query(), MINE)).total, 2);
  });

  it('narrows to one state when the reader names one', async () => {
    const qst1 = randomUUID();
    const authoring = await build([
      { id: qst1, createdById: MINE, status: QUESTION_STATUS.ARCHIVED },
      { id: randomUUID(), createdById: MINE, status: QUESTION_STATUS.ACTIVE },
    ]);

    const page = await authoring.history(query({ status: QUESTION_STATUS.ARCHIVED }), MINE);

    assert.deepEqual(
      page.items.map((row) => row.id),
      [qst1],
    );
  });

  /** The section is how a typist finds one batch again out of everything they have written. */
  it('narrows to the questions written for one assignment', async () => {
    const authoring = await build();
    const mine = await makeAssignment(MINE);
    const other = await makeAssignment(MINE);
    const { question } = await authoring.create(draft(), MINE, mine.id);
    await authoring.create(
      draft({ stem: { en: 'A different question entirely?' } }),
      MINE,
      other.id,
    );

    const page = await authoring.history(query({ assignmentId: mine.id }), MINE);

    assert.deepEqual(
      page.items.map((row) => row.id),
      [question.id],
    );
  });

  /** The work record names the test a question was typed for, not just the section. */
  it('carries the test a question was written for', async () => {
    const authoring = await build();
    const mine = await makeAssignment(MINE);
    await authoring.create(draft(), MINE, mine.id);

    const [row] = (await authoring.history(query(), MINE)).items;

    assert.equal(row?.writtenFor?.testId !== undefined, true);
    assert.equal(typeof row?.writtenFor?.sectionName, 'string');
  });

  it('says nothing was written for when a question was typed outside a section', async () => {
    const authoring = await build();
    await authoring.create(draft(), MINE);

    const [row] = (await authoring.history(query(), MINE)).items;

    assert.equal(row?.writtenFor, null);
  });

  /** A test may hold several sections, so filtering by it is wider than filtering by one. */
  it('narrows to every section of one test', async () => {
    const authoring = await build();
    const mine = await makeAssignment(MINE);
    const elsewhere = await makeAssignment(MINE);
    const { question } = await authoring.create(draft(), MINE, mine.id);
    await authoring.create(
      draft({ stem: { en: 'Written for another test entirely?' } }),
      MINE,
      elsewhere.id,
    );

    const testId = (await prisma.questionAssignment.findUniqueOrThrow({ where: { id: mine.id } }))
      .testId;
    const page = await authoring.history(query({ testId }), MINE);

    assert.deepEqual(
      page.items.map((row) => row.id),
      [question.id],
    );
  });

  it('reads no assignment asked for as every assignment', async () => {
    const authoring = await build();
    const one = await makeAssignment(MINE);
    await authoring.create(draft(), MINE, one.id);
    await authoring.create(draft({ stem: { en: 'Written outside any section?' } }), MINE);

    assert.equal((await authoring.history(query(), MINE)).total, 2);
  });

  it('searches inside the author’s own rows, never past them', async () => {
    const authoring = await build();
    await authoring.create(draft(), MINE);
    await authoring.create(draft({ stem: { en: 'Who wrote the Constitution?' } }), THEIRS);

    const mine = await authoring.history(query({ q: 'Constitution' }), MINE);
    const theirs = await authoring.history(query({ q: 'Constitution' }), THEIRS);

    assert.equal(mine.total, 0);
    assert.equal(theirs.total, 1);
  });
});

describe('editing from the authoring screen', () => {
  it("will neither open nor change another author's question", async () => {
    const qst1 = randomUUID();
    const authoring = await build([{ id: qst1, createdById: THEIRS }]);

    await assert.rejects(() => authoring.detail(qst1, MINE), refusedWith(ErrorCodes.NOT_FOUND));
    await assert.rejects(
      () => authoring.update(qst1, draft(), MINE),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  it('revises the author’s own question in place while nothing reachable pins it', async () => {
    const authoring = await build();
    const created = await authoring.create(draft(), MINE);

    const { question } = await authoring.update(
      created.question.id,
      draft({ stem: { en: 'What is 20% of 250?' } }),
      MINE,
    );

    assert.equal(question.version, 1);
    assert.equal(question.status, QUESTION_STATUS.ACTIVE);
    assert.equal(await prisma.questionVersion.count(), 1);
  });
});

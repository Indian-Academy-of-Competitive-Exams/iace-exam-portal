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
import { FakeStorage } from '../test/support/fakes';
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
  return new AuthoringService(prisma, questions);
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

const refusedWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

describe('AuthoringService.create', () => {
  it('writes a DRAFT question and its first version, credited to the author', async () => {
    const authoring = await build();

    const { question } = await authoring.create(draft(), MINE);

    assert.equal(question.status, QUESTION_STATUS.DRAFT);
    assert.equal(question.version, 1);
    const row = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    assert.equal(row.createdById, MINE);
    assert.equal(await prisma.questionVersion.count(), 1);
  });

  it('lands as a DRAFT even when the body asks for something else', async () => {
    const authoring = await build();

    const { question } = await authoring.create(draft({ status: QUESTION_STATUS.ACTIVE }), MINE);

    assert.equal(question.status, QUESTION_STATUS.DRAFT);
  });

  it('reports a near-duplicate and writes it anyway, unlike the bank', async () => {
    const authoring = await build();
    const first = await authoring.create(draft(), MINE);

    const second = await authoring.create(draft(), MINE);

    assert.equal(second.duplicateOf?.id, first.question.id);
    assert.equal(second.duplicateOf?.stemPreview, 'What is 20% of 150?');
    assert.notEqual(second.question.id, first.question.id);
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

describe('AuthoringService.history', () => {
  it("shows the author their own work and nobody else's", async () => {
    const qstMine = randomUUID();
    const authoring = await build([
      { id: qstMine, createdById: MINE, status: QUESTION_STATUS.DRAFT },
      { id: randomUUID(), createdById: THEIRS, status: QUESTION_STATUS.DRAFT },
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
      { id: randomUUID(), createdById: MINE, status: QUESTION_STATUS.DRAFT },
      { id: randomUUID(), createdById: MINE, status: QUESTION_STATUS.ARCHIVED },
    ]);

    assert.equal((await authoring.history(query(), MINE)).total, 2);
  });

  it('narrows to one state when the reader names one', async () => {
    const qst1 = randomUUID();
    const authoring = await build([
      { id: qst1, createdById: MINE, status: QUESTION_STATUS.DRAFT },
      { id: randomUUID(), createdById: MINE, status: QUESTION_STATUS.ACTIVE },
    ]);

    const page = await authoring.history(query({ status: QUESTION_STATUS.DRAFT }), MINE);

    assert.deepEqual(
      page.items.map((row) => row.id),
      [qst1],
    );
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
    const authoring = await build([
      { id: qst1, createdById: THEIRS, status: QUESTION_STATUS.DRAFT },
    ]);

    await assert.rejects(() => authoring.detail(qst1, MINE), refusedWith(ErrorCodes.NOT_FOUND));
    await assert.rejects(
      () => authoring.update(qst1, draft(), MINE),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  it('hands a question that has left review back to the question bank', async () => {
    const qst1 = randomUUID();
    const authoring = await build([
      { id: qst1, createdById: MINE, status: QUESTION_STATUS.ACTIVE },
    ]);

    await assert.rejects(
      () => authoring.update(qst1, draft(), MINE),
      refusedWith(ErrorCodes.CONFLICT),
    );
  });

  it('revises the author’s own draft in place', async () => {
    const authoring = await build();
    const created = await authoring.create(draft(), MINE);

    const { question } = await authoring.update(
      created.question.id,
      draft({ stem: { en: 'What is 20% of 250?' } }),
      MINE,
    );

    assert.equal(question.version, 1);
    assert.equal(question.status, QUESTION_STATUS.DRAFT);
    assert.equal(await prisma.questionVersion.count(), 1);
  });
});

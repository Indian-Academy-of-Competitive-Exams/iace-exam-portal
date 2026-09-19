import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ASSIGNMENT_ROLES,
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  QUESTION_FLAG_CATEGORY,
  QUESTION_FLAG_STATUS,
  QUESTION_STATUS,
  plainTextOf,
  questionDraftSchema,
  questionListQuerySchema,
  type AssignmentRole,
  type QuestionDraftInput,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { ProofreadingService } from '../src/questions/proofreading.service';
import { QuestionsService } from '../src/questions/questions.service';
import { FakeStorage } from '../test/support/fakes';
import {
  BANK,
  makeCatalog,
  makeQuestion,
  makeQuestionBank,
  makeSection,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
  type Catalog,
} from './support/database';

const REVIEWER = randomUUID();
const AUTHOR = randomUUID();
const STRANGER = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

async function build() {
  await makeQuestionBank(prisma, {
    [REVIEWER]: 'Reviewer',
    [AUTHOR]: 'Author',
    [STRANGER]: 'Stranger',
  });
  const questions = new QuestionsService(prisma, new AuditContext(), new FakeStorage() as never);
  return { questions, proofreading: new ProofreadingService(prisma, questions) };
}

function draft(over: Partial<QuestionDraftInput> = {}) {
  return questionDraftSchema.parse({
    subjectId: BANK.QUANT,
    topicId: BANK.ARITHMETIC,
    difficulty: DIFFICULTY_LEVEL.MEDIUM,
    stem: { en: 'What is 20% of 150?', hi: '150 का 20% कितना है?' },
    options: [
      { position: 1, isCorrect: false, text: { en: '25', hi: '25' } },
      { position: 2, isCorrect: true, text: { en: '30', hi: '30' } },
      { position: 3, isCorrect: false, text: { en: '35', hi: '35' } },
      { position: 4, isCorrect: false, text: { en: '40', hi: '40' } },
    ],
    ...over,
  });
}

const aLiveOne = () =>
  draft({
    status: QUESTION_STATUS.ACTIVE,
    stem: { en: 'What is 25% of 200?', hi: '200 का 25% कितना है?' },
  });

const anyQuestion = questionListQuerySchema.parse({});

const refusedWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

const assign = (
  catalog: Catalog,
  testId: string,
  baseConfigSectionId: string,
  assigneeId: string,
  role: AssignmentRole,
) =>
  prisma.questionAssignment.create({
    data: {
      testId,
      baseConfigId: catalog.baseConfigId,
      baseConfigSectionId,
      assigneeId,
      role,
    },
    select: { id: true },
  });

const pickOntoPaper = (
  catalog: Catalog,
  testId: string,
  baseConfigSectionId: string,
  question: { id: string; versionId: string },
  order: number,
) =>
  prisma.paperQuestion.create({
    data: {
      id: uid(),
      testId,
      baseConfigId: catalog.baseConfigId,
      baseConfigSectionId,
      questionId: question.id,
      questionVersionId: question.versionId,
      order,
      marks: 2,
      negativeMarks: 0.5,
    },
    select: { id: true },
  });

/** A test whose Reasoning section has a typist and a reader, and a Quant section beside it. */
async function aSection() {
  const catalog = await makeCatalog(prisma);
  const test = await makeTest(prisma, catalog);
  const mine = await makeSection(prisma, catalog, { name: 'Reasoning', order: 1 });
  const other = await makeSection(prisma, catalog, { name: 'Quant', order: 2 });
  const typing = await assign(catalog, test.id, mine.id, AUTHOR, ASSIGNMENT_ROLES.TYPIST);
  const reading = await assign(catalog, test.id, mine.id, REVIEWER, ASSIGNMENT_ROLES.PROOFREADER);
  return {
    catalog,
    testId: test.id,
    sectionId: mine.id,
    otherSectionId: other.id,
    typing,
    reading,
  };
}

describe('ProofreadingService.document', () => {
  it('hands back each question in full, with every flag raised on it', async () => {
    const { proofreading, questions } = await build();
    const created = await questions.create(draft(), AUTHOR);
    await proofreading.raise(
      created.id,
      { category: QUESTION_FLAG_CATEGORY.INVALID, comment: 'The answer key is wrong.' },
      REVIEWER,
    );

    const page = await proofreading.document(anyQuestion);

    const [question] = page.items;
    assert.equal(page.total, 1);
    assert.deepEqual(question?.languages, ['en', 'hi']);
    assert.equal(question?.options.length, 4);
    assert.equal(question?.flags.length, 1);
    assert.equal(question?.flags[0]?.raisedBy?.name, 'Reviewer');
  });

  /** A reviewer reads the whole question, answer key included — this is not an attempt. */
  it('carries the answer through, so a reviewer reads what a candidate never sees', async () => {
    const { proofreading, questions } = await build();
    await questions.create(draft({ solution: { en: '150 × 0.2 = 30.' } }), AUTHOR);

    const [question] = (await proofreading.document(anyQuestion)).items;

    assert.ok(question?.options.some((option) => option.isCorrect));
    assert.ok(question?.content.en?.solution);
  });

  it('narrows to the filtered selection rather than the whole bank', async () => {
    const { proofreading, questions } = await build();
    await questions.create(draft(), AUTHOR);
    await questions.create(aLiveOne(), AUTHOR);

    const page = await proofreading.document(
      questionListQuerySchema.parse({ status: QUESTION_STATUS.DRAFT }),
    );

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.status, QUESTION_STATUS.DRAFT);
  });

  /** A reader's flags gate ACTIVATION, so a live question is past the point their reading changes. */
  it('leaves a live question out even when nothing was filtered', async () => {
    const { proofreading, questions } = await build();
    await questions.create(draft(), AUTHOR);
    await questions.create(aLiveOne(), AUTHOR);

    const page = await proofreading.document(anyQuestion);

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.status, QUESTION_STATUS.DRAFT);
  });

  /** Forced rather than filtered: a hand-edited URL must not widen the document. */
  it('leaves a live question out even when the query asks for one', async () => {
    const { proofreading, questions } = await build();
    await questions.create(aLiveOne(), AUTHOR);

    const page = await proofreading.document(
      questionListQuerySchema.parse({ status: QUESTION_STATUS.ACTIVE }),
    );

    assert.equal(page.total, 0);
  });
});

describe('ProofreadingService — raising and settling', () => {
  it('pins the version the reviewer was reading', async () => {
    const { proofreading, questions } = await build();
    const created = await questions.create(draft(), AUTHOR);

    const raised = await proofreading.raise(
      created.id,
      { category: QUESTION_FLAG_CATEGORY.INVALID, comment: 'The key is wrong.' },
      REVIEWER,
    );

    assert.equal(raised.status, QUESTION_FLAG_STATUS.OPEN);
    assert.equal(raised.onCurrentVersion, true);
    const row = await prisma.questionFlag.findUniqueOrThrow({ where: { id: raised.id } });
    const question = await prisma.question.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.versionId, question.currentVersionId);
  });

  it('records who settled it and when', async () => {
    const { proofreading, questions } = await build();
    const created = await questions.create(draft(), AUTHOR);
    const raised = await proofreading.raise(
      created.id,
      { category: QUESTION_FLAG_CATEGORY.OTHER, comment: 'Check the units.' },
      REVIEWER,
    );

    const settled = await proofreading.settle(
      raised.id,
      { status: QUESTION_FLAG_STATUS.RESOLVED },
      REVIEWER,
    );

    assert.equal(settled.status, QUESTION_FLAG_STATUS.RESOLVED);
    assert.equal(settled.resolvedBy?.name, 'Reviewer');
    assert.ok(settled.resolvedAt);
    const row = await prisma.questionFlag.findUniqueOrThrow({ where: { id: raised.id } });
    assert.equal(row.status, QUESTION_FLAG_STATUS.RESOLVED);
  });

  /** Two reviewers on one document: the second answer must not overwrite the first. */
  it('refuses to settle a flag somebody has already settled', async () => {
    const { proofreading, questions } = await build();
    const created = await questions.create(draft(), AUTHOR);
    const raised = await proofreading.raise(
      created.id,
      { category: QUESTION_FLAG_CATEGORY.TOO_DIFFICULT, comment: 'Out of scope.' },
      REVIEWER,
    );
    await proofreading.settle(raised.id, { status: QUESTION_FLAG_STATUS.DISMISSED }, REVIEWER);

    await assert.rejects(
      () => proofreading.settle(raised.id, { status: QUESTION_FLAG_STATUS.RESOLVED }, REVIEWER),
      refusedWith(ErrorCodes.CONFLICT),
    );
  });

  it('refuses a flag on a question that is not there', async () => {
    const { proofreading } = await build();

    await assert.rejects(
      () =>
        proofreading.raise(
          randomUUID(),
          { category: QUESTION_FLAG_CATEGORY.OTHER, comment: 'Nothing to read.' },
          REVIEWER,
        ),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('ProofreadingService.forAssignment', () => {
  it('hands back what the section typed and what its paper picked, and nothing else', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();

    const written = await questions.create(draft(), AUTHOR, { assignmentId: section.typing.id });
    const picked = await makeQuestion(prisma, {
      subjectId: BANK.QUANT,
      stem: 'Picked from the bank',
    });
    await pickOntoPaper(section.catalog, section.testId, section.sectionId, picked, 1);
    const elsewhere = await makeQuestion(prisma, {
      subjectId: BANK.QUANT,
      stem: 'Another section',
    });
    await pickOntoPaper(section.catalog, section.testId, section.otherSectionId, elsewhere, 2);
    await questions.create(
      draft({ stem: { en: 'Loose in the bank', hi: 'बैंक में खुला' } }),
      AUTHOR,
    );

    const rows = await proofreading.forAssignment(section.reading.id, REVIEWER);

    assert.deepEqual(rows.map((row) => row.id).sort(), [written.id, picked.id].sort());
  });

  it('carries the flags raised on the section, the way the bank-wide document does', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await questions.create(draft(), AUTHOR, { assignmentId: section.typing.id });
    await proofreading.raise(
      written.id,
      { category: QUESTION_FLAG_CATEGORY.INVALID, comment: 'The key is wrong.' },
      REVIEWER,
    );

    const rows = await proofreading.forAssignment(section.reading.id, REVIEWER);

    assert.equal(rows[0]?.flags.length, 1);
    assert.equal(rows[0]?.flags[0]?.raisedBy?.name, 'Reviewer');
  });

  it("refuses another reader's assignment", async () => {
    const { proofreading } = await build();
    const section = await aSection();

    await assert.rejects(
      () => proofreading.forAssignment(section.reading.id, STRANGER),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  /** The override: a super admin is refused no section of their own institute. */
  it('hands a super admin the section it just refused a stranger', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await questions.create(draft(), AUTHOR, { assignmentId: section.typing.id });

    const rows = await proofreading.forAssignment(section.reading.id, STRANGER, true);

    assert.deepEqual(
      rows.map((row) => row.id),
      [written.id],
    );
  });

  /** Spec §11: reading a section is never checking your own typing, so a typist's row is not one. */
  it('refuses a typist their own row', async () => {
    const { proofreading } = await build();
    const section = await aSection();

    await assert.rejects(
      () => proofreading.forAssignment(section.typing.id, AUTHOR),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});

describe('ProofreadingService.editQuestion', () => {
  it('rewrites the version in place while no student can reach the test', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await questions.create(draft(), AUTHOR, { assignmentId: section.typing.id });
    const before = await prisma.question.findUniqueOrThrow({ where: { id: written.id } });

    const saved = await proofreading.editQuestion(
      section.reading.id,
      written.id,
      draft({ stem: { en: 'What is 20% of 250?', hi: '250 का 20% कितना है?' } }),
      REVIEWER,
    );

    assert.equal(saved.version, 1);
    assert.match(plainTextOf(saved.content.en?.stem), /250/);
    const after = await prisma.question.findUniqueOrThrow({ where: { id: written.id } });
    assert.equal(after.currentVersionId, before.currentVersionId);
    assert.equal(await prisma.questionVersion.count({ where: { questionId: written.id } }), 1);
  });

  /** Finalising is the end of the reader's authority over the section, not a label on it. */
  it('refuses the edit once the reader has marked the section read', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await questions.create(draft(), AUTHOR, { assignmentId: section.typing.id });
    await prisma.questionAssignment.update({
      where: { id: section.reading.id },
      data: { finalizedAt: new Date() },
    });

    await assert.rejects(
      () =>
        proofreading.editQuestion(
          section.reading.id,
          written.id,
          draft({ stem: { en: 'Too late to say so', hi: 'कहने में बहुत देर' } }),
          REVIEWER,
        ),
      refusedWith(ErrorCodes.CONFLICT),
    );
    const detail = await questions.detail(written.id);
    assert.match(plainTextOf(detail.content.en?.stem), /150/);
  });

  it('refuses a question that is on another section of the same test', async () => {
    const { proofreading } = await build();
    const section = await aSection();
    const elsewhere = await makeQuestion(prisma, {
      subjectId: BANK.QUANT,
      stem: 'Another section',
    });
    await pickOntoPaper(section.catalog, section.testId, section.otherSectionId, elsewhere, 1);

    await assert.rejects(
      () => proofreading.editQuestion(section.reading.id, elsewhere.id, draft(), REVIEWER),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  /** Reading a section is no route into the bank: approving stays the question bank's decision. */
  it('leaves the status where it found it', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await questions.create(draft(), AUTHOR, { assignmentId: section.typing.id });

    const saved = await proofreading.editQuestion(
      section.reading.id,
      written.id,
      draft({
        status: QUESTION_STATUS.ACTIVE,
        stem: { en: 'What is 20% of 350?', hi: '350 का 20% कितना है?' },
      }),
      REVIEWER,
    );

    assert.equal(saved.status, QUESTION_STATUS.DRAFT);
  });
});

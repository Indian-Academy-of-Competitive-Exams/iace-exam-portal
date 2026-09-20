import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ASSIGNMENT_ROLES,
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  QUESTION_STATUS,
  TEST_STATUS,
  plainTextOf,
  questionDraftSchema,
  type AssignmentRole,
  type QuestionDraftInput,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { ProofreadingService } from '../src/questions/proofreading.service';
import { QuestionsService } from '../src/questions/questions.service';
import { FakeRedis, FakeStorage } from '../test/support/fakes';
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
  const redis = new FakeRedis();
  return {
    questions,
    redis,
    proofreading: new ProofreadingService(prisma, redis.asService(), questions),
  };
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

/** Written and handed to the reader, which is the only state a reader sees a question in. */
async function handedOver(
  questions: QuestionsService,
  assignmentId: string,
  over: Parameters<typeof draft>[0] = {},
) {
  const written = await questions.create(draft(over), AUTHOR, { assignmentId });
  await prisma.question.update({
    where: { id: written.id },
    data: { releasedAt: new Date() },
  });
  return written;
}

describe('ProofreadingService.forAssignment', () => {
  it('hands back what the section typed and what its paper picked, and nothing else', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();

    const written = await handedOver(questions, section.typing.id);
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

  /** The failure this prevents: a reader opening a section mid-morning and reading half-typed work. */
  it('holds back what its typist has not handed over yet', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const handed = await handedOver(questions, section.typing.id);
    const stillTyping = await questions.create(
      draft({ stem: { en: 'Half written', hi: 'आधा लिखा' } }),
      AUTHOR,
      { assignmentId: section.typing.id },
    );

    const rows = await proofreading.forAssignment(section.reading.id, REVIEWER);

    assert.deepEqual(
      rows.map((row) => row.id),
      [handed.id],
      'the unreleased one is not the reader’s to see yet',
    );
    assert.equal(
      (await proofreading.forAssignment(section.reading.id, STRANGER, true)).length,
      2,
      'a super admin sees the section whole, handed over or not',
    );
    assert.ok(stillTyping.id);
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
    const written = await handedOver(questions, section.typing.id);

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

describe('ProofreadingService.oneFor', () => {
  /** The failure this prevents: a section's id used as a key to read any question in the bank. */
  it('hands back one question of the section it was opened on', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await handedOver(questions, section.typing.id);

    const one = await proofreading.oneFor(section.reading.id, written.id, REVIEWER);

    assert.equal(one.id, written.id);
  });

  it('refuses a question that is not in that section', async () => {
    const { proofreading } = await build();
    const section = await aSection();
    const loose = await makeQuestion(prisma, { subjectId: BANK.QUANT, stem: 'Loose in the bank' });

    await assert.rejects(
      () => proofreading.oneFor(section.reading.id, loose.id, REVIEWER),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  it('reads the same question by the section’s own pair, for a super admin', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await handedOver(questions, section.typing.id);

    const one = await proofreading.oneInSection(section.testId, section.sectionId, written.id);

    assert.equal(one.id, written.id);
  });
});

describe('ProofreadingService.editQuestion', () => {
  it('rewrites the version in place while no student can reach the test', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await handedOver(questions, section.typing.id);
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
    const written = await handedOver(questions, section.typing.id);
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

  /** Reading a section is no route into the bank: retiring stays the question bank's decision. */
  it('leaves the status where it found it', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await handedOver(questions, section.typing.id);
    await questions.archive(written.id);

    const saved = await proofreading.editQuestion(
      section.reading.id,
      written.id,
      draft({
        status: QUESTION_STATUS.ACTIVE,
        stem: { en: 'What is 20% of 350?', hi: '350 का 20% कितना है?' },
      }),
      REVIEWER,
    );

    assert.equal(saved.status, QUESTION_STATUS.ARCHIVED);
  });
});

/** Spec §8: the warning has to NAME what else holds the question, and it has to do it before the edit. */
describe('ProofreadingService.otherTests', () => {
  const currentVersionOf = async (questionId: string) => {
    const row = await prisma.question.findUniqueOrThrow({
      where: { id: questionId },
      select: { currentVersionId: true },
    });
    return { id: questionId, versionId: row.currentVersionId ?? '' };
  };

  it('names the other test holding the question, its review state and that it has opened', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await handedOver(questions, section.typing.id);

    const opened = new Date(Date.now() - 60_000);
    const live = await makeTest(prisma, section.catalog, {
      title: 'Grand Test 4',
      status: TEST_STATUS.ACTIVE,
      opensAt: opened,
    });
    const liveSection = await makeSection(prisma, section.catalog, {
      name: 'Reasoning again',
      order: 3,
    });
    await assign(section.catalog, live.id, liveSection.id, REVIEWER, ASSIGNMENT_ROLES.PROOFREADER);
    await pickOntoPaper(
      section.catalog,
      live.id,
      liveSection.id,
      await currentVersionOf(written.id),
      1,
    );

    const rows = await proofreading.otherTests(section.reading.id, written.id, REVIEWER);

    assert.deepEqual(rows, [
      {
        testId: live.id,
        testTitle: 'Grand Test 4',
        sectionName: 'Reasoning again',
        underReview: true,
        isOpen: true,
        opensAt: opened.toISOString(),
      },
    ]);
  });

  /** Nothing else holds it, so there is nothing to warn about — which is what makes the Alert conditional. */
  it('leaves out the reader’s own test and says nothing when no other holds it', async () => {
    const { proofreading, questions } = await build();
    const section = await aSection();
    const written = await handedOver(questions, section.typing.id);
    await pickOntoPaper(
      section.catalog,
      section.testId,
      section.sectionId,
      await currentVersionOf(written.id),
      1,
    );

    assert.deepEqual(await proofreading.otherTests(section.reading.id, written.id, REVIEWER), []);
  });
});

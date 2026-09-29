import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ASSIGNMENT_ROLES,
  AppException,
  PAPER_SOURCES,
  SEND_BACK_REASONS,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  plainTextOf,
  questionDraftSchema,
  type AssignmentRole,
  type QuestionDraftInput,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { AuthoringService } from '../src/questions/authoring.service';
import { AdminsService } from '../src/admins/admins.service';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { SectionWorkService, type SectionViewer } from '../src/questions/section-work.service';
import { QuestionsService } from '../src/questions/questions.service';
import { EDIT_LOCK_TTL_SEC } from '../src/redis/redis.keys';
import { FakeEventBus, FakeRedis, FakeStorage } from '../test/support/fakes';
import {
  BANK,
  makeCatalog,
  makeQuestionBank,
  makeSection,
  makeTest,
  resetDatabase,
  testPrisma,
  type Catalog,
} from './support/database';

/** One claim per (test, section): both roles write the same rows, and a super admin stands it down. */

const TYPIST = randomUUID();
const READER = randomUUID();
const CHIEF = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

async function build() {
  await makeQuestionBank(prisma, {
    [TYPIST]: 'Anita',
    [READER]: 'Bhaskar',
    [CHIEF]: 'Chandra',
  });
  const audit = new AuditContext();
  const questions = new QuestionsService(prisma, audit, new FakeStorage() as never);
  const redis = new FakeRedis();
  const admins = new AdminsService(prisma, audit, new FakeEventBus().asService());
  const assignments = new AssignmentsService(prisma, redis.asService(), admins);
  return {
    redis,
    questions,
    authoring: new AuthoringService(prisma, redis.asService(), questions),
    work: new SectionWorkService(prisma, redis.asService(), questions, assignments),
  };
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

const viewer = (id: string, isSuperAdmin = false): SectionViewer => ({
  id,
  isActive: true,
  isSuperAdmin,
  permissions: {},
});

const pairOf = (section: { testId: string; sectionId: string }) => ({
  testId: section.testId,
  baseConfigSectionId: section.sectionId,
});

const assign = (
  catalog: Catalog,
  testId: string,
  baseConfigSectionId: string,
  assigneeId: string,
  role: AssignmentRole,
) =>
  prisma.questionAssignment.create({
    data: { testId, baseConfigId: catalog.baseConfigId, baseConfigSectionId, assigneeId, role },
    select: { id: true },
  });

/** A Reasoning section with a typist on it, and a reader only where the case calls for one. */
async function aSection({ withReader = true } = {}) {
  const catalog = await makeCatalog(prisma);
  const test = await makeTest(prisma, catalog, { paperSource: PAPER_SOURCES.FRAMED });
  const reasoning = await makeSection(prisma, catalog, { name: 'Reasoning', order: 1 });
  const quant = await makeSection(prisma, catalog, { name: 'Quant', order: 2 });
  const typing = await assign(catalog, test.id, reasoning.id, TYPIST, ASSIGNMENT_ROLES.TYPIST);
  const reading = withReader
    ? await assign(catalog, test.id, reasoning.id, READER, ASSIGNMENT_ROLES.PROOFREADER)
    : null;
  return {
    catalog,
    testId: test.id,
    sectionId: reasoning.id,
    otherSectionId: quant.id,
    typing,
    reading,
  };
}

/** The typist's Done, reduced to its effect: the question on the paper and the section handed over. */
async function markDone(section: Awaited<ReturnType<typeof aSection>>, question: { id: string }) {
  const row = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
  await prisma.paperQuestion.create({
    data: {
      testId: section.testId,
      baseConfigId: section.catalog.baseConfigId,
      baseConfigSectionId: section.sectionId,
      questionId: question.id,
      questionVersionId: row.currentVersionId ?? '',
      order: 1,
      marks: 2,
      negativeMarks: 0.5,
    },
  });
  await prisma.questionAssignment.update({
    where: { id: section.typing.id },
    data: { finalizedAt: new Date() },
  });
  if (section.reading) {
    await prisma.questionAssignment.update({
      where: { id: section.reading.id },
      data: { handedAt: new Date() },
    });
  }
}

/** The reader's send-back, reduced to its row: the one thing that reopens a question to its typist. */
const sentBack = (section: Awaited<ReturnType<typeof aSection>>, questionId: string) =>
  prisma.questionReview.create({
    data: {
      testId: section.testId,
      baseConfigSectionId: section.sectionId,
      questionId,
      sentBackAt: new Date(),
      reason: SEND_BACK_REASONS.SPELLING,
    },
  });

const conflictSaying = (words: string) => (error: unknown) =>
  AppException.is(error) && error.code === ErrorCodes.CONFLICT && error.message.includes(words);

const refusedWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

describe('the section edit lock', () => {
  it('names whoever is already in the section rather than just refusing', async () => {
    const { authoring, work } = await build();
    const section = await aSection();
    const written = await authoring.create(draft(), TYPIST, section.typing.id);
    await markDone(section, written.question);

    await assert.rejects(
      () =>
        work.edit(
          pairOf(section),
          written.question.id,
          draft({ stem: { en: 'The reader’s fix' } }),
          viewer(READER),
        ),
      conflictSaying('Anita'),
    );
  });

  it('lets the holder back in, and their fifteen minutes start again', async () => {
    const { authoring, work } = await build();
    const section = await aSection();
    const written = await authoring.create(draft(), TYPIST, section.typing.id);

    const again = await work.edit(
      pairOf(section),
      written.question.id,
      draft({ stem: { en: 'What is 25% of 200?' } }),
      viewer(TYPIST),
    );

    assert.equal(again.id, written.question.id);
  });

  it('hands it to a super admin, who then holds it against the admin who had it', async () => {
    const { authoring, work } = await build();
    const section = await aSection();
    const written = await authoring.create(draft(), TYPIST, section.typing.id);
    await markDone(section, written.question);
    await sentBack(section, written.question.id);

    const stolen = await work.edit(
      pairOf(section),
      written.question.id,
      draft({ stem: { en: 'A super admin’s fix' } }),
      viewer(CHIEF, true),
    );
    assert.equal(stolen.id, written.question.id);

    await assert.rejects(
      () =>
        work.edit(
          pairOf(section),
          written.question.id,
          draft({ stem: { en: 'Mine again' } }),
          viewer(TYPIST),
        ),
      conflictSaying('Chandra'),
    );
  });

  it('lapses once nobody has written in the section for fifteen minutes', async () => {
    const { authoring, work, redis } = await build();
    const section = await aSection();
    const written = await authoring.create(draft(), TYPIST, section.typing.id);
    await markDone(section, written.question);

    redis.advanceSeconds(EDIT_LOCK_TTL_SEC + 1);

    const fixed = await work.edit(
      pairOf(section),
      written.question.id,
      draft({ stem: { en: 'The reader’s fix' } }),
      viewer(READER),
    );
    assert.equal(fixed.id, written.question.id);
  });
});

describe('SectionWorkService — a section nobody was given to read', () => {
  it('opens to a super admin', async () => {
    const { authoring, work } = await build();
    const section = await aSection({ withReader: false });
    const written = await authoring.create(draft(), TYPIST, section.typing.id);
    await markDone(section, written.question);

    const opened = await work.one(pairOf(section), viewer(CHIEF, true));

    assert.deepEqual(
      opened.questions.map((row) => row.questionId),
      [written.question.id],
    );
  });

  it('fixes a question through that section, and keeps its status', async () => {
    const { authoring, work } = await build();
    const section = await aSection({ withReader: false });
    const written = await authoring.create(draft(), TYPIST, section.typing.id);
    await markDone(section, written.question);

    const fixed = await work.edit(
      pairOf(section),
      written.question.id,
      draft({ stem: { en: 'What is 25% of 200?' } }),
      viewer(CHIEF, true),
    );

    assert.equal(fixed.status, written.question.status);
    assert.match(plainTextOf(fixed.content.en?.stem), /25% of 200/);
  });

  /** The section is no licence to reach the bank through it. */
  it('refuses a question that is not in the section named', async () => {
    const { authoring, work } = await build();
    const section = await aSection({ withReader: false });
    const written = await authoring.create(draft(), TYPIST, section.typing.id);

    await assert.rejects(
      () =>
        work.edit(
          { testId: section.testId, baseConfigSectionId: section.otherSectionId },
          written.question.id,
          draft(),
          viewer(CHIEF, true),
        ),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  it('refuses a section that is not on the test named', async () => {
    const { work } = await build();
    const section = await aSection({ withReader: false });
    const elsewhere = await makeCatalog(prisma);
    const stray = await makeSection(prisma, elsewhere, { name: 'Stray', order: 1 });

    await assert.rejects(
      () =>
        work.one({ testId: section.testId, baseConfigSectionId: stray.id }, viewer(CHIEF, true)),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});

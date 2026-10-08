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
  FEATURE_KEYS,
  PERMISSION_LEVELS,
  createAssignmentSchema,
  plainTextOf,
  questionDraftSchema,
  todayISO,
  type AssignmentRole,
  type QuestionDraftInput,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { AuditService } from '../src/audit/audit.service';
import { AdminsService } from '../src/admins/admins.service';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { SectionWorkService, type SectionViewer } from '../src/questions/section-work.service';
import { QuestionImportService } from '../src/questions/question-import.service';
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
const NEXT = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

async function build() {
  await makeQuestionBank(prisma, {
    [TYPIST]: 'Anita',
    [READER]: 'Bhaskar',
    [CHIEF]: 'Chandra',
    [NEXT]: 'Nikhil',
  });
  const audit = new AuditContext();
  const questions = new QuestionsService(prisma, audit, new FakeStorage() as never);
  const redis = new FakeRedis();
  const admins = new AdminsService(prisma, audit, new FakeEventBus().asService());
  const assignments = new AssignmentsService(prisma, admins, redis.asService(), audit);
  const storage = new FakeStorage() as never;
  const imports = new QuestionImportService(prisma, storage, new AuditService(prisma, storage));
  return {
    redis,
    questions,
    assignments,
    work: new SectionWorkService(prisma, redis.asService(), questions, assignments, imports),
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
    const { work } = await build();
    const section = await aSection();
    const written = await work.create(pairOf(section), draft(), viewer(TYPIST));
    await markDone(section, written);

    await assert.rejects(
      () =>
        work.edit(
          pairOf(section),
          written.id,
          draft({ stem: { en: 'The reader’s fix' } }),
          viewer(READER),
        ),
      conflictSaying('Anita'),
    );
  });

  it('lets the holder back in, and their fifteen minutes start again', async () => {
    const { work } = await build();
    const section = await aSection();
    const written = await work.create(pairOf(section), draft(), viewer(TYPIST));

    const again = await work.edit(
      pairOf(section),
      written.id,
      draft({ stem: { en: 'What is 25% of 200?' } }),
      viewer(TYPIST),
    );

    assert.equal(again.id, written.id);
  });

  it('hands it to a super admin, who then holds it against the admin who had it', async () => {
    const { work } = await build();
    const section = await aSection();
    const written = await work.create(pairOf(section), draft(), viewer(TYPIST));
    await markDone(section, written);
    await sentBack(section, written.id);

    const stolen = await work.edit(
      pairOf(section),
      written.id,
      draft({ stem: { en: 'A super admin’s fix' } }),
      viewer(CHIEF, true),
    );
    assert.equal(stolen.id, written.id);

    await assert.rejects(
      () =>
        work.edit(
          pairOf(section),
          written.id,
          draft({ stem: { en: 'Mine again' } }),
          viewer(TYPIST),
        ),
      conflictSaying('Chandra'),
    );
  });

  it('lapses once nobody has written in the section for fifteen minutes', async () => {
    const { work, redis } = await build();
    const section = await aSection();
    const written = await work.create(pairOf(section), draft(), viewer(TYPIST));
    await markDone(section, written);

    redis.advanceSeconds(EDIT_LOCK_TTL_SEC + 1);

    const fixed = await work.edit(
      pairOf(section),
      written.id,
      draft({ stem: { en: 'The reader’s fix' } }),
      viewer(READER),
    );
    assert.equal(fixed.id, written.id);
  });
});

describe('the section edit lock — given up when the section changes hands', () => {
  /** The failure this prevents: a new typist kept out for fifteen minutes by the claim of the one they replaced. */
  it('gives the earlier holder’s claim up when their role passes to somebody new', async () => {
    const { work, assignments } = await build();
    const section = await aSection();
    await work.create(pairOf(section), draft(), viewer(TYPIST));
    await prisma.adminFeaturePermission.create({
      data: {
        adminId: NEXT,
        featureKey: FEATURE_KEYS.QUESTION_AUTHORING,
        level: PERMISSION_LEVELS.WRITE,
      },
    });

    await assignments.assign(
      section.testId,
      createAssignmentSchema.parse({
        baseConfigSectionId: section.sectionId,
        assigneeId: NEXT,
        role: ASSIGNMENT_ROLES.TYPIST,
        dueAt: todayISO(),
      }),
      CHIEF,
    );

    const written = await work.create(
      pairOf(section),
      draft({ stem: { en: 'What is 10% of 150?' } }),
      viewer(NEXT),
    );
    assert.equal(written.author?.id, NEXT);
  });

  /** The failure this prevents: a reader handed a section back by its owner's rewording, and kept out of it by that owner's claim. */
  it('gives an owner’s claim up when their rewording hands the section back to its reader', async () => {
    const { work } = await build();
    const section = await aSection();
    await prisma.baseConfigSection.update({
      where: { id: section.sectionId },
      data: { questionCount: 1 },
    });
    const written = await work.create(pairOf(section), draft(), viewer(TYPIST));
    await markDone(section, written);
    await work.handedOver(pairOf(section), viewer(TYPIST));
    await work.check(pairOf(section), written.id, viewer(READER));
    await work.release(pairOf(section), viewer(READER));
    const owner = {
      ...viewer(CHIEF),
      permissions: { [FEATURE_KEYS.TEST_MANAGEMENT]: PERMISSION_LEVELS.WRITE },
    };

    await work.edit(
      pairOf(section),
      written.id,
      draft({ stem: { en: 'What is 25% of 200?' } }),
      owner,
    );

    const fixed = await work.edit(
      pairOf(section),
      written.id,
      draft({ stem: { en: 'The reader’s fix' } }),
      viewer(READER),
    );
    assert.equal(fixed.id, written.id);
  });
});

describe('SectionWorkService — a section nobody was given to read', () => {
  it('opens to a super admin', async () => {
    const { work } = await build();
    const section = await aSection({ withReader: false });
    const written = await work.create(pairOf(section), draft(), viewer(TYPIST));
    await markDone(section, written);

    const opened = await work.one(pairOf(section), viewer(CHIEF, true));

    assert.deepEqual(
      opened.questions.map((row) => row.questionId),
      [written.id],
    );
  });

  it('fixes a question through that section, and keeps its status', async () => {
    const { work } = await build();
    const section = await aSection({ withReader: false });
    const written = await work.create(pairOf(section), draft(), viewer(TYPIST));
    await markDone(section, written);

    const fixed = await work.edit(
      pairOf(section),
      written.id,
      draft({ stem: { en: 'What is 25% of 200?' } }),
      viewer(CHIEF, true),
    );

    assert.equal(fixed.status, written.status);
    assert.match(plainTextOf(fixed.content.en?.stem), /25% of 200/);
  });

  /** The section is no licence to reach the bank through it. */
  it('refuses a question that is not in the section named', async () => {
    const { work } = await build();
    const section = await aSection({ withReader: false });
    const written = await work.create(pairOf(section), draft(), viewer(TYPIST));

    await assert.rejects(
      () =>
        work.edit(
          { testId: section.testId, baseConfigSectionId: section.otherSectionId },
          written.id,
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

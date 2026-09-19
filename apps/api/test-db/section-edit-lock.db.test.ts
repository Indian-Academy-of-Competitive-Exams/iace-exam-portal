import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ASSIGNMENT_ROLES,
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  plainTextOf,
  questionDraftSchema,
  type AssignmentRole,
  type QuestionDraftInput,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { AuthoringService } from '../src/questions/authoring.service';
import { ProofreadingService } from '../src/questions/proofreading.service';
import { QuestionsService } from '../src/questions/questions.service';
import { EDIT_LOCK_TTL_SEC } from '../src/redis/redis.keys';
import { FakeRedis, FakeStorage } from '../test/support/fakes';
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
  const questions = new QuestionsService(prisma, new AuditContext(), new FakeStorage() as never);
  const redis = new FakeRedis();
  return {
    redis,
    questions,
    authoring: new AuthoringService(prisma, redis.asService(), questions),
    proofreading: new ProofreadingService(prisma, redis.asService(), questions),
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
  const test = await makeTest(prisma, catalog);
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

const conflictSaying = (words: string) => (error: unknown) =>
  AppException.is(error) && error.code === ErrorCodes.CONFLICT && error.message.includes(words);

const refusedWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

describe('the section edit lock', () => {
  it('names whoever is already in the section rather than just refusing', async () => {
    const { authoring, proofreading } = await build();
    const section = await aSection();
    const written = await authoring.create(draft(), TYPIST, section.typing.id);

    await assert.rejects(
      () =>
        proofreading.editQuestion(
          section.reading?.id ?? '',
          written.question.id,
          draft({ stem: { en: 'The reader’s fix' } }),
          READER,
        ),
      conflictSaying('Anita'),
    );
  });

  it('lets the holder back in, and their fifteen minutes start again', async () => {
    const { authoring } = await build();
    const section = await aSection();
    const written = await authoring.create(draft(), TYPIST, section.typing.id);

    const again = await authoring.update(
      written.question.id,
      draft({ stem: { en: 'What is 25% of 200?' } }),
      TYPIST,
    );

    assert.equal(again.question.id, written.question.id);
  });

  it('hands it to a super admin, who then holds it against the admin who had it', async () => {
    const { authoring, proofreading } = await build();
    const section = await aSection();
    const written = await authoring.create(draft(), TYPIST, section.typing.id);

    const stolen = await proofreading.editQuestion(
      section.reading?.id ?? '',
      written.question.id,
      draft({ stem: { en: 'A super admin’s fix' } }),
      CHIEF,
      true,
    );
    assert.equal(stolen.id, written.question.id);

    await assert.rejects(
      () => authoring.update(written.question.id, draft({ stem: { en: 'Mine again' } }), TYPIST),
      conflictSaying('Chandra'),
    );
  });

  it('lapses once nobody has written in the section for fifteen minutes', async () => {
    const { authoring, proofreading, redis } = await build();
    const section = await aSection();
    const written = await authoring.create(draft(), TYPIST, section.typing.id);

    redis.advanceSeconds(EDIT_LOCK_TTL_SEC + 1);

    const fixed = await proofreading.editQuestion(
      section.reading?.id ?? '',
      written.question.id,
      draft({ stem: { en: 'The reader’s fix' } }),
      READER,
    );
    assert.equal(fixed.id, written.question.id);
  });
});

describe('ProofreadingService.forSection', () => {
  it('opens a section nobody was given to proof-read', async () => {
    const { authoring, proofreading } = await build();
    const section = await aSection({ withReader: false });
    const written = await authoring.create(draft(), TYPIST, section.typing.id);

    const rows = await proofreading.forSection(section.testId, section.sectionId);

    assert.deepEqual(
      rows.map((row) => row.id),
      [written.question.id],
    );
  });

  it('fixes a question through that section, and keeps its status', async () => {
    const { authoring, proofreading } = await build();
    const section = await aSection({ withReader: false });
    const written = await authoring.create(draft(), TYPIST, section.typing.id);

    const fixed = await proofreading.editSectionQuestion(
      section.testId,
      section.sectionId,
      written.question.id,
      draft({ stem: { en: 'What is 25% of 200?' } }),
      CHIEF,
    );

    assert.equal(fixed.status, written.question.status);
    assert.match(plainTextOf(fixed.content.en?.stem), /25% of 200/);
  });

  /** The section is no licence to reach the bank through it: the scope is the same one an assignment gets. */
  it('refuses a question that is not in the section named', async () => {
    const { authoring, proofreading } = await build();
    const section = await aSection({ withReader: false });
    const written = await authoring.create(draft(), TYPIST, section.typing.id);

    await assert.rejects(
      () =>
        proofreading.editSectionQuestion(
          section.testId,
          section.otherSectionId,
          written.question.id,
          draft(),
          CHIEF,
        ),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  it('refuses a section that is not on the test named', async () => {
    const { proofreading } = await build();
    const section = await aSection({ withReader: false });
    const elsewhere = await makeCatalog(prisma);
    const stray = await makeSection(prisma, elsewhere, { name: 'Stray', order: 1 });

    await assert.rejects(
      () => proofreading.forSection(section.testId, stray.id),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });
});

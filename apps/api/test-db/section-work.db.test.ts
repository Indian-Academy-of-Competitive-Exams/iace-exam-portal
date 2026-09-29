import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ASSIGNMENT_ROLES,
  AppException,
  DIFFICULTY_LEVEL,
  ErrorCodes,
  FEATURE_KEYS,
  PAPER_SOURCES,
  PERMISSION_LEVELS,
  REVIEW_STATES,
  SECTION_SEATS,
  SEND_BACK_REASONS,
  TEST_STATUS,
  questionDraftSchema,
  type AdminPermissions,
  type AssignmentRole,
  type PaperSource,
  type QuestionDraftInput,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { AdminsService } from '../src/admins/admins.service';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { QuestionsService } from '../src/questions/questions.service';
import { SectionWorkService, type SectionViewer } from '../src/questions/section-work.service';
import { FakeEventBus, FakeRedis, FakeStorage } from '../test/support/fakes';
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

const TYPIST = randomUUID();
const READER = randomUUID();
const OWNER = randomUUID();
const STRANGER = randomUUID();
const CHIEF = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

const OWNS: AdminPermissions = { [FEATURE_KEYS.TEST_MANAGEMENT]: PERMISSION_LEVELS.WRITE };

const viewer = (
  id: string,
  permissions: AdminPermissions = {},
  isSuperAdmin = false,
): SectionViewer => ({
  id,
  isActive: true,
  isSuperAdmin,
  permissions,
});

const refusedWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

function draft(over: Partial<QuestionDraftInput> = {}) {
  return questionDraftSchema.parse({
    subjectId: BANK.QUANT,
    // makeQuestion files under no topic, and a question on a paper keeps the one it has.
    topicId: null,
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
}

async function build() {
  await makeQuestionBank(prisma, {
    [TYPIST]: 'Anita',
    [READER]: 'Bhaskar',
    [OWNER]: 'Owner',
    [STRANGER]: 'Stranger',
    [CHIEF]: 'Chief',
  });
  const audit = new AuditContext();
  const redis = new FakeRedis().asService();
  const questions = new QuestionsService(prisma, audit, new FakeStorage() as never);
  const assignments = new AssignmentsService(
    prisma,
    redis,
    new AdminsService(prisma, audit, new FakeEventBus().asService()),
  );
  return { questions, work: new SectionWorkService(prisma, redis, questions, assignments) };
}

const assign = (
  catalog: Catalog,
  testId: string,
  baseConfigSectionId: string,
  assigneeId: string,
  role: AssignmentRole,
) =>
  prisma.questionAssignment.create({
    data: { testId, baseConfigId: catalog.baseConfigId, baseConfigSectionId, assigneeId, role },
  });

/** A section with a typist and a reader on a test from the source given, and one paper question. */
async function aSection(source: PaperSource = PAPER_SOURCES.FRAMED) {
  const catalog = await makeCatalog(prisma);
  const test = await makeTest(prisma, catalog, { paperSource: source });
  const section = await makeSection(prisma, catalog, { name: 'Quant', order: 1 });
  const typing = await assign(catalog, test.id, section.id, TYPIST, ASSIGNMENT_ROLES.TYPIST);
  const reading = await assign(catalog, test.id, section.id, READER, ASSIGNMENT_ROLES.PROOFREADER);
  const pair = { testId: test.id, baseConfigSectionId: section.id };
  let order = 0;

  const onPaper = async (question: { id: string; versionId: string }) =>
    prisma.paperQuestion.create({
      data: {
        ...pair,
        baseConfigId: catalog.baseConfigId,
        questionId: question.id,
        questionVersionId: question.versionId,
        order: ++order,
        marks: 2,
        negativeMarks: 0.5,
      },
    });
  const typed = async () => {
    const question = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    await prisma.question.update({ where: { id: question.id }, data: { assignmentId: typing.id } });
    return question;
  };
  const handToReader = () =>
    prisma.questionAssignment.update({ where: { id: reading.id }, data: { handedAt: new Date() } });
  const typistDone = async () => {
    await prisma.questionAssignment.update({
      where: { id: typing.id },
      data: { finalizedAt: new Date() },
    });
    await handToReader();
  };

  return { catalog, test, pair, typing, reading, onPaper, typed, handToReader, typistDone };
}

describe('SectionWorkService — who opens a section', () => {
  it('reads as not there to an admin with no seat on it and no test key', async () => {
    const { work } = await build();
    const { pair } = await aSection();

    await assert.rejects(() => work.one(pair, viewer(STRANGER)), refusedWith(ErrorCodes.NOT_FOUND));
  });

  it('seats its typist, its reader and a test owner, each as what they are', async () => {
    const { work } = await build();
    const { pair } = await aSection();

    assert.equal((await work.one(pair, viewer(TYPIST))).seat, SECTION_SEATS.TYPIST);
    assert.equal((await work.one(pair, viewer(READER))).seat, SECTION_SEATS.READER);
    assert.equal((await work.one(pair, viewer(OWNER, OWNS))).seat, SECTION_SEATS.OWNER);
  });

  /** The failure this prevents: a reader reading half-typed work before the typist's Done. */
  it('shows its reader nothing until the section reaches them, then only the paper', async () => {
    const { work } = await build();
    const { pair, typed, onPaper, typistDone } = await aSection();
    const chosen = await typed();
    await typed();
    await onPaper(chosen);

    assert.deepEqual((await work.one(pair, viewer(READER))).questions, []);
    await typistDone();

    const read = await work.one(pair, viewer(READER));
    assert.deepEqual(
      read.questions.map((row) => row.questionId),
      [chosen.id],
    );
  });
});

describe('SectionWorkService — who may change a question, and when', () => {
  /** The failure this prevents: a typist rewriting what the reader already passed. */
  it('lets a typist change what they typed until Done, and after it only what was sent back', async () => {
    const { work } = await build();
    const { pair, typed, onPaper, typistDone } = await aSection();
    const question = await typed();
    await onPaper(question);

    const editableFor = async (id: string) =>
      (await work.one(pair, viewer(id))).questions.find((row) => row.questionId === question.id)
        ?.editable;

    assert.equal(await editableFor(TYPIST), true);
    await typistDone();
    assert.equal(await editableFor(TYPIST), false);
    assert.equal(await editableFor(READER), true);

    await work.sendBack(pair, question.id, { reason: SEND_BACK_REASONS.SPELLING }, viewer(READER));
    assert.equal(await editableFor(TYPIST), true);
    await work.edit(
      pair,
      question.id,
      draft({ stem: { en: 'What is 20% of 160?' } }),
      viewer(TYPIST),
    );
  });

  it('keeps a test owner out until the section is back with them', async () => {
    const { work } = await build();
    const { pair, test, reading, onPaper, typistDone } = await aSection();
    const question = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    await onPaper(question);
    await typistDone();

    await assert.rejects(
      () => work.edit(pair, question.id, draft(), viewer(OWNER, OWNS)),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
    await prisma.questionAssignment.update({
      where: { id: reading.id },
      data: { finalizedAt: new Date() },
    });
    await work.edit(
      pair,
      question.id,
      draft({ stem: { en: 'An owner’s fix' } }),
      viewer(OWNER, OWNS),
    );

    await prisma.test.update({
      where: { id: test.id },
      data: { finalizedAt: new Date(), status: TEST_STATUS.ACTIVE },
    });
    await assert.rejects(
      () => work.edit(pair, question.id, draft(), viewer(OWNER, OWNS)),
      refusedWith(ErrorCodes.CONFLICT),
    );
  });

  it('lets a test owner change a picked section before handing it over', async () => {
    const { work } = await build();
    const { pair, onPaper } = await aSection(PAPER_SOURCES.PICKED);
    const question = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    await onPaper(question);

    const saved = await work.edit(pair, question.id, draft(), viewer(OWNER, OWNS));

    assert.equal(saved.id, question.id);
  });

  it('leaves a reader whose role has passed on reading, and no more', async () => {
    const { work } = await build();
    const { pair, reading, onPaper, typistDone } = await aSection();
    const question = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    await onPaper(question);
    await typistDone();
    await prisma.questionAssignment.update({
      where: { id: reading.id },
      data: { replacedAt: new Date() },
    });

    const read = await work.one(pair, viewer(READER));
    assert.equal(read.seatReplaced, true);
    assert.equal(read.questions[0]?.editable, false);
  });
});

describe('SectionWorkService — the reader’s review', () => {
  it('checks, sends back with a reason, takes the fix, and checks again', async () => {
    const { work } = await build();
    const { pair, onPaper, typistDone } = await aSection();
    const question = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    await onPaper(question);
    await typistDone();
    const stateOf = async () => (await work.one(pair, viewer(READER))).questions[0]?.review.state;

    await work.check(pair, question.id, viewer(READER));
    assert.equal(await stateOf(), REVIEW_STATES.CHECKED);

    await work.sendBack(
      pair,
      question.id,
      { reason: SEND_BACK_REASONS.ANSWER_OPTION, note: 'Option C is also right' },
      viewer(READER),
    );
    assert.equal(await stateOf(), REVIEW_STATES.SENT_BACK);
    await assert.rejects(
      () => work.check(pair, question.id, viewer(READER)),
      refusedWith(ErrorCodes.CONFLICT),
      'a question with the typist is not the reader’s to pass',
    );

    await work.fixed(pair, question.id, viewer(TYPIST));
    assert.equal(await stateOf(), REVIEW_STATES.FIXED);
    await work.check(pair, question.id, viewer(READER));
    assert.equal(await stateOf(), REVIEW_STATES.CHECKED);
  });

  it('refuses a send-back when the section has no typist to take it', async () => {
    const { work } = await build();
    const { pair, typing, onPaper, handToReader } = await aSection(PAPER_SOURCES.PICKED);
    const question = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    await onPaper(question);
    await handToReader();
    await prisma.questionAssignment.delete({ where: { id: typing.id } });

    await assert.rejects(
      () =>
        work.sendBack(pair, question.id, { reason: SEND_BACK_REASONS.SPELLING }, viewer(READER)),
      refusedWith(ErrorCodes.CONFLICT),
    );
  });

  it('refuses a typist marking fixed what was never sent back, and anyone but the reader checking', async () => {
    const { work } = await build();
    const { pair, onPaper, typistDone } = await aSection();
    const question = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    await onPaper(question);
    await typistDone();

    await assert.rejects(
      () => work.fixed(pair, question.id, viewer(TYPIST)),
      refusedWith(ErrorCodes.CONFLICT),
    );
    await assert.rejects(
      () => work.check(pair, question.id, viewer(TYPIST)),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
  });
});

describe('SectionWorkService — the cross-test warning', () => {
  it('names another test holding the question, and leaves out the section’s own', async () => {
    const { work } = await build();
    const { catalog, pair, onPaper, typistDone } = await aSection();
    const question = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    await onPaper(question);
    await typistDone();
    const other = await makeTest(prisma, catalog, { title: 'Grand Test 4' });
    const otherSection = await makeSection(prisma, catalog, { name: 'Quant again', order: 2 });
    await prisma.paperQuestion.create({
      data: {
        id: uid(),
        testId: other.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: otherSection.id,
        questionId: question.id,
        questionVersionId: question.versionId,
        order: 1,
        marks: 2,
        negativeMarks: 0.5,
      },
    });

    const rows = await work.otherTests(pair, question.id, viewer(READER));

    assert.deepEqual(
      rows.map((row) => row.testTitle),
      ['Grand Test 4'],
    );
  });
});

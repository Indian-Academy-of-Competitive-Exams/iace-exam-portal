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
  QUESTION_IMPORT_COLUMNS,
  REVIEW_STATES,
  SECTION_SEATS,
  SEND_BACK_REASONS,
  TEST_STATUS,
  questionDraftSchema,
  type AdminPermissions,
  type AssignmentRole,
  type PaperSource,
  type QuestionDraftInput,
  type QuestionImportColumnKey,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { AuditService } from '../src/audit/audit.service';
import { AdminsService } from '../src/admins/admins.service';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { QuestionImportService } from '../src/questions/question-import.service';
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
    new AdminsService(prisma, audit, new FakeEventBus().asService()),
  );
  const storage = new FakeStorage() as never;
  const imports = new QuestionImportService(prisma, storage, new AuditService(prisma, storage));
  return {
    questions,
    work: new SectionWorkService(prisma, redis, questions, assignments, imports),
  };
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
    await prisma.question.update({
      where: { id: question.id },
      data: { assignmentId: typing.id, createdById: TYPIST },
    });
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

describe('SectionWorkService — a typist the section passed on from', () => {
  /** The failure this prevents: a replaced typist rewriting or deleting what the new typist now holds. */
  it('refuses the replaced typist’s edit and delete, and lets the one after them work', async () => {
    const { work } = await build();
    const { catalog, pair, typing, typed } = await aSection();
    const question = await typed();
    await prisma.questionAssignment.update({
      where: { id: typing.id },
      data: { replacedAt: new Date() },
    });
    await assign(catalog, pair.testId, pair.baseConfigSectionId, STRANGER, ASSIGNMENT_ROLES.TYPIST);

    await assert.rejects(
      () => work.edit(pair, question.id, draft(), viewer(TYPIST)),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
    await assert.rejects(
      () => work.remove(pair, question.id, viewer(TYPIST)),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
    assert.equal(await prisma.question.count({ where: { id: question.id } }), 1);

    const fixed = await work.edit(pair, question.id, draft(), viewer(STRANGER));
    assert.equal(fixed.id, question.id);
  });

  /** The failure this prevents: a typist stood down with nobody after them locked out of their own drafts. */
  it('lets a typist stood down with no successor keep fixing what they typed', async () => {
    const { work } = await build();
    const { pair, typing, typed } = await aSection();
    const kept = await typed();
    const dropped = await typed();
    await prisma.questionAssignment.update({
      where: { id: typing.id },
      data: { replacedAt: new Date() },
    });

    const fixed = await work.edit(pair, kept.id, draft(), viewer(TYPIST));
    assert.equal(fixed.id, kept.id);
    await work.remove(pair, dropped.id, viewer(TYPIST));
    assert.equal(await prisma.question.count({ where: { id: dropped.id } }), 0);
  });
});

describe('SectionWorkService.remove', () => {
  /** The failure this prevents: a question on the section deleted by somebody who may not change it. */
  it('deletes a typist’s own draft, and refuses one a test owner cannot change', async () => {
    const { work } = await build();
    const { pair, typed } = await aSection();
    const mistake = await typed();
    const draftOnly = await typed();

    await assert.rejects(
      () => work.remove(pair, draftOnly.id, viewer(OWNER, OWNS)),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
    await work.remove(pair, mistake.id, viewer(TYPIST));

    assert.equal(await prisma.question.count({ where: { id: mistake.id } }), 0);
    assert.equal(await prisma.question.count({ where: { id: draftOnly.id } }), 1);
  });
});

/** One good row, written out as CSV: the section import reads the bank's own sheet. */
function oneRowSheet(): Buffer {
  const row: Partial<Record<QuestionImportColumnKey, string>> = {
    subject: 'Quantitative Aptitude',
    difficulty: 'medium',
    stem_en: 'What is 30% of 150?',
    option1_en: '25',
    option2_en: '45',
    option3_en: '35',
    option4_en: '40',
    correct_option: '2',
  };
  const cells = (pick: (column: (typeof QUESTION_IMPORT_COLUMNS)[number]) => string) =>
    QUESTION_IMPORT_COLUMNS.map(pick).join(',');
  const line = cells((column) => row[column.key as QuestionImportColumnKey] ?? '');
  return Buffer.from([cells((column) => column.header), line].join('\n'));
}

describe('SectionWorkService — writes taken under the seat the caller holds', () => {
  /** The failure this prevents: a question landing in a section under somebody else's typing job. */
  it('types under the typist’s own row, a super admin’s under its holder’s, and nobody else’s', async () => {
    const { work } = await build();
    const { pair, typing } = await aSection();

    const own = await work.create(pair, draft(), viewer(TYPIST));
    const chiefs = await work.create(
      pair,
      draft({ stem: { en: 'What is 10% of 150?' } }),
      viewer(CHIEF, {}, true),
    );
    const under = await prisma.question.findMany({
      where: { id: { in: [own.id, chiefs.id] } },
      select: { assignmentId: true },
    });
    assert.deepEqual(
      under.map((row) => row.assignmentId),
      [typing.id, typing.id],
    );

    const another = draft({ stem: { en: 'What is 40% of 150?' } });
    for (const who of [viewer(READER), viewer(OWNER, OWNS)]) {
      await assert.rejects(
        () => work.create(pair, another, who),
        refusedWith(ErrorCodes.FORBIDDEN),
      );
    }
    await assert.rejects(
      () => work.create(pair, another, viewer(STRANGER)),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  /** The failure this prevents: new typing on a job that is over, or on a paper nobody types. */
  it('refuses typing once the typist is replaced or done, and on a picked paper', async () => {
    const { work } = await build();
    const { pair, typing } = await aSection();
    const picked = await aSection(PAPER_SOURCES.PICKED);

    await assert.rejects(
      () => work.create(picked.pair, draft(), viewer(TYPIST)),
      refusedWith(ErrorCodes.CONFLICT),
    );
    await prisma.questionAssignment.update({
      where: { id: typing.id },
      data: { finalizedAt: new Date() },
    });
    await assert.rejects(
      () => work.create(pair, draft(), viewer(TYPIST)),
      refusedWith(ErrorCodes.CONFLICT),
    );
    await prisma.questionAssignment.update({
      where: { id: typing.id },
      data: { replacedAt: new Date() },
    });
    await assert.rejects(
      () => work.previewImport(pair, oneRowSheet(), viewer(TYPIST)),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
    assert.equal(await prisma.question.count({ where: { assignmentId: typing.id } }), 0);
  });

  it('imports a sheet into the section under the typist’s row, and refuses the reader', async () => {
    const { work } = await build();
    const { pair, typing } = await aSection();

    await assert.rejects(
      () => work.previewImport(pair, oneRowSheet(), viewer(READER)),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
    const plan = await work.previewImport(pair, oneRowSheet(), viewer(TYPIST));
    await assert.rejects(
      () => work.commitImport(pair, plan.importLogId, viewer(READER)),
      refusedWith(ErrorCodes.FORBIDDEN),
    );
    const result = await work.commitImport(pair, plan.importLogId, viewer(TYPIST));

    assert.equal(result.created, 1);
    assert.equal(await prisma.question.count({ where: { assignmentId: typing.id } }), 1);
  });

  /** The failure this prevents: a section released by somebody who is not reading it. */
  it('releases through the reader’s own row, a super admin through its holder’s, and nobody else', async () => {
    const { work } = await build();
    const { pair, onPaper, typistDone } = await aSection();
    await prisma.baseConfigSection.update({
      where: { id: pair.baseConfigSectionId },
      data: { questionCount: 1 },
    });
    const question = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    await onPaper(question);
    await typistDone();
    await work.check(pair, question.id, viewer(READER));

    for (const who of [viewer(TYPIST), viewer(OWNER, OWNS)]) {
      await assert.rejects(() => work.release(pair, who), refusedWith(ErrorCodes.FORBIDDEN));
    }
    const released = await work.release(pair, viewer(READER));
    assert.ok(released.reader?.finalizedAt);
    const again = await work.release(pair, viewer(CHIEF, {}, true));
    assert.ok(again.reader?.finalizedAt);
  });

  /** The failure this prevents: a Release button the server then refuses, or none where it would be taken. */
  it('offers the release only to its reader, once the section is whole and every question checked', async () => {
    const { work } = await build();
    const { pair, onPaper, typistDone } = await aSection();
    await prisma.baseConfigSection.update({
      where: { id: pair.baseConfigSectionId },
      data: { questionCount: 2 },
    });
    const first = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    const second = await makeQuestion(prisma, { subjectId: BANK.QUANT });
    await onPaper(first);
    await typistDone();
    const offered = async (id: string) => (await work.one(pair, viewer(id))).canRelease;

    await work.check(pair, first.id, viewer(READER));
    assert.equal(await offered(READER), false, 'the paper is short');
    await onPaper(second);
    assert.equal(await offered(READER), false, 'a question is not checked');
    await work.check(pair, second.id, viewer(READER));
    assert.equal(await offered(READER), true);
    assert.equal(await offered(TYPIST), false, 'only its reader releases it');

    await work.release(pair, viewer(READER));
    assert.equal(await offered(READER), false, 'released already');
  });

  it('refuses a release by a reader the section passed on from', async () => {
    const { work } = await build();
    const { catalog, pair, reading, typistDone } = await aSection();
    await typistDone();
    await prisma.questionAssignment.update({
      where: { id: reading.id },
      data: { replacedAt: new Date() },
    });
    await assign(
      catalog,
      pair.testId,
      pair.baseConfigSectionId,
      STRANGER,
      ASSIGNMENT_ROLES.PROOFREADER,
    );

    await assert.rejects(
      () => work.release(pair, viewer(READER)),
      refusedWith(ErrorCodes.CONFLICT),
    );
  });

  it('names whoever is editing the section, with the section itself', async () => {
    const { work } = await build();
    const { pair } = await aSection();
    assert.equal((await work.one(pair, viewer(READER))).editingBy, null);

    await work.create(pair, draft(), viewer(TYPIST));

    assert.equal((await work.one(pair, viewer(READER))).editingBy?.adminId, TYPIST);
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

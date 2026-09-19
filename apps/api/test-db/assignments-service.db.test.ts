import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ASSIGNMENT_ROLES,
  AppException,
  ErrorCodes,
  FEATURE_KEYS,
  FORM_LEVEL_FIELD,
  PAPER_SOURCES,
  PERMISSION_LEVELS,
  TEST_STATUS,
  createAssignmentSchema,
  mineAssignmentsQuerySchema,
  type CreateAssignmentInput,
  type FeatureKey,
  type PermissionLevel,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { AdminsService } from '../src/admins/admins.service';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { FinalizeService } from '../src/tests/finalize.service';
import { TestsService } from '../src/tests/tests.service';
import { FakeEventBus } from '../test/support/fakes';
import {
  makeAdmin,
  makeCatalog,
  makePaper,
  makeQuestion,
  makeSection,
  makeSubject,
  makeTest,
  resetDatabase,
  testPrisma,
  type Catalog,
} from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build() {
  const audit = new AuditContext();
  const admins = new AdminsService(prisma, audit);
  const configs = new BaseConfigsService(prisma, new ExamStagesService(prisma, audit), audit);
  return {
    assignments: new AssignmentsService(prisma, admins),
    admins,
    tests: new TestsService(prisma, configs, audit, new FakeEventBus().asService()),
  };
}

const grant = (
  adminId: string,
  key: FeatureKey,
  level: PermissionLevel = PERMISSION_LEVELS.WRITE,
) => prisma.adminFeaturePermission.create({ data: { adminId, featureKey: key, level } });

const body = (over: Partial<CreateAssignmentInput>): CreateAssignmentInput =>
  createAssignmentSchema.parse({
    baseConfigSectionId: '',
    assigneeId: '',
    role: ASSIGNMENT_ROLES.TYPIST,
    ...over,
  });

const refusedWith = (code: string) => (error: unknown) =>
  AppException.is(error) && error.code === code;

/** Assigning waits on the source being declared, so every test below starts with it said. */
const framed = (catalog: Catalog, over: { title?: string } = {}) =>
  makeTest(prisma, catalog, { ...over, paperSource: PAPER_SOURCES.FRAMED });

/** The same, for a paper built whole: `makePaper` leaves the source unsaid. */
const sayFramed = (testId: string) =>
  prisma.test.update({
    where: { id: testId },
    data: { paperSource: PAPER_SOURCES.FRAMED },
    select: { id: true },
  });

describe('AssignmentsService — assigning', () => {
  it('takes one typist and one proof-reader, and lists both with names and counts', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog, { name: 'Reasoning' });
    const typist = await makeAdmin(prisma, { fullName: 'Priya' });
    const reader = await makeAdmin(prisma, { fullName: 'Arjun' });
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);

    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );
    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    const rows = await assignments.forTest(test.id);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((row) => [row.assigneeName, row.role, row.sectionName, row.writtenCount]).sort(),
      [
        ['Arjun', ASSIGNMENT_ROLES.PROOFREADER, 'Reasoning', 0],
        ['Priya', ASSIGNMENT_ROLES.TYPIST, 'Reasoning', 0],
      ].sort(),
    );
    assert.ok(rows.every((row) => row.finalizedAt === null));
  });

  /** The failure this prevents: two typists both believing the section is theirs. */
  it('refuses a second typist on a section that already has one', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const first = await makeAdmin(prisma);
    const second = await makeAdmin(prisma);
    await grant(first.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await grant(second.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: first.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      first.id,
    );

    await assert.rejects(
      () =>
        assignments.assign(
          test.id,
          body({
            baseConfigSectionId: section.id,
            assigneeId: second.id,
            role: ASSIGNMENT_ROLES.TYPIST,
          }),
          second.id,
        ),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.CONFLICT &&
        /already has a typist/.test(error.message),
    );
  });

  /** The failure this prevents: a typist grant revoked (or never given) still lets someone author. */
  it('refuses an assignee who does not hold the feature the role needs', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const admin = await makeAdmin(prisma);

    await assert.rejects(
      () =>
        assignments.assign(
          test.id,
          body({
            baseConfigSectionId: section.id,
            assigneeId: admin.id,
            role: ASSIGNMENT_ROLES.TYPIST,
          }),
          admin.id,
        ),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.VALIDATION_ERROR &&
        Boolean(error.fieldErrors?.assigneeId),
    );
  });

  /** Spec §11: nobody proof-reads their own typing. */
  it('refuses a proof-reader who is already the typist on the same section', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const admin = await makeAdmin(prisma);
    await grant(admin.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await grant(admin.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: admin.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      admin.id,
    );

    await assert.rejects(
      () =>
        assignments.assign(
          test.id,
          body({
            baseConfigSectionId: section.id,
            assigneeId: admin.id,
            role: ASSIGNMENT_ROLES.PROOFREADER,
          }),
          admin.id,
        ),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.VALIDATION_ERROR &&
        Boolean(error.fieldErrors?.assigneeId),
    );
  });
});

describe('AssignmentsService — assignable', () => {
  it('lists an active admin holding the role’s key, not a stranger or a deactivated holder', async () => {
    const { assignments } = build();
    const holder = await makeAdmin(prisma, { fullName: 'Priya' });
    const stranger = await makeAdmin(prisma, { fullName: 'Kiran' });
    const deactivated = await makeAdmin(prisma, { fullName: 'Arjun', isActive: false });
    await grant(holder.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await grant(deactivated.id, FEATURE_KEYS.QUESTION_AUTHORING);

    const typists = await assignments.assignable(ASSIGNMENT_ROLES.TYPIST);

    assert.deepEqual(typists, [{ id: holder.id, fullName: 'Priya' }]);
    assert.ok(!typists.some((admin) => admin.id === stranger.id));
    assert.ok(!typists.some((admin) => admin.id === deactivated.id));
  });
});

describe('AssignmentsService — where the questions come from', () => {
  /** The failure this prevents: a typist handed a section on a test that was never going to be typed. */
  it('refuses to hand out a section before the test says where its questions come from', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await makeTest(prisma, catalog);
    const section = await makeSection(prisma, catalog);
    const typist = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);

    await assert.rejects(
      () =>
        assignments.assign(
          test.id,
          body({
            baseConfigSectionId: section.id,
            assigneeId: typist.id,
            role: ASSIGNMENT_ROLES.TYPIST,
          }),
          typist.id,
        ),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.CONFLICT &&
        Boolean(error.fieldErrors?.[FORM_LEVEL_FIELD]),
    );
  });

  it('refuses a typist on a test picked from the bank, and says so on the role', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await makeTest(prisma, catalog, { paperSource: PAPER_SOURCES.PICKED });
    const section = await makeSection(prisma, catalog);
    const typist = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);

    await assert.rejects(
      () =>
        assignments.assign(
          test.id,
          body({
            baseConfigSectionId: section.id,
            assigneeId: typist.id,
            role: ASSIGNMENT_ROLES.TYPIST,
          }),
          typist.id,
        ),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.VALIDATION_ERROR &&
        Boolean(error.fieldErrors?.role),
    );
  });

  /** The half of PICKED that still happens: somebody reads what was picked. */
  it('takes the proof-reader a picked test does need', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await makeTest(prisma, catalog, { paperSource: PAPER_SOURCES.PICKED });
    const section = await makeSection(prisma, catalog);
    const reader = await makeAdmin(prisma, { fullName: 'Arjun' });
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);

    const created = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    assert.equal(created.role, ASSIGNMENT_ROLES.PROOFREADER);
    assert.equal(created.assigneeName, 'Arjun');
  });
});

describe('AssignmentsService — removing', () => {
  it('removes an assignment nobody has finalized', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const typist = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    const created = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );

    await assignments.remove(created.id);

    assert.equal(await prisma.questionAssignment.findUnique({ where: { id: created.id } }), null);
  });

  /** The failure this prevents: a proof-read record disappearing after the fact. */
  it('refuses to remove a finalized assignment', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const reader = await makeAdmin(prisma);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    const created = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );
    await assignments.finalize(created.id, reader.id);

    await assert.rejects(() => assignments.remove(created.id), refusedWith(ErrorCodes.CONFLICT));
  });
});

describe('AssignmentsService — mine', () => {
  it('lists an admin’s own assignments, newest first, with the test title', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const testOne = await framed(catalog, { title: 'First mock' });
    const testTwo = await framed(catalog, { title: 'Second mock' });
    const section = await makeSection(prisma, catalog);
    const reader = await makeAdmin(prisma);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    await assignments.assign(
      testOne.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );
    const secondSection = await makeSection(prisma, catalog, { order: 2 });
    const second = await assignments.assign(
      testTwo.id,
      body({
        baseConfigSectionId: secondSection.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    const mine = await assignments.mine(reader.id, mineAssignmentsQuerySchema.parse({}));

    assert.equal(mine.length, 2);
    assert.equal(mine[0]?.id, second.id);
    assert.deepEqual(mine.map((row) => row.testTitle).sort(), ['First mock', 'Second mock']);
  });

  it('the role filter narrows a work queue to its own role', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const admin = await makeAdmin(prisma);
    await grant(admin.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await grant(admin.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    const typing = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: admin.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      admin.id,
    );

    const typistQueue = await assignments.mine(admin.id, {
      outstanding: undefined,
      role: ASSIGNMENT_ROLES.TYPIST,
    });

    assert.deepEqual(
      typistQueue.map((row) => row.id),
      [typing.id],
    );
  });

  /** A section fact, same as `writtenCount` — what the queue's progress column reads. */
  it('carries the section’s own question count', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const reader = await makeAdmin(prisma);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    const mine = await assignments.mine(reader.id, mineAssignmentsQuerySchema.parse({}));

    assert.equal(mine[0]?.sectionQuestionCount, 10);
  });

  /** The typist's real target, not a computed guess — docs/02-domain-rules.md §3: absent is every difficulty, not zero. */
  it('reports the test’s own draw-spec mix for the section, and null when the test sets none', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const withMix = await framed(catalog);
    const withoutMix = await framed(catalog);
    const sectionA = await makeSection(prisma, catalog, { order: 1 });
    const sectionB = await makeSection(prisma, catalog, { order: 2 });
    const typist = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await prisma.test.update({
      where: { id: withMix.id },
      data: {
        questionPoolFilter: {
          sections: { [sectionA.id]: { mix: { LOW: 2, MEDIUM: 5, HIGH: 3 } } },
        },
      },
    });
    await assignments.assign(
      withMix.id,
      body({
        baseConfigSectionId: sectionA.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );
    await assignments.assign(
      withoutMix.id,
      body({
        baseConfigSectionId: sectionB.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );

    const mine = await assignments.mine(typist.id, mineAssignmentsQuerySchema.parse({}));

    assert.deepEqual(mine.find((row) => row.testId === withMix.id)?.sectionMix, {
      LOW: 2,
      MEDIUM: 5,
      HIGH: 3,
    });
    assert.equal(mine.find((row) => row.testId === withoutMix.id)?.sectionMix, null);
  });

  it('the outstanding filter narrows to unfinalized rows', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const sectionA = await makeSection(prisma, catalog, { order: 1 });
    const sectionB = await makeSection(prisma, catalog, { order: 2 });
    const reader = await makeAdmin(prisma);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    const done = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: sectionA.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );
    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: sectionB.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );
    await assignments.finalize(done.id, reader.id);

    const outstanding = await assignments.mine(reader.id, { outstanding: true });

    assert.equal(outstanding.length, 1);
    assert.equal(outstanding[0]?.baseConfigSectionId, sectionB.id);
  });
});

describe('AssignmentsService — finalizing', () => {
  it('sets finalizedAt, and finalizing again returns the same row', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const reader = await makeAdmin(prisma);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    const created = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    const first = await assignments.finalize(created.id, reader.id);
    const second = await assignments.finalize(created.id, reader.id);

    assert.ok(first.finalizedAt);
    assert.equal(second.finalizedAt, first.finalizedAt);
  });

  /** "I have written this section" — its own fact, independent of whether anyone has read it. */
  it('a typist finalises their own row too', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const typist = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    const created = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );

    const finalized = await assignments.finalize(created.id, typist.id);

    assert.ok(finalized.finalizedAt);
  });

  /** Not theirs reads as not there: the same guard authoring.service.ts uses for a draft. */
  it('refuses finalizing someone else’s assignment', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const reader = await makeAdmin(prisma);
    const somebodyElse = await makeAdmin(prisma);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    const created = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    await assert.rejects(
      () => assignments.finalize(created.id, somebodyElse.id),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  /** The override: somebody has to be able to close a row whose assignee never will. */
  it('lets a super admin finalize the row it refuses everybody else', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const reader = await makeAdmin(prisma);
    const superAdmin = await makeAdmin(prisma, { isSuperAdmin: true });
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    const created = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    const finalized = await assignments.finalize(created.id, superAdmin.id, true);

    assert.ok(finalized.finalizedAt);
  });
});

describe('the offer gate', () => {
  it('refuses while a section is still being proof-read, then allows once finalized', async () => {
    const { assignments } = build();
    const finalizer = new FinalizeService(prisma, new FakeEventBus().asService());
    const paper = await makePaper(prisma, { sections: ['Reasoning'], questions: ['Quant'] });
    await sayFramed(paper.testId);
    await prisma.baseConfigSection.update({
      where: { id: paper.sectionIds[0] ?? '' },
      data: { questionCount: 1 },
    });
    const reader = await makeAdmin(prisma);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    const created = await assignments.assign(
      paper.testId,
      body({
        baseConfigSectionId: paper.sectionIds[0] ?? '',
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    await assert.rejects(
      () => finalizer.offer(paper.testId),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.VALIDATION_ERROR &&
        /1 section is still being proof-read: Reasoning/.test(error.message),
    );

    await assignments.finalize(created.id, reader.id);
    const result = await finalizer.offer(paper.testId);

    assert.equal(result.status, TEST_STATUS.ACTIVE);
  });

  /** The shape the gate exists for: a typist finishing does not by itself clear the section. */
  it('with both roles assigned, the typist finalising is not enough — the reader still has to', async () => {
    const { assignments } = build();
    const finalizer = new FinalizeService(prisma, new FakeEventBus().asService());
    const paper = await makePaper(prisma, { sections: ['Reasoning'], questions: ['Quant'] });
    await sayFramed(paper.testId);
    await prisma.baseConfigSection.update({
      where: { id: paper.sectionIds[0] ?? '' },
      data: { questionCount: 1 },
    });
    const typist = await makeAdmin(prisma);
    const reader = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    const typistRow = await assignments.assign(
      paper.testId,
      body({
        baseConfigSectionId: paper.sectionIds[0] ?? '',
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );
    const readerRow = await assignments.assign(
      paper.testId,
      body({
        baseConfigSectionId: paper.sectionIds[0] ?? '',
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    await assignments.finalize(typistRow.id, typist.id);

    await assert.rejects(
      () => finalizer.offer(paper.testId),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.VALIDATION_ERROR &&
        /1 section is still being proof-read: Reasoning/.test(error.message),
    );

    await assignments.finalize(readerRow.id, reader.id);
    const result = await finalizer.offer(paper.testId);

    assert.equal(result.status, TEST_STATUS.ACTIVE);
  });

  /** The override: a test cannot be unshippable because one person's row will never be finalized. */
  it('lets a super admin offer over a section nobody has marked read', async () => {
    const { assignments } = build();
    const finalizer = new FinalizeService(prisma, new FakeEventBus().asService());
    const paper = await makePaper(prisma, { sections: ['Reasoning'], questions: ['Quant'] });
    await sayFramed(paper.testId);
    await prisma.baseConfigSection.update({
      where: { id: paper.sectionIds[0] ?? '' },
      data: { questionCount: 1 },
    });
    const reader = await makeAdmin(prisma);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    await assignments.assign(
      paper.testId,
      body({
        baseConfigSectionId: paper.sectionIds[0] ?? '',
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    await assert.rejects(
      () => finalizer.offer(paper.testId),
      refusedWith(ErrorCodes.VALIDATION_ERROR),
    );
    const result = await finalizer.offer(paper.testId, true);

    assert.equal(result.status, TEST_STATUS.ACTIVE);
  });

  /** THE deadlock: switching to PICKED once left a typist row nobody could finalize, shutting offer for good. */
  it('offers a test switched to picked, the typist it discarded no longer holding it', async () => {
    const { assignments, tests } = build();
    const finalizer = new FinalizeService(prisma, new FakeEventBus().asService());
    const paper = await makePaper(prisma, { sections: ['Reasoning'], questions: ['Quant'] });
    await sayFramed(paper.testId);
    await prisma.baseConfigSection.update({
      where: { id: paper.sectionIds[0] ?? '' },
      data: { questionCount: 1 },
    });
    const typist = await makeAdmin(prisma, { fullName: 'Priya' });
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await assignments.assign(
      paper.testId,
      body({
        baseConfigSectionId: paper.sectionIds[0] ?? '',
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );

    await assert.rejects(
      () => finalizer.offer(paper.testId),
      refusedWith(ErrorCodes.VALIDATION_ERROR),
    );

    await tests.update(paper.testId, { paperSource: PAPER_SOURCES.PICKED }, true);
    const result = await finalizer.offer(paper.testId);

    assert.equal(result.status, TEST_STATUS.ACTIVE);
    assert.equal(await prisma.questionAssignment.count({ where: { testId: paper.testId } }), 0);
  });

  /** This replaces nothing: a test with no assignments offers exactly as it does today. */
  it('does not block a test that never had any assignments', async () => {
    const finalizer = new FinalizeService(prisma, new FakeEventBus().asService());
    const paper = await makePaper(prisma, { sections: ['Reasoning'], questions: ['Quant'] });
    await sayFramed(paper.testId);
    await prisma.baseConfigSection.update({
      where: { id: paper.sectionIds[0] ?? '' },
      data: { questionCount: 1 },
    });

    const result = await finalizer.offer(paper.testId);

    assert.equal(result.status, TEST_STATUS.ACTIVE);
  });
});

describe('AssignmentsService — what a section has written so far', () => {
  /** The failure this prevents: a reader's row reading 0 forever, because only a typist writes. */
  it('counts the section, so both roles report the same progress', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog, { name: 'Reasoning' });
    const subject = await makeSubject(prisma);
    const typist = await makeAdmin(prisma, { fullName: 'Priya' });
    const reader = await makeAdmin(prisma, { fullName: 'Arjun' });
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);

    const typing = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );
    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    for (const stem of ['One', 'Two', 'Three']) {
      const question = await makeQuestion(prisma, { subjectId: subject.id, stem });
      await prisma.question.update({
        where: { id: question.id },
        data: { assignmentId: typing.id },
      });
    }

    const rows = await assignments.forTest(test.id);

    assert.deepEqual(
      rows.map((row) => [row.role, row.writtenCount]).sort(),
      [
        [ASSIGNMENT_ROLES.PROOFREADER, 3],
        [ASSIGNMENT_ROLES.TYPIST, 3],
      ].sort(),
      'the reader waits on the same section the typist is filling',
    );
  });
});

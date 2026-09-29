import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  ADMIN_ROLES,
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
  sectionProgressQuerySchema,
  type AssignmentWithTest,
  type CreateAssignmentInput,
  type FeatureKey,
  type MineAssignmentsQueryInput,
  type PermissionLevel,
  type SectionProgressQueryInput,
  type SectionProgressRow,
  TEST_SCOPE,
} from '@iace/contracts';
import type { Prisma } from '@prisma/client';
import { AuditContext } from '../src/audit';
import { AdminsService } from '../src/admins/admins.service';
import { AssignmentsService } from '../src/assignments/assignments.service';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { FinalizeService } from '../src/tests/finalize.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { TestsService } from '../src/tests/tests.service';
import { FakeEventBus, FakeRedis } from '../test/support/fakes';
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
  const admins = new AdminsService(prisma, audit, new FakeEventBus().asService());
  const redis = new FakeRedis().asService();
  const configs = new BaseConfigsService(
    prisma,
    new ExamStagesService(prisma, audit, new FakeEventBus().asService()),
    audit,
    redis,
    new FakeEventBus().asService(),
  );
  return {
    assignments: new AssignmentsService(prisma, new FakeRedis().asService(), admins),
    admins,
    tests: new TestsService(
      prisma,
      configs,
      audit,
      new FakeEventBus().asService(),
      new FakeRedis().asService(),
    ),
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

/** The rows a queue read hands back — every caller below reads those, not the page around them. */
const queue = async (
  assignments: AssignmentsService,
  adminId: string,
  query: MineAssignmentsQueryInput = {},
): Promise<AssignmentWithTest[]> =>
  (await assignments.mine(adminId, mineAssignmentsQuerySchema.parse(query))).items;

const progress = async (
  assignments: AssignmentsService,
  query: SectionProgressQueryInput = {},
): Promise<SectionProgressRow[]> =>
  (await assignments.progress(sectionProgressQuerySchema.parse(query))).items;

/** A role the paper's source calls for that nobody has been given. */
const UNHELD = {
  assignmentId: null,
  assigneeId: null,
  assigneeName: null,
  dueAt: null,
  finalizedAt: null,
};

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

/** Done or read, reduced to its stamp, for a case about something else. */
const finalizedNow = (id: string) =>
  prisma.questionAssignment.update({ where: { id }, data: { finalizedAt: new Date() } });

/** A reader's release as the flow leaves it: every question on their section checked, then the stamp. */
async function releasedNow(id: string) {
  const { testId, baseConfigSectionId } = await prisma.questionAssignment.findUniqueOrThrow({
    where: { id },
  });
  const onPaper = await prisma.paperQuestion.findMany({
    where: { testId, baseConfigSectionId },
    select: { questionId: true },
  });
  await prisma.questionReview.createMany({
    data: onPaper.map(({ questionId }) => ({
      testId,
      baseConfigSectionId,
      questionId,
      checkedAt: new Date(),
    })),
  });
  await finalizedNow(id);
}

/** A section's paper at its count, handed to its reader and every question checked: ready to release. */
async function wholePaper(catalog: Catalog, testId: string, baseConfigSectionId: string) {
  await fillPaper(catalog, testId, baseConfigSectionId);
  const onPaper = await prisma.paperQuestion.findMany({
    where: { testId, baseConfigSectionId },
    select: { questionId: true },
  });
  await prisma.questionReview.createMany({
    data: onPaper.map(({ questionId }) => ({
      testId,
      baseConfigSectionId,
      questionId,
      checkedAt: new Date(),
    })),
  });
  await prisma.questionAssignment.updateMany({
    where: { testId, baseConfigSectionId, role: ASSIGNMENT_ROLES.PROOFREADER },
    data: { handedAt: new Date() },
  });
}

/** The paper at its count and nothing more: nobody has looked at it yet. */
async function fillPaper(catalog: Catalog, testId: string, baseConfigSectionId: string) {
  const subject = await makeSubject(prisma);
  const { questionCount } = await prisma.baseConfigSection.findUniqueOrThrow({
    where: { id: baseConfigSectionId },
  });
  for (let order = 1; order <= questionCount; order++) {
    const question = await makeQuestion(prisma, { subjectId: subject.id });
    await prisma.paperQuestion.create({
      data: {
        testId,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId,
        questionId: question.id,
        questionVersionId: question.versionId,
        order,
        marks: 2,
        negativeMarks: 0.5,
      },
    });
  }
}

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

/** Nothing outside the transaction can see a lock, so this records the order its statements left in. */
function watchingLocks(order: string[]): PrismaService {
  return new Proxy(prisma, {
    get(target, key: string | symbol) {
      if (key !== '$transaction') return Reflect.get(target, key) as unknown;
      return (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        target.$transaction((tx) =>
          work(
            new Proxy(tx, {
              get(inner, member: string | symbol) {
                if (member === '$queryRaw') {
                  return (sql: TemplateStringsArray, ...values: unknown[]) => {
                    if (sql.join('?').includes('FROM "Test"')) order.push('test');
                    return inner.$queryRaw(sql, ...values);
                  };
                }
                if (member !== 'questionAssignment') return Reflect.get(inner, member) as unknown;
                return new Proxy(inner.questionAssignment, {
                  get(delegate, method: string | symbol) {
                    if (method !== 'update') return Reflect.get(delegate, method) as unknown;
                    return (args: Prisma.QuestionAssignmentUpdateArgs) => {
                      order.push('holder');
                      return delegate.update(args);
                    };
                  },
                });
              },
            }),
          ),
        );
    },
  });
}

describe('AssignmentsService — one lock order, Test before its rows', () => {
  /** The failure this prevents: passing a role on while an edit that holds the test reopens the same holder, a deadlock. */
  it('locks the test before it marks the earlier holder replaced', async () => {
    const { assignments, admins } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const first = await makeAdmin(prisma);
    const second = await makeAdmin(prisma);
    await grant(first.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    await grant(second.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    const reading = (assigneeId: string) =>
      body({ baseConfigSectionId: section.id, assigneeId, role: ASSIGNMENT_ROLES.PROOFREADER });
    await assignments.assign(test.id, reading(first.id), first.id);
    const order: string[] = [];
    const watched = new AssignmentsService(
      watchingLocks(order),
      new FakeRedis().asService(),
      admins,
    );

    await watched.assign(test.id, reading(second.id), second.id);

    assert.deepEqual(order, ['test', 'holder']);
  });
});

describe('AssignmentsService — a hand-over reads the role as it is under the lock', () => {
  /** The failure this prevents: a new reader created already released, holding a section with an unchecked question. */
  it('carries over a reopen that landed after the checks, not the release read before it', async () => {
    const { assignments, admins } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const first = await makeAdmin(prisma);
    const second = await makeAdmin(prisma);
    await grant(first.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    await grant(second.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    const reading = (assigneeId: string) =>
      body({ baseConfigSectionId: section.id, assigneeId, role: ASSIGNMENT_ROLES.PROOFREADER });
    const earlier = await assignments.assign(test.id, reading(first.id), first.id);
    await prisma.questionAssignment.update({
      where: { id: earlier.id },
      data: { handedAt: new Date(), finalizedAt: new Date() },
    });
    const reopenedMidway = new Proxy(prisma, {
      get(target, key: string | symbol) {
        if (key !== '$transaction') return Reflect.get(target, key) as unknown;
        return async (...args: Parameters<PrismaService['$transaction']>) => {
          await target.questionAssignment.update({
            where: { id: earlier.id },
            data: { finalizedAt: null },
          });
          return target.$transaction(...args);
        };
      },
    });
    const racing = new AssignmentsService(reopenedMidway, new FakeRedis().asService(), admins);

    const next = await racing.assign(test.id, reading(second.id), second.id);

    assert.equal(next.finalizedAt, null);
  });
});

describe('AssignmentsService — a role its section took with it', () => {
  /** The failure this prevents: a holder told the role passed to somebody else when the section simply left the test. */
  it('says the section was dropped, apart from a role passed on', async () => {
    const { assignments, tests } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const kept = await makeSection(prisma, catalog, { name: 'Reasoning' });
    const dropped = await makeSection(prisma, catalog, { name: 'Quant', order: 2 });
    const [first, second, third] = [
      await makeAdmin(prisma),
      await makeAdmin(prisma),
      await makeAdmin(prisma),
    ];
    for (const admin of [first, second, third]) {
      await grant(admin.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    }
    const reading = (baseConfigSectionId: string, assigneeId: string) =>
      body({ baseConfigSectionId, assigneeId, role: ASSIGNMENT_ROLES.PROOFREADER });
    const passedOn = await assignments.assign(test.id, reading(kept.id, first.id), first.id);
    await assignments.assign(test.id, reading(kept.id, second.id), second.id);
    const standing = await assignments.assign(test.id, reading(dropped.id, third.id), third.id);

    await tests.update(test.id, {
      scope: TEST_SCOPE.SECTIONAL,
      scopeRef: { sectionId: kept.id },
    });

    const rows = await assignments.forTest(test.id);
    const byId = new Map(rows.map((row) => [row.id, row]));
    assert.equal(byId.get(passedOn.id)?.sectionDropped, false);
    assert.equal(byId.get(standing.id)?.sectionDropped, true);
    await assert.rejects(
      () => assignments.remove(standing.id),
      (error: unknown) => AppException.is(error) && /left the test/.test(error.message),
    );
    await assert.rejects(
      () => assignments.finalize(standing.id, third.id, false),
      (error: unknown) => AppException.is(error) && /left the test/.test(error.message),
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

    assert.deepEqual(typists, [{ id: holder.id, fullName: 'Priya', role: ADMIN_ROLES.ADMIN }]);
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
    await finalizedNow(created.id);

    await assert.rejects(() => assignments.remove(created.id), refusedWith(ErrorCodes.CONFLICT));
  });
});

describe('AssignmentsService — a typist hands over with Done, not finalize', () => {
  /** The failure this prevents: a typist marking a section written without choosing its paper. */
  it('refuses to finalize a typing job', async () => {
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

    await assert.rejects(
      () => assignments.finalize(created.id, typist.id),
      refusedWith(ErrorCodes.CONFLICT),
    );
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

    const mine = await queue(assignments, reader.id);

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

    const typistQueue = await queue(assignments, admin.id, { role: ASSIGNMENT_ROLES.TYPIST });

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

    const mine = await queue(assignments, reader.id);

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

    const mine = await queue(assignments, typist.id);

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
    await finalizedNow(done.id);

    const outstanding = await queue(assignments, reader.id, { outstanding: 'true' });

    assert.equal(outstanding.length, 1);
    assert.equal(outstanding[0]?.baseConfigSectionId, sectionB.id);
  });

  /** The failure this prevents: a queue offering Mark read before the section reached its reader, or Done on a picked paper. */
  it('offers Done on a typed section alone, and Mark read only once the section is handed over', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const typed = await framed(catalog);
    const picked = await makeTest(prisma, catalog, { paperSource: PAPER_SOURCES.PICKED });
    const section = await makeSection(prisma, catalog);
    const typist = await makeAdmin(prisma);
    const reader = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await grant(reader.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    for (const test of [typed, picked]) {
      await assignments.assign(
        test.id,
        body({ baseConfigSectionId: section.id, assigneeId: typist.id }),
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
    }
    await prisma.questionAssignment.updateMany({
      where: { testId: picked.id, role: ASSIGNMENT_ROLES.PROOFREADER },
      data: { handedAt: new Date() },
    });

    const gates = async (adminId: string) =>
      new Map(
        (await queue(assignments, adminId)).map((row) => [
          row.testId,
          { done: row.canMarkDone, read: row.canMarkRead },
        ]),
      );
    const typing = await gates(typist.id);
    const reading = await gates(reader.id);

    assert.deepEqual(typing.get(typed.id), { done: true, read: false });
    assert.deepEqual(typing.get(picked.id), { done: false, read: false });
    assert.deepEqual(reading.get(typed.id), { done: false, read: false });
    assert.deepEqual(reading.get(picked.id), { done: false, read: true });
  });

  /** The queue is per-assignee for everybody but a super admin: another's row and an unheld section are both absent. */
  it('shows an ordinary admin their own rows and nothing else', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const ours = await makeSection(prisma, catalog, { name: 'Ours', order: 1 });
    const theirs = await makeSection(prisma, catalog, { name: 'Theirs', order: 2 });
    await makeSection(prisma, catalog, { name: 'Nobody’s', order: 3 });
    const typist = await makeAdmin(prisma);
    const other = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await grant(other.id, FEATURE_KEYS.QUESTION_AUTHORING);
    const own = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: ours.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );
    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: theirs.id,
        assigneeId: other.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      other.id,
    );

    const rows = await queue(assignments, typist.id, { role: ASSIGNMENT_ROLES.TYPIST });

    assert.deepEqual(
      rows.map((row) => row.id),
      [own.id],
    );
  });

  it('the test, section and due-date filters narrow an admin’s own queue', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const banking = await framed(catalog, { title: 'Banking prelims mock' });
    const railway = await framed(catalog, { title: 'Railway mock' });
    const reasoning = await makeSection(prisma, catalog, { name: 'Reasoning', order: 1 });
    const english = await makeSection(prisma, catalog, { name: 'English', order: 2 });
    const typist = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await assignments.assign(
      banking.id,
      body({
        baseConfigSectionId: reasoning.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
        dueAt: '2026-10-05T04:00:00.000Z',
      }),
      typist.id,
    );
    await assignments.assign(
      railway.id,
      body({
        baseConfigSectionId: english.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
        dueAt: '2026-10-09T04:00:00.000Z',
      }),
      typist.id,
    );

    const byTest = await queue(assignments, typist.id, { testId: railway.id });
    const bySection = await queue(assignments, typist.id, { baseConfigSectionId: reasoning.id });
    const byDue = await queue(assignments, typist.id, { dueFrom: '2026-10-06' });

    assert.deepEqual(
      byTest.map((row) => row.sectionName),
      ['English'],
    );
    assert.deepEqual(
      bySection.map((row) => row.testTitle),
      ['Banking prelims mock'],
    );
    assert.deepEqual(
      byDue.map((row) => row.sectionName),
      ['English'],
    );
  });
});

describe('AssignmentsService — section progress', () => {
  /** The reported case: a DRAFT, FRAMED test with not one assignment row on it. */
  it('lists a FRAMED test’s sections that nobody has been assigned', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog, { title: 'SSC CGL Tier 1 — Mock 01' });
    const section = await makeSection(prisma, catalog, { name: 'Reasoning' });

    const rows = await progress(assignments);

    assert.equal(rows.length, 1);
    assert.deepEqual(
      [rows[0]?.testId, rows[0]?.baseConfigSectionId, rows[0]?.testTitle, rows[0]?.sectionName],
      [test.id, section.id, 'SSC CGL Tier 1 — Mock 01', 'Reasoning'],
    );
    assert.equal(rows[0]?.sectionQuestionCount, 10);
    assert.deepEqual(rows[0]?.typing, UNHELD);
    assert.deepEqual(rows[0]?.reading, UNHELD);
  });

  /** What `321d332` dropped, and the whole point of a progress view: finished is a state, not an exit. */
  it('keeps a section whose typing and reading are both finished', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog, { name: 'Reasoning' });
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
    const reading = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );
    await finalizedNow(typing.id);
    await finalizedNow(reading.id);

    const rows = await progress(assignments);

    assert.equal(rows.length, 1, 'a finished section still answers "how is this test going"');
    assert.ok(rows[0]?.typing?.finalizedAt);
    assert.ok(rows[0]?.reading?.finalizedAt);
  });

  /** Two rows each telling half the story is exactly what this replaces. */
  it('carries both roles on ONE row per section', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog, { name: 'Reasoning' });
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
        dueAt: '2026-10-05T04:00:00.000Z',
      }),
      typist.id,
    );
    const reading = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );

    const rows = await progress(assignments);

    assert.equal(rows.length, 1);
    assert.deepEqual(
      [rows[0]?.typing?.assignmentId, rows[0]?.typing?.assigneeName, rows[0]?.typing?.dueAt],
      [typing.id, 'Priya', '2026-10-05T04:00:00.000Z'],
    );
    assert.deepEqual(
      [rows[0]?.reading?.assignmentId, rows[0]?.reading?.assigneeName],
      [reading.id, 'Arjun'],
    );
  });

  /** The reported oddity: the questions hang off the TYPIST's row, and the number is the section's. */
  it('counts the section’s questions once, whichever role holds them', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const subject = await makeSubject(prisma);
    const typist = await makeAdmin(prisma);
    const reader = await makeAdmin(prisma);
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
    const reading = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );
    for (const stem of ['One', 'Two']) {
      const question = await makeQuestion(prisma, { subjectId: subject.id, stem });
      await prisma.question.update({
        where: { id: question.id },
        data: { assignmentId: typing.id },
      });
    }

    const rows = await progress(assignments);
    const asReader = await assignments.one(reading.id, reader.id, false);

    assert.equal(rows[0]?.writtenCount, 2);
    assert.equal(asReader.writtenCount, 2, 'the reader waits on the section, not on their own row');
  });

  it('gives a PICKED test both roles: its typist fixes what the reader sends back', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    await makeTest(prisma, catalog, { paperSource: PAPER_SOURCES.PICKED });
    const section = await makeSection(prisma, catalog);

    const rows = await progress(assignments);

    assert.equal(rows[0]?.baseConfigSectionId, section.id);
    assert.deepEqual(rows[0]?.typing, UNHELD);
    assert.deepEqual(rows[0]?.reading, UNHELD);
  });

  /** A frozen paper cannot be typed or read again, so it is no longer in progress. */
  it('drops every section of a test whose paper has been frozen', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    await makeSection(prisma, catalog);
    await prisma.test.update({ where: { id: test.id }, data: { finalizedAt: new Date() } });

    const rows = await progress(assignments);

    assert.deepEqual(rows, []);
  });

  it('the test and section filters narrow it to one row', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const banking = await framed(catalog, { title: 'Banking prelims mock' });
    await framed(catalog, { title: 'Railway mock' });
    await makeSection(prisma, catalog, { name: 'Reasoning', order: 1 });
    const quantitative = await makeSection(prisma, catalog, {
      name: 'Quantitative aptitude',
      order: 2,
    });

    const byTest = await progress(assignments, { testId: banking.id });
    const byBoth = await progress(assignments, {
      testId: banking.id,
      baseConfigSectionId: quantitative.id,
    });

    assert.deepEqual(
      byTest.map((one) => one.testTitle),
      ['Banking prelims mock', 'Banking prelims mock'],
    );
    assert.deepEqual(
      byBoth.map((one) => [one.testTitle, one.sectionName]),
      [['Banking prelims mock', 'Quantitative aptitude']],
    );
  });

  /** Both filters read EITHER half of a row: one section, two assignees, two due dates. */
  it('the assignee and due-date filters read either half of a row', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const shared = await makeSection(prisma, catalog, { name: 'Shared', order: 1 });
    const late = await makeSection(prisma, catalog, { name: 'Late', order: 2 });
    await makeSection(prisma, catalog, { name: 'Unheld', order: 3 });
    const priya = await makeAdmin(prisma, { fullName: 'Priya' });
    const arjun = await makeAdmin(prisma, { fullName: 'Arjun' });
    await grant(priya.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await grant(arjun.id, FEATURE_KEYS.QUESTION_PROOFREAD);
    await grant(arjun.id, FEATURE_KEYS.QUESTION_AUTHORING);
    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: shared.id,
        assigneeId: priya.id,
        role: ASSIGNMENT_ROLES.TYPIST,
        dueAt: '2026-10-05T04:00:00.000Z',
      }),
      priya.id,
    );
    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: shared.id,
        assigneeId: arjun.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
        dueAt: '2026-10-20T04:00:00.000Z',
      }),
      arjun.id,
    );
    await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: late.id,
        assigneeId: arjun.id,
        role: ASSIGNMENT_ROLES.TYPIST,
        dueAt: '2026-10-09T04:00:00.000Z',
      }),
      arjun.id,
    );

    const readByArjun = await progress(assignments, { assigneeId: [arjun.id] });
    const thatWeek = await progress(assignments, { dueFrom: '2026-10-05', dueTo: '2026-10-06' });

    assert.deepEqual(
      readByArjun.map((one) => one.sectionName),
      ['Shared', 'Late'],
      'a section he only reads is still his',
    );
    assert.deepEqual(
      thatWeek.map((one) => one.sectionName),
      ['Shared'],
      'the typist’s date is in range even though the reader’s is not',
    );
  });

  /** Institute-wide work outgrows a page, and a list that stops at its first one lies about the rest. */
  it('pages, and reports the whole count with the page', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    await framed(catalog);
    for (const order of [1, 2, 3]) {
      await makeSection(prisma, catalog, { name: `Section ${order}`, order });
    }

    const first = await assignments.progress(
      sectionProgressQuerySchema.parse({ page: 1, pageSize: 2 }),
    );
    const second = await assignments.progress(
      sectionProgressQuerySchema.parse({ page: 2, pageSize: 2 }),
    );

    assert.equal(first.total, 3);
    assert.deepEqual(
      first.items.map((one) => one.sectionName),
      ['Section 1', 'Section 2'],
    );
    assert.deepEqual(
      second.items.map((one) => one.sectionName),
      ['Section 3'],
    );
  });
});

describe('AssignmentsService — one', () => {
  it('hands an admin their own row and refuses somebody else’s', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog, { title: 'Mock 01' });
    const section = await makeSection(prisma, catalog, { name: 'Reasoning' });
    const typist = await makeAdmin(prisma);
    const stranger = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    const row = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );

    const own = await assignments.one(row.id, typist.id, false);

    assert.equal(own.testTitle, 'Mock 01');
    assert.equal(own.sectionName, 'Reasoning');
    await assert.rejects(
      () => assignments.one(row.id, stranger.id, false),
      refusedWith(ErrorCodes.NOT_FOUND),
    );
  });

  /** The same override f88acce gave every other gate: whoever owns the institute reads any row. */
  it('hands a super admin somebody else’s row', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const typist = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    const row = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );
    const superAdmin = await makeAdmin(prisma, { isSuperAdmin: true });

    const seen = await assignments.one(row.id, superAdmin.id, true);

    assert.equal(seen.id, row.id);
  });

  /** What the editor opens pre-configured on: the section names the subject, not the typist. */
  it('carries the section’s subject, and null where the section names none', async () => {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const named = await makeSection(prisma, catalog, { name: 'Reasoning', order: 1 });
    const open = await makeSection(prisma, catalog, { name: 'General awareness', order: 2 });
    const subject = await makeSubject(prisma);
    await prisma.baseConfigSection.update({
      where: { id: named.id },
      data: { subjectId: subject.id },
    });
    const typist = await makeAdmin(prisma);
    await grant(typist.id, FEATURE_KEYS.QUESTION_AUTHORING);
    const onNamed = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: named.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );
    const onOpen = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: open.id,
        assigneeId: typist.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      }),
      typist.id,
    );

    assert.equal(
      (await assignments.one(onNamed.id, typist.id, false)).sectionSubjectId,
      subject.id,
    );
    assert.equal((await assignments.one(onOpen.id, typist.id, false)).sectionSubjectId, null);
  });
});

describe('AssignmentsService — finalizing', () => {
  /** Re-reading is the same fact restated, so the stamp MOVES — that is what re-covers a paper. */
  it('sets finalizedAt, and moves it when the section is marked again', async () => {
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

    await wholePaper(catalog, test.id, section.id);
    const first = await assignments.finalize(created.id, reader.id);
    const second = await assignments.finalize(created.id, reader.id);

    assert.ok(first.finalizedAt);
    assert.ok(second.finalizedAt);
    assert.ok(
      new Date(second.finalizedAt) >= new Date(first.finalizedAt),
      'a second reading never predates the first',
    );
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

    await wholePaper(catalog, test.id, section.id);
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

    await releasedNow(created.id);
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

    await finalizedNow(typistRow.id);

    await assert.rejects(
      () => finalizer.offer(paper.testId),
      (error: unknown) =>
        AppException.is(error) &&
        error.code === ErrorCodes.VALIDATION_ERROR &&
        /1 section is still being proof-read: Reasoning/.test(error.message),
    );

    await releasedNow(readerRow.id);
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

  /** A picked section's typist only fixes what comes back, so theirs is no job the offer waits on. */
  it('offers a picked test whose typist never finished anything', async () => {
    const { assignments } = build();
    const finalizer = new FinalizeService(prisma, new FakeEventBus().asService());
    const paper = await makePaper(prisma, { sections: ['Reasoning'], questions: ['Quant'] });
    await prisma.test.update({
      where: { id: paper.testId },
      data: { paperSource: PAPER_SOURCES.PICKED },
    });
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

    const result = await finalizer.offer(paper.testId);

    assert.equal(result.status, TEST_STATUS.ACTIVE);
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

describe('AssignmentsService — a reader gets a whole section', () => {
  async function bothRoles() {
    const { assignments } = build();
    const catalog = await makeCatalog(prisma);
    const test = await framed(catalog);
    const section = await makeSection(prisma, catalog);
    const typist = await makeAdmin(prisma);
    const reader = await makeAdmin(prisma);
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
    const reading = await assignments.assign(
      test.id,
      body({
        baseConfigSectionId: section.id,
        assigneeId: reader.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      }),
      reader.id,
    );
    return { assignments, catalog, test, section, typing, reading, reader };
  }

  /** The failure this prevents: a section released before every question on it was looked at. */
  it('refuses release before the section reaches the reader, while short, and while unchecked', async () => {
    const { assignments, catalog, test, section, typing, reading, reader } = await bothRoles();

    await assert.rejects(
      () => assignments.finalize(reading.id, reader.id),
      refusedWith(ErrorCodes.CONFLICT),
      'nothing has reached the reader yet',
    );
    await finalizedNow(typing.id);
    await prisma.questionAssignment.update({
      where: { id: reading.id },
      data: { handedAt: new Date() },
    });
    await assert.rejects(
      () => assignments.finalize(reading.id, reader.id),
      refusedWith(ErrorCodes.CONFLICT),
      'the paper is short',
    );

    await fillPaper(catalog, test.id, section.id);
    await assert.rejects(
      () => assignments.finalize(reading.id, reader.id),
      (error: unknown) => AppException.is(error) && /not checked yet/.test(error.message),
    );

    const onPaper = await prisma.paperQuestion.findMany({
      where: { testId: test.id },
      select: { questionId: true },
    });
    await prisma.questionReview.createMany({
      data: onPaper.map(({ questionId }) => ({
        testId: test.id,
        baseConfigSectionId: section.id,
        questionId,
        checkedAt: new Date(),
      })),
    });
    const released = await assignments.finalize(reading.id, reader.id);
    assert.ok(released.finalizedAt);
  });

  /** A role passes on and the record stays: who did what is not rewritten by who does it next. */
  it('hands a role to somebody new, keeping the earlier holder as the record', async () => {
    const { assignments, test, section, typing } = await bothRoles();
    await finalizedNow(typing.id);
    const next = await makeAdmin(prisma);
    await grant(next.id, FEATURE_KEYS.QUESTION_AUTHORING);

    const taken = await assignments.assign(
      test.id,
      body({ baseConfigSectionId: section.id, assigneeId: next.id, role: ASSIGNMENT_ROLES.TYPIST }),
      next.id,
    );

    const earlier = await prisma.questionAssignment.findUniqueOrThrow({ where: { id: typing.id } });
    assert.notEqual(earlier.replacedAt, null);
    assert.ok(taken.finalizedAt, 'the section’s progress carries over to whoever holds the role');
    await assert.rejects(
      () =>
        assignments.assign(
          test.id,
          body({
            baseConfigSectionId: section.id,
            assigneeId: next.id,
            role: ASSIGNMENT_ROLES.TYPIST,
          }),
          next.id,
        ),
      refusedWith(ErrorCodes.VALIDATION_ERROR),
    );
  });

  it('takes back a role nobody has worked under, and refuses once somebody has', async () => {
    const { assignments, test, section, typing, reading, reader } = await bothRoles();

    await prisma.sectionComment.create({
      data: {
        testId: test.id,
        baseConfigSectionId: section.id,
        authorId: reader.id,
        body: 'Starting on this tomorrow.',
      },
    });
    await assert.rejects(() => assignments.remove(reading.id), refusedWith(ErrorCodes.CONFLICT));

    await assignments.remove(typing.id);
    assert.equal(await prisma.questionAssignment.count({ where: { id: typing.id } }), 0);
  });
});

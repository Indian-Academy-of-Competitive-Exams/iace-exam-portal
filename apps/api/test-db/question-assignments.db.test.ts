import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { ASSIGNMENT_ROLES } from '@iace/contracts';
import {
  makeAdmin,
  makeCatalog,
  makeQuestion,
  makeSection,
  makeSubject,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const prisma = testPrisma();

describe('question assignments', () => {
  beforeEach(() => resetDatabase(prisma));
  after(() => prisma.$disconnect());

  it('takes one typist and one proof-reader on the same section', async () => {
    const catalog = await makeCatalog(prisma);
    const test = await makeTest(prisma, catalog);
    const section = await makeSection(prisma, catalog);
    const admin = await makeAdmin(prisma);

    const typist = await prisma.questionAssignment.create({
      data: {
        id: uid(),
        testId: test.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: section.id,
        assigneeId: admin.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      },
      select: { id: true },
    });
    const reader = await prisma.questionAssignment.create({
      data: {
        id: uid(),
        testId: test.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: section.id,
        assigneeId: admin.id,
        role: ASSIGNMENT_ROLES.PROOFREADER,
      },
      select: { id: true },
    });

    assert.notEqual(typist.id, reader.id);
  });

  it('refuses a second typist on a section already assigned one', async () => {
    const catalog = await makeCatalog(prisma);
    const test = await makeTest(prisma, catalog);
    const section = await makeSection(prisma, catalog);
    const admin = await makeAdmin(prisma);

    await prisma.questionAssignment.create({
      data: {
        id: uid(),
        testId: test.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: section.id,
        assigneeId: admin.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      },
    });

    await assert.rejects(() =>
      prisma.questionAssignment.create({
        data: {
          id: uid(),
          testId: test.id,
          baseConfigId: catalog.baseConfigId,
          baseConfigSectionId: section.id,
          assigneeId: admin.id,
          role: ASSIGNMENT_ROLES.TYPIST,
        },
      }),
    );
  });

  it('refuses a section that belongs to a different base config than the test', async () => {
    const catalog = await makeCatalog(prisma);
    const otherCatalog = await makeCatalog(prisma);
    const test = await makeTest(prisma, catalog);
    const sectionFromOtherConfig = await makeSection(prisma, otherCatalog);
    const admin = await makeAdmin(prisma);

    await assert.rejects(() =>
      prisma.questionAssignment.create({
        data: {
          id: uid(),
          testId: test.id,
          // The test's own baseConfigId, paired with a section that lives under a different one.
          baseConfigId: catalog.baseConfigId,
          baseConfigSectionId: sectionFromOtherConfig.id,
          assigneeId: admin.id,
          role: ASSIGNMENT_ROLES.TYPIST,
        },
      }),
    );
  });

  it("deleting the test cascades its section's assignments away", async () => {
    const catalog = await makeCatalog(prisma);
    const test = await makeTest(prisma, catalog);
    const section = await makeSection(prisma, catalog);
    const admin = await makeAdmin(prisma);

    const assignment = await prisma.questionAssignment.create({
      data: {
        id: uid(),
        testId: test.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: section.id,
        assigneeId: admin.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      },
      select: { id: true },
    });

    await prisma.test.delete({ where: { id: test.id } });

    const found = await prisma.questionAssignment.findUnique({ where: { id: assignment.id } });
    assert.equal(found, null);
  });

  it('deleting an assignment leaves its questions, with assignmentId back to null', async () => {
    const catalog = await makeCatalog(prisma);
    const test = await makeTest(prisma, catalog);
    const section = await makeSection(prisma, catalog);
    const admin = await makeAdmin(prisma);
    const subject = await makeSubject(prisma);
    const question = await makeQuestion(prisma, { subjectId: subject.id });

    const assignment = await prisma.questionAssignment.create({
      data: {
        id: uid(),
        testId: test.id,
        baseConfigId: catalog.baseConfigId,
        baseConfigSectionId: section.id,
        assigneeId: admin.id,
        role: ASSIGNMENT_ROLES.TYPIST,
      },
      select: { id: true },
    });
    await prisma.question.update({
      where: { id: question.id },
      data: { assignmentId: assignment.id },
    });

    await prisma.questionAssignment.delete({ where: { id: assignment.id } });

    const found = await prisma.question.findUniqueOrThrow({ where: { id: question.id } });
    assert.equal(found.assignmentId, null);
  });
});

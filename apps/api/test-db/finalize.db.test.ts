import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ASSIGNMENT_ROLES,
  ErrorCodes,
  TEST_SCOPE,
  TEST_STATUS,
  type TestStatus,
} from '@iace/contracts';
import type { PrismaService } from '../src/prisma/prisma.service';
import {
  makeAdmin,
  makePaper,
  makeQuestion,
  offerTest,
  resetDatabase,
  testPrisma,
  uid,
  type Paper,
} from './support/database';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** A draft whose config asks three of Reasoning and two of Quant; the paper holds `held` of each. */
async function draft(held: readonly [number, number] = [3, 2]): Promise<Paper> {
  const paper = await makePaper(prisma, {
    sections: ['Reasoning', 'Quant'],
    questions: [
      ...Array.from({ length: held[0] }, () => ({ subject: 'Reasoning', section: 0 })),
      ...Array.from({ length: held[1] }, () => ({ subject: 'Quant', section: 1 })),
    ],
  });
  for (const [index, questionCount] of [3, 2].entries()) {
    await prisma.baseConfigSection.update({
      where: { id: paper.sectionIds[index] ?? '' },
      data: { questionCount },
    });
  }
  return paper;
}

/** A SECTIONAL draft holding rows in its one scoped section alone — the shape PaperService now writes. */
async function sectionalDraft(held: number): Promise<Paper> {
  const paper = await makePaper(prisma, {
    sections: ['Reasoning', 'Quant'],
    scope: TEST_SCOPE.SECTIONAL,
    questions: Array.from({ length: held }, () => ({ subject: 'Reasoning', section: 0 })),
  });
  await prisma.baseConfigSection.update({
    where: { id: paper.sectionIds[0] ?? '' },
    data: { questionCount: 3 },
  });
  await prisma.test.update({
    where: { id: paper.testId },
    data: { scopeRef: { sectionId: paper.sectionIds[0] } },
  });
  return paper;
}

const testRow = (paper: Paper) => prisma.test.findUniqueOrThrow({ where: { id: paper.testId } });

const configRow = (paper: Paper) =>
  prisma.baseConfig.findUniqueOrThrow({ where: { id: paper.catalog.baseConfigId } });

const statusOf = async (paper: Paper): Promise<TestStatus> => (await testRow(paper)).status;

/** A released reading of one section, and a tick from its reader on every question there but `unchecked`. */
async function readSection(paper: Paper, sectionIndex: number, unchecked: readonly string[] = []) {
  const admin = await makeAdmin(prisma);
  const baseConfigSectionId = paper.sectionIds[sectionIndex] ?? '';
  await prisma.questionAssignment.create({
    data: {
      id: uid(),
      testId: paper.testId,
      baseConfigId: paper.catalog.baseConfigId,
      baseConfigSectionId,
      assigneeId: admin.id,
      role: ASSIGNMENT_ROLES.PROOFREADER,
      handedAt: new Date(),
      finalizedAt: new Date(),
    },
  });
  const onPaper = await prisma.paperQuestion.findMany({
    where: { testId: paper.testId, baseConfigSectionId, questionId: { notIn: [...unchecked] } },
    select: { questionId: true },
  });
  await prisma.questionReview.createMany({
    data: onPaper.map(({ questionId }) => ({
      testId: paper.testId,
      baseConfigSectionId,
      questionId,
      checkedAt: new Date(),
      checkedById: admin.id,
    })),
  });
}

describe('FinalizeService — a reading covers the paper, not just the section', () => {
  /** The failure this prevents: a question nobody checked reaching a student because the row said released. */
  it('refuses a paper question its reader has not checked', async () => {
    const paper = await draft();
    const [swappedIn] = await prisma.paperQuestion.findMany({
      where: { testId: paper.testId, baseConfigSectionId: paper.sectionIds[0] ?? '' },
      select: { questionId: true },
    });
    await readSection(paper, 0, [swappedIn?.questionId ?? '']);
    await readSection(paper, 1);

    const error = await offerTest(prisma, paper.testId)
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    assert.ok(AppException.is(error));
    assert.match(
      error.message,
      /Reasoning has 1 question on the paper its proof-reader has not checked/,
    );
  });

  /** The failure this prevents: a question swapped in after the gate read the paper, offered unchecked. */
  it('reads the paper for the gate behind its own claim, not before it', async () => {
    const paper = await draft();
    await readSection(paper, 0);
    await readSection(paper, 1);
    const [row] = await prisma.paperQuestion.findMany({ where: { testId: paper.testId } });
    const { subjectId } = await prisma.question.findUniqueOrThrow({
      where: { id: row?.questionId ?? '' },
    });
    const unread = await makeQuestion(prisma, { subjectId });
    const swappedMidway = new Proxy(prisma, {
      get(target, key) {
        if (key !== '$transaction') return Reflect.get(target, key) as unknown;
        return async (...args: Parameters<PrismaService['$transaction']>) => {
          await target.paperQuestion.update({
            where: { id: row?.id ?? '' },
            data: { questionId: unread.id, questionVersionId: unread.versionId },
          });
          return target.$transaction(...args);
        };
      },
    });

    const error = await offerTest(swappedMidway, paper.testId)
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    assert.ok(AppException.is(error));
    assert.match(error.message, /has not checked/);
    assert.equal((await testRow(paper)).finalizedAt, null);
  });

  it('offers a paper whose every question its reader checked', async () => {
    const paper = await draft();
    await readSection(paper, 0);
    await readSection(paper, 1);

    await offerTest(prisma, paper.testId);

    assert.equal(await statusOf(paper), TEST_STATUS.ACTIVE);
  });
});

describe('FinalizeService — the offer freezes the paper', () => {
  it('stamps the test, opens it, and bumps the optimistic version in one write', async () => {
    const paper = await draft();

    await offerTest(prisma, paper.testId);

    const test = await testRow(paper);
    assert.ok(test.finalizedAt);
    assert.equal(test.status, TEST_STATUS.ACTIVE);
    assert.equal(test.version, 1);
    assert.equal(await prisma.paperQuestion.count({ where: { testId: paper.testId } }), 5);
  });

  /** The failure this prevents: a blueprint stranded locked by a test nobody ever sat. */
  it('leaves the config alone, because nobody is sitting anything yet', async () => {
    const paper = await draft();

    await offerTest(prisma, paper.testId);

    assert.equal((await configRow(paper)).locked, false);
  });
});

describe('FinalizeService — a second offer', () => {
  it('is a no-op that reports the first one’s outcome', async () => {
    const paper = await draft();

    await offerTest(prisma, paper.testId);
    const first = await testRow(paper);
    await offerTest(prisma, paper.testId);

    const second = await testRow(paper);
    assert.deepEqual(second.finalizedAt, first.finalizedAt);
    assert.equal(second.version, 1);
  });

  it('lets exactly one of two concurrent offers do the work', async () => {
    const paper = await draft();

    await Promise.all([offerTest(prisma, paper.testId), offerTest(prisma, paper.testId)]);

    // Both read version 0; only the one whose conditional update still matched may write.
    assert.equal((await testRow(paper)).version, 1);
  });

  /** The failure this prevents: a paper gone short behind the service's back put back in front of students. */
  it('still proves the paper of a finalized test before opening it again', async () => {
    const paper = await draft();
    await offerTest(prisma, paper.testId);
    const [dropped] = await prisma.paperQuestion.findMany({
      where: { testId: paper.testId, baseConfigSectionId: paper.sectionIds[1] ?? '' },
      select: { id: true },
    });
    await prisma.paperQuestion.delete({ where: { id: dropped?.id ?? '' } });
    await prisma.test.update({
      where: { id: paper.testId },
      data: { status: TEST_STATUS.INACTIVE },
    });

    await assert.rejects(() => offerTest(prisma, paper.testId), /Quant holds 1 of the 2/);

    assert.equal(await statusOf(paper), TEST_STATUS.INACTIVE);
  });

  /** `finalizedAt` is the watermark: without it a retired test re-offered would re-freeze its paper. */
  it('opens a retired test again without re-freezing its paper', async () => {
    const paper = await draft();
    await offerTest(prisma, paper.testId);
    const first = await testRow(paper);
    await prisma.test.update({
      where: { id: paper.testId },
      data: { status: TEST_STATUS.INACTIVE },
    });

    await offerTest(prisma, paper.testId);

    const again = await testRow(paper);
    assert.equal(again.status, TEST_STATUS.ACTIVE);
    assert.deepEqual(again.finalizedAt, first.finalizedAt);
    assert.equal(again.version, 1);
  });
});

describe('FinalizeService — a scoped test is judged by its own sections alone', () => {
  /** THE failure this prevents: a SECTIONAL test that can never be offered because F1 judged the whole config. */
  it('offers a SECTIONAL test whose one scoped section is full', async () => {
    const paper = await sectionalDraft(3);

    await offerTest(prisma, paper.testId);

    assert.equal(await statusOf(paper), TEST_STATUS.ACTIVE);
    assert.ok((await testRow(paper)).finalizedAt);
  });

  it('still refuses a SECTIONAL test whose scoped section is short, naming only that section', async () => {
    const paper = await sectionalDraft(2);

    const error = await offerTest(prisma, paper.testId)
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    assert.ok(AppException.is(error));
    assert.equal(error.message, 'Reasoning holds 2 of the 3 it needs.');
    const test = await testRow(paper);
    assert.equal(test.finalizedAt, null);
  });
});

describe('FinalizeService — what it refuses to offer', () => {
  it('refuses a test with no paper at all', async () => {
    const paper = await draft([0, 0]);

    await assert.rejects(
      () => offerTest(prisma, paper.testId),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.VALIDATION_ERROR,
    );
    const test = await testRow(paper);
    assert.deepEqual([test.finalizedAt, test.status], [null, TEST_STATUS.DRAFT]);
    assert.equal((await configRow(paper)).locked, false);
  });

  /** The failure this prevents: a 5-question paper offered holding 4, and scored as if whole. */
  it('refuses a section short of the count its config asks for, and puts the claim back', async () => {
    const paper = await draft([3, 1]);

    await assert.rejects(() => offerTest(prisma, paper.testId), /Quant holds 1 of the 2/);

    // The refusal happens INSIDE the transaction, so nothing it had already written survives.
    const test = await testRow(paper);
    assert.deepEqual([test.finalizedAt, test.status, test.version], [null, TEST_STATUS.DRAFT, 0]);
    assert.equal((await configRow(paper)).locked, false);
  });

  it('refuses a test that does not exist', async () => {
    await assert.rejects(
      () => offerTest(prisma, uid()),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

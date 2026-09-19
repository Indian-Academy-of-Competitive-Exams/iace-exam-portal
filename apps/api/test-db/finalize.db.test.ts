import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes, TEST_STATUS, type TestStatus } from '@iace/contracts';
import { FinalizeService } from '../src/tests/finalize.service';
import { FakeEventBus } from '../test/support/fakes';
import {
  makePaper,
  makeQuestion,
  resetDatabase,
  testPrisma,
  uid,
  type Paper,
} from './support/database';

const prisma = testPrisma();
const service = new FinalizeService(prisma, new FakeEventBus().asService());

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

const testRow = (paper: Paper) => prisma.test.findUniqueOrThrow({ where: { id: paper.testId } });

const configRow = (paper: Paper) =>
  prisma.baseConfig.findUniqueOrThrow({ where: { id: paper.catalog.baseConfigId } });

const statusOf = async (paper: Paper): Promise<TestStatus> => (await testRow(paper)).status;

const useCounts = async (paper: Paper) =>
  (
    await prisma.question.findMany({
      where: { id: { in: paper.items.map((item) => item.questionId) } },
      select: { fixedUseCount: true },
    })
  ).map((row) => row.fixedUseCount);

describe('FinalizeService — the offer freezes the paper', () => {
  it('stamps the test, opens it, and bumps the optimistic version in one write', async () => {
    const paper = await draft();

    const result = await service.offer(paper.testId);

    assert.equal(result.finalizedByThisCall, true);
    assert.equal(result.frozenQuestions, 5);
    assert.equal(result.status, TEST_STATUS.ACTIVE);
    const test = await testRow(paper);
    assert.ok(test.finalizedAt);
    assert.equal(test.status, TEST_STATUS.ACTIVE);
    assert.equal(test.version, 1);
  });

  /** The failure this prevents: a blueprint stranded locked by a test nobody ever sat. */
  it('leaves the config alone, because nobody is sitting anything yet', async () => {
    const paper = await draft();

    await service.offer(paper.testId);

    assert.equal((await configRow(paper)).locked, false);
  });

  /** `fixedUseCount` is what LEAST_SERVED ranks on, so a double count would bias every later draw. */
  it('counts each frozen question once against the bank, and one not on the paper not at all', async () => {
    const paper = await draft();
    const unused = await makeQuestion(prisma, { subjectId: paper.items[0]?.subjectId ?? '' });

    await service.offer(paper.testId);

    assert.deepEqual(await useCounts(paper), [1, 1, 1, 1, 1]);
    const untouched = await prisma.question.findUniqueOrThrow({ where: { id: unused.id } });
    assert.equal(untouched.fixedUseCount, 0);
  });
});

describe('FinalizeService — a second offer', () => {
  it('is a no-op that reports the first one’s outcome', async () => {
    const paper = await draft();

    const first = await service.offer(paper.testId);
    const second = await service.offer(paper.testId);

    assert.equal(first.finalizedByThisCall, true);
    assert.equal(second.finalizedByThisCall, false);
    assert.equal(second.finalizedAt, first.finalizedAt);
    // The failure this prevents: every question on the paper counted twice.
    assert.deepEqual(await useCounts(paper), [1, 1, 1, 1, 1]);
    assert.equal((await testRow(paper)).version, 1);
  });

  it('lets exactly one of two concurrent offers do the work', async () => {
    const paper = await draft();

    const results = await Promise.all([service.offer(paper.testId), service.offer(paper.testId)]);

    // Both read version 0; only the one whose conditional update still matched may write.
    assert.equal(results.filter((result) => result.finalizedByThisCall).length, 1);
    assert.equal((await testRow(paper)).version, 1);
    assert.deepEqual(await useCounts(paper), [1, 1, 1, 1, 1]);
  });

  /** `finalizedAt` is the watermark: without it a retired test re-offered counts its paper twice. */
  it('opens a retired test again without re-freezing or re-counting its paper', async () => {
    const paper = await draft();
    const first = await service.offer(paper.testId);
    await prisma.test.update({
      where: { id: paper.testId },
      data: { status: TEST_STATUS.INACTIVE },
    });

    const again = await service.offer(paper.testId);

    assert.equal(again.status, TEST_STATUS.ACTIVE);
    assert.equal(again.finalizedByThisCall, false);
    assert.equal(again.finalizedAt, first.finalizedAt);
    assert.equal(await statusOf(paper), TEST_STATUS.ACTIVE);
    assert.deepEqual(await useCounts(paper), [1, 1, 1, 1, 1]);
  });
});

describe('FinalizeService — what it refuses to offer', () => {
  it('refuses a test with no paper at all', async () => {
    const paper = await draft([0, 0]);

    await assert.rejects(
      () => service.offer(paper.testId),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.VALIDATION_ERROR,
    );
    const test = await testRow(paper);
    assert.deepEqual([test.finalizedAt, test.status], [null, TEST_STATUS.DRAFT]);
    assert.equal((await configRow(paper)).locked, false);
  });

  /** The failure this prevents: a 5-question paper offered holding 4, and scored as if whole. */
  it('refuses a section short of the count its config asks for, and puts the claim back', async () => {
    const paper = await draft([3, 1]);

    await assert.rejects(() => service.offer(paper.testId), /Quant holds 1 of the 2/);

    // The refusal happens INSIDE the transaction, so nothing it had already written survives.
    const test = await testRow(paper);
    assert.deepEqual([test.finalizedAt, test.status, test.version], [null, TEST_STATUS.DRAFT, 0]);
    assert.equal((await configRow(paper)).locked, false);
    assert.deepEqual(await useCounts(paper), [0, 0, 0, 0]);
  });

  it('refuses a test that does not exist', async () => {
    await assert.rejects(
      () => service.offer(uid()),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.NOT_FOUND,
    );
  });
});

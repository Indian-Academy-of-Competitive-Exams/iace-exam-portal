import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppException, ErrorCodes, PAPER_BINDING } from '@iace/contracts';
import { FinalizeService } from '../src/tests/finalize.service';
import {
  type FakePaperRow,
  type FakeSectionRow,
  FakeTestsPrisma,
  makeBaseConfig,
  makeQuestion,
  makeSection,
  makeTest,
} from './support/fakes';

const SECTIONS: FakeSectionRow[] = [
  makeSection({ id: 'sec_1', name: 'Reasoning', order: 1, subjectId: 'sub_r', questionCount: 3 }),
  makeSection({ id: 'sec_2', name: 'Quant', order: 2, subjectId: 'sub_q', questionCount: 2 }),
];

/** A whole paper: three for the first section, two for the second, each pinning a version. */
function wholePaper(testId = 'tst_1'): FakePaperRow[] {
  const rows = [
    ...Array.from({ length: 3 }, (_, index) => ['sec_1', `r${index + 1}`] as const),
    ...Array.from({ length: 2 }, (_, index) => ['sec_2', `q${index + 1}`] as const),
  ];
  return rows.map(([baseConfigSectionId, questionId], index) => ({
    id: `pq_${index + 1}`,
    testId,
    baseConfigId: 'cfg_1',
    baseConfigSectionId,
    questionId,
    questionVersionId: `${questionId}_v1`,
    order: index + 1,
    marks: 2,
    negativeMarks: 0.5,
    status: 'ACTIVE' as const,
  }));
}

function serviceWith(
  paper: FakePaperRow[] = wholePaper(),
  test = makeTest({ id: 'tst_1' }),
  config = makeBaseConfig({ id: 'cfg_1', totalQuestions: 5 }),
) {
  const questions = ['r1', 'r2', 'r3', 'q1', 'q2'].map((id) =>
    makeQuestion({ id, currentVersionId: `${id}_v1` }),
  );
  const prisma = new FakeTestsPrisma([test], [config], SECTIONS, [], [], questions, paper);
  return { prisma, service: new FinalizeService(prisma.asService()) };
}

describe('FinalizeService — freezing a fixed paper', () => {
  it('locks the test, stamps it, and bumps the optimistic version', async () => {
    const { service, prisma } = serviceWith();

    const result = await service.finalize('tst_1');

    assert.equal(result.finalizedByThisCall, true);
    assert.equal(result.frozenQuestions, 5);
    const test = prisma.tests[0]!;
    assert.equal(test.isLocked, true);
    assert.ok(test.finalizedAt);
    assert.equal(test.version, 1);
  });

  /** The failure this prevents: a blueprint stranded locked by a test nobody ever sat. */
  it('leaves the config alone, because nobody is sitting anything yet', async () => {
    const { service, prisma } = serviceWith();

    await service.finalize('tst_1');

    assert.equal(prisma.configs[0]!.locked, false);
  });

  it('counts each frozen question once against the bank', async () => {
    const { service, prisma } = serviceWith();

    await service.finalize('tst_1');

    // `fixedUseCount` is what LEAST_SERVED ranks on, so a double count would bias every later draw.
    assert.deepEqual(
      prisma.questions.map((question) => question.fixedUseCount),
      [1, 1, 1, 1, 1],
    );
  });

  it('leaves a question that is not on the paper alone', async () => {
    const { service, prisma } = serviceWith();
    prisma.questions.push(makeQuestion({ id: 'unused', currentVersionId: 'unused_v1' }));

    await service.finalize('tst_1');

    assert.equal(prisma.questions.find((question) => question.id === 'unused')?.fixedUseCount, 0);
  });
});

describe('FinalizeService — a second finalize', () => {
  it('is a no-op that reports the first one’s outcome', async () => {
    const { service, prisma } = serviceWith();

    const first = await service.finalize('tst_1');
    const second = await service.finalize('tst_1');

    assert.equal(first.finalizedByThisCall, true);
    assert.equal(second.finalizedByThisCall, false);
    assert.equal(second.finalizedAt, first.finalizedAt);
    // The failure this prevents: every question on the paper counted twice.
    assert.deepEqual(
      prisma.questions.map((question) => question.fixedUseCount),
      [1, 1, 1, 1, 1],
    );
    assert.equal(prisma.tests[0]!.version, 1);
  });

  it('lets exactly one of two concurrent finalizes do the work', async () => {
    const { service, prisma } = serviceWith();

    const [a, b] = await Promise.all([service.finalize('tst_1'), service.finalize('tst_1')]);

    // Both read version 0; only the one whose conditional update still matched may write.
    assert.equal([a, b].filter((result) => result.finalizedByThisCall).length, 1);
    assert.equal(prisma.tests[0]!.version, 1);
    assert.deepEqual(
      prisma.questions.map((question) => question.fixedUseCount),
      [1, 1, 1, 1, 1],
    );
  });
});

describe('FinalizeService — what it refuses to freeze', () => {
  it('refuses a test with no paper at all', async () => {
    const { service, prisma } = serviceWith([]);

    const error = await service.finalize('tst_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(prisma.tests[0]!.isLocked, false);
    assert.equal(prisma.configs[0]!.locked, false);
  });

  it('refuses a section short of the count its config asks for', async () => {
    const short = wholePaper().slice(0, 4);
    const { service, prisma } = serviceWith(short);

    // The failure this prevents: a 5-question paper frozen holding 4, and scored as if whole.
    const error = await service.finalize('tst_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /Quant holds 1 of the 2/);
    assert.equal(prisma.tests[0]!.isLocked, false);
  });

  it('refuses a paper holding rows for a section the config no longer has', async () => {
    const stray = [
      ...wholePaper(),
      { ...wholePaper()[0]!, id: 'pq_stray', baseConfigSectionId: 'sec_gone', order: 6 },
    ];
    const { service } = serviceWith(stray);

    const error = await service.finalize('tst_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /no longer has/);
  });

  it('puts the claim back when the paper turns out not to be whole', async () => {
    const { service, prisma } = serviceWith(wholePaper().slice(0, 4));

    await service.finalize('tst_1').catch(() => undefined);

    // The refusal happens INSIDE the transaction, so nothing it had already written survives.
    assert.equal(prisma.tests[0]!.isLocked, false);
    assert.equal(prisma.tests[0]!.version, 0);
    assert.equal(prisma.configs[0]!.locked, false);
    assert.deepEqual(
      prisma.questions.map((question) => question.fixedUseCount),
      [0, 0, 0, 0, 0],
    );
  });

  it('refuses a test that does not exist', async () => {
    const { service } = serviceWith();

    const error = await service.finalize('tst_gone').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

describe('FinalizeService — a test drawn per attempt', () => {
  it('freezes its draw spec and no paper', async () => {
    const { service, prisma } = serviceWith(
      [],
      makeTest({ id: 'tst_1', paperBinding: PAPER_BINDING.GENERATED }),
    );

    const result = await service.finalize('tst_1');

    // No rows to freeze and none to count, but the spec that decides every attempt's paper stops moving.
    assert.equal(result.frozenQuestions, 0);
    assert.equal(prisma.tests[0]!.isLocked, true);
    assert.equal(prisma.configs[0]!.locked, false);
    assert.deepEqual(
      prisma.questions.map((question) => question.fixedUseCount),
      [0, 0, 0, 0, 0],
    );
  });
});

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes, TEST_STATUS } from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { ScoringOutbox } from '../src/attempts/scoring-outbox';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { FinalizeService } from '../src/tests/finalize.service';
import { OfferingService } from '../src/tests/offering.service';
import { PaperService } from '../src/tests/paper.service';
import { TestsService } from '../src/tests/tests.service';
import { FakeEventBus, FakeQueue } from '../test/support/fakes';
import {
  BUILDER,
  makeBankQuestion,
  makeBuilder,
  makeSitting,
  makeStudent,
  resetDatabase,
  testPrisma,
} from './support/database';

const ADMIN = randomUUID();

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** The SSC CGL Tier 1 shape cut down — three Reasoning, two Quant — over a bank of eight of each. */
async function builder() {
  const sections = { reasoning: randomUUID(), quant: randomUUID() };
  await makeBuilder(
    prisma,
    [
      { id: sections.reasoning, name: 'Reasoning', subjectId: BUILDER.REASONING, questionCount: 3 },
      { id: sections.quant, name: 'Quant', subjectId: BUILDER.QUANT, questionCount: 2 },
    ],
    { totalQuestions: 5 },
  );
  const bank: Record<string, string> = {};
  for (const [prefix, subjectId] of [
    ['r', BUILDER.REASONING],
    ['q', BUILDER.QUANT],
  ] as const) {
    for (let n = 1; n <= 8; n += 1) {
      const id = randomUUID();
      bank[`${prefix}${n}`] = id;
      await makeBankQuestion(prisma, { id, subjectId });
    }
  }
  const seriesId = randomUUID();
  await prisma.testSeries.create({
    data: { id: seriesId, name: 'SSC CGL 2026 mocks', examStageId: BUILDER.STAGE },
  });
  const events = new FakeEventBus();
  const audit = new AuditContext();
  const configs = new BaseConfigsService(prisma, new ExamStagesService(prisma, audit), audit);
  const tests = new TestsService(prisma, configs, audit, events.asService());
  const paper = new PaperService(
    prisma,
    configs,
    new ScoringOutbox(prisma, new FakeQueue().asQueue()),
    audit,
  );
  const draft = await tests.create(
    { baseConfigId: BUILDER.CONFIG, title: 'Mock 1', testSeriesId: seriesId },
    ADMIN,
  );
  return {
    draft,
    paper,
    bank,
    seriesId,
    finalizer: new FinalizeService(prisma, events.asService()),
    offering: new OfferingService(prisma, events.asService(), audit),
    /** Picked by hand, so this is how a paper is built up to the counts its config asks. */
    pickWholePaper: async () => {
      await paper.addQuestions(draft.id, {
        baseConfigSectionId: sections.reasoning,
        questionIds: [bank.r1 ?? '', bank.r2 ?? '', bank.r3 ?? ''],
      });
      await paper.addQuestions(draft.id, {
        baseConfigSectionId: sections.quant,
        questionIds: [bank.q1 ?? '', bank.q2 ?? ''],
      });
    },
  };
}

const rowsOf = (testId: string) =>
  prisma.paperQuestion.findMany({ where: { testId }, orderBy: { order: 'asc' } });

const useCounts = async (ids: readonly string[]) =>
  (
    await prisma.question.findMany({
      where: { id: { in: [...ids] } },
      select: { fixedUseCount: true },
    })
  ).map((row) => row.fixedUseCount);

const testRow = (id: string) => prisma.test.findUniqueOrThrow({ where: { id } });

describe('the Phase-2 milestone — a config becomes a publishable mock', () => {
  it('walks config -> draft -> paper -> finalize -> series -> offered', async () => {
    const { draft, paper, finalizer, offering, pickWholePaper, seriesId } = await builder();
    assert.equal(draft.status, TEST_STATUS.DRAFT);
    assert.equal(draft.totalQuestions, 5);

    await pickWholePaper();
    assert.equal((await paper.read(draft.id)).totalQuestions, 5);

    const frozen = await finalizer.finalize(draft.id);
    assert.equal(frozen.finalizedByThisCall, true);
    assert.equal(frozen.frozenQuestions, 5);

    await offering.moveToSeries(draft.id, { testSeriesId: seriesId });
    const status = await offering.setStatus(draft.id, TEST_STATUS.ACTIVE);

    // A publishable mock: frozen, carried by a series, and offered.
    assert.equal(status, TEST_STATUS.ACTIVE);
    assert.equal((await testRow(draft.id)).isLocked, true);
    assert.equal((await rowsOf(draft.id)).length, 5);
    // Finalizing freezes the PAPER. Its blueprint stops moving when somebody sits one, not here.
    const config = await prisma.baseConfig.findUniqueOrThrow({ where: { id: BUILDER.CONFIG } });
    assert.equal(config.locked, false);
  });

  it('will not offer a test until its paper is frozen', async () => {
    const { draft, finalizer, offering, pickWholePaper } = await builder();

    await assert.rejects(() => offering.setStatus(draft.id, TEST_STATUS.ACTIVE), AppException.is);

    await pickWholePaper();
    await finalizer.finalize(draft.id);

    // The other half of the gate is the series, and creation is what already gave it one.
    assert.equal(await offering.setStatus(draft.id, TEST_STATUS.ACTIVE), TEST_STATUS.ACTIVE);
  });
});

describe('the invariants Phase 2 must not have broken', () => {
  it('one paper per sitting: once it is sat it cannot be edited, and a second finalize does nothing', async () => {
    const { draft, paper, finalizer, pickWholePaper, bank } = await builder();
    await pickWholePaper();
    await finalizer.finalize(draft.id);

    assert.equal((await finalizer.finalize(draft.id)).finalizedByThisCall, false);

    const before = await rowsOf(draft.id);
    await makeSitting(prisma, {
      testId: draft.id,
      studentId: (await makeStudent(prisma)).id,
      score: 0,
    });

    await assert.rejects(
      () => paper.replaceQuestion(draft.id, before[0]?.id ?? '', { questionId: bank.r8 ?? '' }),
      (error: unknown) => AppException.is(error) && error.code === ErrorCodes.CONFLICT,
    );

    // Every student shares one paper, and it is the one they started sitting.
    const held = before.map((row) => row.questionId);
    assert.deepEqual(
      (await rowsOf(draft.id)).map((row) => row.questionId),
      held,
    );
    assert.deepEqual(
      await useCounts(held),
      held.map(() => 1),
    );
  });

  /** The failure this prevents: LEAST_SERVED biased for good against questions that never moved. */
  it('gives back the use it counted, so a refreeze does not count the same question twice', async () => {
    const { draft, paper, finalizer, pickWholePaper } = await builder();
    await pickWholePaper();
    await finalizer.finalize(draft.id);
    const [first, ...rest] = await rowsOf(draft.id);
    const drawn = [first, ...rest].map((row) => row?.questionId ?? '');
    assert.deepEqual(
      await useCounts(drawn),
      drawn.map(() => 1),
    );

    // Taking one off thaws the paper, and the question goes straight back where it was.
    await paper.removeQuestions(draft.id, [first?.id ?? '']);
    assert.deepEqual(
      await useCounts(drawn),
      drawn.map(() => 0),
    );

    await paper.addQuestions(draft.id, {
      baseConfigSectionId: first?.baseConfigSectionId ?? '',
      questionIds: [first?.questionId ?? ''],
    });
    await finalizer.finalize(draft.id);
    assert.deepEqual(
      await useCounts(drawn),
      drawn.map(() => 1),
    );
  });

  it('gives nothing back for a draft that was never frozen', async () => {
    const { draft, paper, pickWholePaper } = await builder();

    await pickWholePaper();
    await paper.removeQuestions(draft.id, [(await rowsOf(draft.id))[0]?.id ?? '']);

    const everyCount = await prisma.question.findMany({ select: { fixedUseCount: true } });
    assert.ok(everyCount.every((row) => row.fixedUseCount === 0));
  });

  /** Nobody has sat it, so there is nothing to protect — but the freeze cannot survive the edit. */
  it('lets a frozen paper nobody has sat be edited, and thaws it in doing so', async () => {
    const { draft, paper, finalizer, pickWholePaper, bank } = await builder();
    await pickWholePaper();
    await finalizer.finalize(draft.id);
    assert.equal((await testRow(draft.id)).isLocked, true);

    await paper.replaceQuestion(draft.id, (await rowsOf(draft.id))[0]?.id ?? '', {
      questionId: bank.r8 ?? '',
    });

    const test = await testRow(draft.id);
    assert.equal(test.isLocked, false);
    assert.equal(test.finalizedAt, null);
    assert.equal(test.status, TEST_STATUS.DRAFT);
  });
});

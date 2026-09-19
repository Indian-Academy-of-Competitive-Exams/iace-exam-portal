import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes, PAPER_SOURCES, TEST_STATUS } from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { ScoringOutbox } from '../src/attempts/scoring-outbox';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { FinalizeService } from '../src/tests/finalize.service';
import { OfferingService } from '../src/tests/offering.service';
import { PaperService } from '../src/tests/paper.service';
import { TestsService } from '../src/tests/tests.service';
import { FakeEventBus, FakeQueue, FakeRedis } from '../test/support/fakes';
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
  const redis = new FakeRedis().asService();
  const configs = new BaseConfigsService(
    prisma,
    new ExamStagesService(prisma, audit),
    audit,
    redis,
  );
  const tests = new TestsService(prisma, configs, audit, events.asService(), redis);
  const paper = new PaperService(
    prisma,
    configs,
    new ScoringOutbox(prisma, new FakeQueue().asQueue()),
    audit,
    redis,
  );
  const created = await tests.create(
    { baseConfigId: BUILDER.CONFIG, title: 'Mock 1', testSeriesId: seriesId },
    ADMIN,
  );
  // The builder says where its questions come from before the paper is allowed to take any.
  const draft = await tests.update(created.id, { paperSource: PAPER_SOURCES.PICKED });
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
  it('walks config -> draft -> paper -> series -> offered', async () => {
    const { draft, paper, finalizer, offering, pickWholePaper, seriesId } = await builder();
    assert.equal(draft.status, TEST_STATUS.DRAFT);
    assert.equal(draft.totalQuestions, 5);

    await pickWholePaper();
    assert.equal((await paper.read(draft.id)).totalQuestions, 5);

    await offering.moveToSeries(draft.id, { testSeriesId: seriesId });
    const frozen = await finalizer.offer(draft.id);

    // A publishable mock: frozen, carried by a series, and offered — one call does all three.
    assert.equal(frozen.finalizedByThisCall, true);
    assert.equal(frozen.frozenQuestions, 5);
    assert.equal(frozen.status, TEST_STATUS.ACTIVE);
    const test = await testRow(draft.id);
    assert.ok(test.finalizedAt);
    assert.equal(test.status, TEST_STATUS.ACTIVE);
    assert.equal((await rowsOf(draft.id)).length, 5);
    // Offering freezes the PAPER. Its blueprint stops moving when somebody sits one, not here.
    const config = await prisma.baseConfig.findUniqueOrThrow({ where: { id: BUILDER.CONFIG } });
    assert.equal(config.locked, false);
  });

  it('will not make a test active again until it has been offered once', async () => {
    const { draft, finalizer, offering, pickWholePaper } = await builder();

    await assert.rejects(() => offering.setStatus(draft.id, TEST_STATUS.ACTIVE), AppException.is);

    await pickWholePaper();
    await finalizer.offer(draft.id);
    await offering.setStatus(draft.id, TEST_STATUS.INACTIVE);

    // The other half of the gate is the series, and creation is what already gave it one.
    assert.equal(await offering.setStatus(draft.id, TEST_STATUS.ACTIVE), TEST_STATUS.ACTIVE);
  });
});

describe('the invariants Phase 2 must not have broken', () => {
  it('one paper per sitting: once it is sat it cannot be edited, and a second offer does nothing', async () => {
    const { draft, paper, finalizer, pickWholePaper, bank } = await builder();
    await pickWholePaper();
    await finalizer.offer(draft.id);

    assert.equal((await finalizer.offer(draft.id)).finalizedByThisCall, false);

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

  /** The failure this prevents: a live paper moving under students who can already reach it. */
  it('refuses every paper edit once the test has been offered, sat or not', async () => {
    const { draft, paper, finalizer, pickWholePaper, bank } = await builder();
    await pickWholePaper();
    await finalizer.offer(draft.id);
    const [first] = await rowsOf(draft.id);
    const conflict = (error: unknown) =>
      AppException.is(error) && error.code === ErrorCodes.CONFLICT;

    await assert.rejects(
      () => paper.replaceQuestion(draft.id, first?.id ?? '', { questionId: bank.r8 ?? '' }),
      conflict,
    );
    await assert.rejects(() => paper.removeQuestions(draft.id, [first?.id ?? '']), conflict);

    // Nothing gives the offer's count back, because nothing can move the paper it counted.
    const drawn = (await rowsOf(draft.id)).map((row) => row.questionId);
    assert.deepEqual(
      await useCounts(drawn),
      drawn.map(() => 1),
    );
  });

  it('counts nothing for a paper that has never been offered', async () => {
    const { draft, paper, pickWholePaper } = await builder();

    await pickWholePaper();
    await paper.removeQuestions(draft.id, [(await rowsOf(draft.id))[0]?.id ?? '']);

    const everyCount = await prisma.question.findMany({ select: { fixedUseCount: true } });
    assert.ok(everyCount.every((row) => row.fixedUseCount === 0));
  });
});

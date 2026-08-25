import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  EVALUATION_MODE,
  PAPER_BINDING,
  TEST_STATUS,
} from '@iace/contracts';
import { TestsService } from '../src/tests/tests.service';
import { PaperService } from '../src/tests/paper.service';
import { FinalizeService } from '../src/tests/finalize.service';
import { OfferingService } from '../src/tests/offering.service';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { AuditContext } from '../src/audit';
import {
  type FakeQuestionRow,
  FakeEventBus,
  FakeTestsPrisma,
  makeBaseConfig,
  makeQuestion,
  makeSection,
  makeSeries,
} from './support/fakes';

/** The Phase-2 milestone end to end — the only place the four services meet. */

const ADMIN = 'adm_1';

/** The SSC CGL Tier 1 shape, cut down: two subjects, five questions, the seeded pattern's spirit. */
const SECTIONS = [
  makeSection({ id: 'sec_1', name: 'Reasoning', order: 1, subjectId: 'sub_r', questionCount: 3 }),
  makeSection({ id: 'sec_2', name: 'Quant', order: 2, subjectId: 'sub_q', questionCount: 2 }),
];

function bank(count: number, subjectId: string, prefix: string): FakeQuestionRow[] {
  return Array.from({ length: count }, (_, index) =>
    makeQuestion({
      id: `${prefix}${index + 1}`,
      subjectId,
      topicId: null,
      currentVersionId: `${prefix}${index + 1}_v1`,
    }),
  );
}

function builder(questions = [...bank(8, 'sub_r', 'r'), ...bank(8, 'sub_q', 'q')]) {
  const prisma = new FakeTestsPrisma(
    [],
    [makeBaseConfig({ id: 'cfg_1', totalQuestions: 5, locked: false })],
    SECTIONS,
    [],
    [],
    questions,
    [],
    [makeSeries({ id: 'srs_1', name: 'SSC CGL 2026 mocks' })],
  );
  const stages = new ExamStagesService(prisma.asService(), new AuditContext());
  const configs = new BaseConfigsService(prisma.asService(), stages, new AuditContext());
  const events = new FakeEventBus();

  return {
    prisma,
    events,
    tests: new TestsService(prisma.asService(), configs, new AuditContext()),
    paper: new PaperService(prisma.asService(), configs),
    finalizer: new FinalizeService(prisma.asService()),
    offering: new OfferingService(prisma.asService(), events.asService()),
  };
}

const SEED = 20260824;

describe('the Phase-2 milestone — a config becomes a publishable mock', () => {
  it('walks config -> draft -> draw -> finalize -> series -> offered', async () => {
    const { tests, paper, finalizer, offering, prisma } = builder();

    const draft = await tests.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);
    assert.equal(draft.status, TEST_STATUS.DRAFT);
    assert.equal(draft.totalQuestions, 5);

    const drawn = await paper.assemble(draft.id, { seed: SEED });
    assert.equal(drawn.totalQuestions, 5);

    const frozen = await finalizer.finalize(draft.id);
    assert.equal(frozen.finalizedByThisCall, true);
    assert.equal(frozen.frozenQuestions, 5);

    await offering.setSeries(draft.id, { series: [{ testSeriesId: 'srs_1', order: 1 }] });
    const status = await offering.setStatus(draft.id, TEST_STATUS.ACTIVE);

    // A publishable mock: frozen, carried by a series, and offered.
    assert.equal(status, TEST_STATUS.ACTIVE);
    const test = prisma.tests[0]!;
    assert.equal(test.isLocked, true);
    assert.equal(prisma.paperQuestions.length, 5);
    // Finalizing freezes the PAPER. Its blueprint stops moving when somebody sits one, not here.
    assert.equal(prisma.configs[0]!.locked, false);
  });

  it('will not offer a test until every step before it is done', async () => {
    const { tests, paper, finalizer, offering } = builder();
    const draft = await tests.create({ baseConfigId: 'cfg_1', title: 'Mock 2' }, ADMIN);

    const beforeFinalize = await offering
      .setStatus(draft.id, TEST_STATUS.ACTIVE)
      .catch((e: unknown) => e);
    assert.ok(AppException.is(beforeFinalize));

    await paper.assemble(draft.id, { seed: SEED });
    await finalizer.finalize(draft.id);

    // Frozen but in no series: still not offerable, because a test reaches a student through one.
    const beforeSeries = await offering
      .setStatus(draft.id, TEST_STATUS.ACTIVE)
      .catch((e: unknown) => e);
    assert.ok(AppException.is(beforeSeries));

    await offering.setSeries(draft.id, { series: [{ testSeriesId: 'srs_1', order: 1 }] });
    assert.equal(await offering.setStatus(draft.id, TEST_STATUS.ACTIVE), TEST_STATUS.ACTIVE);
  });
});

describe('the invariants Phase 2 must not have broken', () => {
  it('RANKED implies FIXED, at create and at edit', async () => {
    const { tests } = builder();

    const atCreate = await tests
      .create(
        {
          baseConfigId: 'cfg_1',
          title: 'Mock 1',
          evaluationMode: EVALUATION_MODE.RANKED,
          paperBinding: PAPER_BINDING.GENERATED,
        },
        ADMIN,
      )
      .catch((e: unknown) => e);
    assert.ok(AppException.is(atCreate));
    assert.equal(atCreate.code, ErrorCodes.VALIDATION_ERROR);

    const ranked = await tests.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);
    const atEdit = await tests
      .update(ranked.id, { paperBinding: PAPER_BINDING.GENERATED })
      .catch((e: unknown) => e);
    assert.ok(AppException.is(atEdit));
  });

  it('one frozen paper: it cannot be redrawn, and a second finalize changes nothing', async () => {
    const { tests, paper, finalizer, prisma } = builder();
    const draft = await tests.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);
    await paper.assemble(draft.id, { seed: SEED });
    await finalizer.finalize(draft.id);

    const before = prisma.paperQuestions.map((row) => row.questionId).sort();

    const redraw = await paper.assemble(draft.id, { seed: SEED + 1 }).catch((e: unknown) => e);
    assert.ok(AppException.is(redraw));
    assert.equal(redraw.code, ErrorCodes.CONFLICT);

    const second = await finalizer.finalize(draft.id);
    assert.equal(second.finalizedByThisCall, false);

    // Every student shares one paper, and it is the one that was frozen.
    assert.deepEqual(prisma.paperQuestions.map((row) => row.questionId).sort(), before);
    assert.deepEqual(
      prisma.questions.filter((row) => before.includes(row.id)).map((row) => row.fixedUseCount),
      before.map(() => 1),
    );
  });

  it('a bank too thin stops the milestone at the draw, having written nothing', async () => {
    const { tests, paper, prisma } = builder([...bank(8, 'sub_r', 'r'), ...bank(1, 'sub_q', 'q')]);
    const draft = await tests.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);

    const error = await paper.assemble(draft.id, { seed: SEED }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.DRAW_SHORTFALL);
    assert.equal(prisma.paperQuestions.length, 0);
    assert.equal(prisma.configs[0]!.locked, false);
  });
});

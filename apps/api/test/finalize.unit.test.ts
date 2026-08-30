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
import { FinalizeService } from '../src/tests/finalize.service';
import { PaperService } from '../src/tests/paper.service';
import { type ScoringOutbox } from '../src/attempts/scoring-outbox';
import type { PrismaService } from '../src/prisma/prisma.service';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { AuditContext } from '../src/audit';
import {
  type FakePaperRow,
  type FakeSectionRow,
  FakeTestsPrisma,
  fakeScoringOutbox,
  makeBaseConfig,
  makeQuestion,
  makeSection,
  makeTest,
  FakeEventBus,
  type FakeTestModelRow,
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
    variant: 0,
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
  const stages = new ExamStagesService(prisma.asService(), new AuditContext());
  const configs = new BaseConfigsService(prisma.asService(), stages, new AuditContext());
  const paperService = new PaperService(
    prisma.asService(),
    configs,
    fakeScoringOutbox(prisma),
    new AuditContext(),
  );
  return {
    prisma,
    service: new FinalizeService(prisma.asService(), paperService, new FakeEventBus().asService()),
  };
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

/** A finalize that loses the freeze to another call while it is still drawing. */
class RacedPaperService extends PaperService {
  constructor(
    prisma: PrismaService,
    configs: BaseConfigsService,
    outbox: ScoringOutbox,
    private readonly onDraw: () => void,
  ) {
    super(prisma, configs, outbox, new AuditContext());
  }

  override async drawVariants(testId: string, count: number) {
    const rows = await super.drawVariants(testId, count);
    this.onDraw();
    return rows;
  }
}

describe('FinalizeService — a test drawn per student', () => {
  /** Enough of each subject that three variants can be drawn without repeating within one. */
  function generated(variantCount: number, onDraw?: () => void) {
    const bank = [
      ...Array.from({ length: 9 }, (_, index) =>
        makeQuestion({
          id: `r${index + 1}`,
          subjectId: 'sub_r',
          currentVersionId: `r${index + 1}_v1`,
        }),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        makeQuestion({
          id: `q${index + 1}`,
          subjectId: 'sub_q',
          currentVersionId: `q${index + 1}_v1`,
        }),
      ),
    ];
    const test = makeTest({
      id: 'tst_1',
      paperBinding: PAPER_BINDING.GENERATED,
      evaluationMode: EVALUATION_MODE.PRACTICE,
      variantCount,
    });
    const prisma = new FakeTestsPrisma(
      [test],
      [makeBaseConfig({ id: 'cfg_1', totalQuestions: 5 })],
      SECTIONS,
      [],
      [],
      bank,
      [],
    );
    const stages = new ExamStagesService(prisma.asService(), new AuditContext());
    const configs = new BaseConfigsService(prisma.asService(), stages, new AuditContext());
    const paper = onDraw
      ? new RacedPaperService(prisma.asService(), configs, fakeScoringOutbox(prisma), onDraw)
      : new PaperService(
          prisma.asService(),
          configs,
          fakeScoringOutbox(prisma),
          new AuditContext(),
        );
    return {
      prisma,
      paper,
      service: new FinalizeService(prisma.asService(), paper, new FakeEventBus().asService()),
    };
  }

  /** The failure this prevents: a generated test frozen with nothing for a student to open. */
  it('draws one whole paper per variant before it freezes', async () => {
    const { service, prisma } = generated(3);

    const result = await service.finalize('tst_1');

    assert.equal(prisma.tests[0]!.isLocked, true);
    assert.equal(result.frozenQuestions, 15);
    assert.deepEqual(
      [0, 1, 2].map(
        (variant) => prisma.paperQuestions.filter((row) => row.variant === variant).length,
      ),
      [5, 5, 5],
    );
  });

  it('draws a paper without writing one, so only the freeze can put one down', async () => {
    const { prisma, paper } = generated(3);

    const rows = await paper.drawVariants('tst_1', 3);

    assert.equal(rows.length, 15);
    assert.equal(prisma.paperQuestions.length, 0);
  });

  /** The failure this prevents: a raced finalize redrawing the paper another call just froze. */
  it('leaves the frozen paper alone when it loses the freeze', async () => {
    const frozen = wholePaper('tst_1');
    const built = generated(3, () => {
      Object.assign(built.prisma.tests[0]!, {
        isLocked: true,
        version: 1,
        finalizedAt: new Date(),
      });
    });
    built.prisma.paperQuestions.push(...frozen);

    const result = await built.service.finalize('tst_1');

    assert.equal(result.finalizedByThisCall, false);
    assert.deepEqual(built.prisma.paperQuestions, frozen);
  });

  /** The lock is the first ATTEMPT, and freezing twenty papers is not somebody sitting one. */
  it('leaves the config unlocked, the same as a fixed paper does', async () => {
    const { service, prisma } = generated(2);

    await service.finalize('tst_1');

    assert.equal(prisma.configs[0]!.locked, false);
  });
});

describe('FinalizeService — offering', () => {
  const build = (over: Partial<FakeTestModelRow> = {}, series = 1) => {
    const held = serviceWith(wholePaper(), makeTest({ id: 'tst_1', ...over }));
    for (let index = 0; index < series; index += 1) {
      held.prisma.seriesTests.push({ testSeriesId: `srs_${index}`, testId: 'tst_1', order: null });
    }
    return held;
  };

  it('freezes and opens in one write, so neither can land without the other', async () => {
    const { service, prisma } = build();

    const result = await service.offer('tst_1');

    assert.equal(result.status, TEST_STATUS.ACTIVE);
    assert.equal(result.finalizedByThisCall, true);
    assert.equal(prisma.tests[0]?.isLocked, true);
    assert.equal(prisma.tests[0]?.status, TEST_STATUS.ACTIVE);
  });

  /** The failure this prevents: a paper frozen for a test no series carries, offered to nobody. */
  it('refuses before it writes anything when no series carries it', async () => {
    const { service, prisma } = build({}, 0);

    const error = await service.offer('tst_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(prisma.tests[0]?.isLocked, false);
    assert.equal(prisma.tests[0]?.status, TEST_STATUS.DRAFT);
  });

  it('opens a retired test again without re-freezing its paper', async () => {
    // Locked ALWAYS carries a finalizedAt — one without the other is a state no write produces.
    const { service, prisma } = build({
      isLocked: true,
      status: TEST_STATUS.INACTIVE,
      finalizedAt: new Date('2026-08-01T00:00:00.000Z'),
    });

    const result = await service.offer('tst_1');

    assert.equal(result.status, TEST_STATUS.ACTIVE);
    assert.equal(result.finalizedByThisCall, false);
    assert.equal(prisma.tests[0]?.status, TEST_STATUS.ACTIVE);
  });
});

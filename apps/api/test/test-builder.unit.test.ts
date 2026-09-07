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
  FakeEventBus,
  fakeScoringOutbox,
  FakeTestsPrisma,
  makeBaseConfig,
  makeQuestion,
  makeSection,
  makeSeries,
  rowAt,
  type FakeQuestionRow,
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
    questions,
    [],
    [
      makeSeries({ id: 'srs_1', name: 'SSC CGL 2026 mocks' }),
      makeSeries({
        id: 'srs_2',
        name: 'SSC CGL 2026 drills',
        evaluationMode: EVALUATION_MODE.PRACTICE,
      }),
    ],
  );
  const stages = new ExamStagesService(prisma.asService(), new AuditContext());
  const configs = new BaseConfigsService(prisma.asService(), stages, new AuditContext());
  const events = new FakeEventBus();

  return {
    prisma,
    events,
    tests: new TestsService(prisma.asService(), configs, new AuditContext(), events.asService()),
    paper: new PaperService(
      prisma.asService(),
      configs,
      fakeScoringOutbox(prisma),
      new AuditContext(),
    ),
    finalizer: new FinalizeService(
      prisma.asService(),
      new PaperService(prisma.asService(), configs, fakeScoringOutbox(prisma), new AuditContext()),
      events.asService(),
    ),
    offering: new OfferingService(prisma.asService(), events.asService(), new AuditContext()),
  };
}

/** A FIXED paper is picked by hand, so this is how one is built up to the counts its config asks. */
async function pickWholePaper(paper: PaperService, testId: string): Promise<void> {
  const picks: [string, string[]][] = [
    ['sec_1', ['r1', 'r2', 'r3']],
    ['sec_2', ['q1', 'q2']],
  ];
  for (const [baseConfigSectionId, questionIds] of picks) {
    await paper.addQuestions(testId, { baseConfigSectionId, questionIds });
  }
}

describe('the Phase-2 milestone — a config becomes a publishable mock', () => {
  it('walks config -> draft -> paper -> finalize -> series -> offered', async () => {
    const { tests, paper, finalizer, offering, prisma } = builder();

    const draft = await tests.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );
    assert.equal(draft.status, TEST_STATUS.DRAFT);
    assert.equal(draft.totalQuestions, 5);

    await pickWholePaper(paper, draft.id);
    assert.equal((await paper.read(draft.id)).totalQuestions, 5);

    const frozen = await finalizer.finalize(draft.id);
    assert.equal(frozen.finalizedByThisCall, true);
    assert.equal(frozen.frozenQuestions, 5);

    await offering.setSeries(draft.id, { testSeriesId: 'srs_1' });
    const status = await offering.setStatus(draft.id, TEST_STATUS.ACTIVE);

    // A publishable mock: frozen, carried by a series, and offered.
    assert.equal(status, TEST_STATUS.ACTIVE);
    const test = rowAt(prisma.tests);
    assert.equal(test.isLocked, true);
    assert.equal(prisma.paperQuestions.length, 5);
    // Finalizing freezes the PAPER. Its blueprint stops moving when somebody sits one, not here.
    assert.equal(prisma.configs[0]?.locked, false);
  });

  it('will not offer a test until its paper is frozen', async () => {
    const { tests, paper, finalizer, offering } = builder();
    const draft = await tests.create(
      { baseConfigId: 'cfg_1', title: 'Mock 2', testSeriesId: 'srs_1' },
      ADMIN,
    );

    const beforeFinalize = await offering
      .setStatus(draft.id, TEST_STATUS.ACTIVE)
      .catch((e: unknown) => e);
    assert.ok(AppException.is(beforeFinalize));

    await pickWholePaper(paper, draft.id);
    await finalizer.finalize(draft.id);

    // The other half of the gate is the series, and creation is what already gave it one.
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
          testSeriesId: 'srs_1',
          paperBinding: PAPER_BINDING.GENERATED,
        },
        ADMIN,
      )
      .catch((e: unknown) => e);
    assert.ok(AppException.is(atCreate));
    assert.equal(atCreate.code, ErrorCodes.VALIDATION_ERROR);

    const ranked = await tests.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );
    const atEdit = await tests
      .update(ranked.id, { paperBinding: PAPER_BINDING.GENERATED })
      .catch((e: unknown) => e);
    assert.ok(AppException.is(atEdit));
  });

  it('one paper per sitting: once it is sat it cannot be edited, and a second finalize does nothing', async () => {
    const { tests, paper, finalizer, prisma } = builder();
    const draft = await tests.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );
    await pickWholePaper(paper, draft.id);
    await finalizer.finalize(draft.id);

    const second = await finalizer.finalize(draft.id);
    assert.equal(second.finalizedByThisCall, false);

    const before = prisma.paperQuestions.map((row) => row.questionId).sort();
    const row = rowAt(prisma.paperQuestions);
    prisma.attempts.push({ testId: draft.id });

    const edit = await paper
      .replaceQuestion(draft.id, row.id, { questionId: 'r8' })
      .catch((e: unknown) => e);
    assert.ok(AppException.is(edit));
    assert.equal(edit.code, ErrorCodes.CONFLICT);

    // Every student shares one paper, and it is the one they started sitting.
    assert.deepEqual(prisma.paperQuestions.map((row) => row.questionId).sort(), before);
    assert.deepEqual(
      prisma.questions.filter((row) => before.includes(row.id)).map((row) => row.fixedUseCount),
      before.map(() => 1),
    );
  });

  /** The failure this prevents: LEAST_SERVED biased for good against questions that never moved. */
  it('gives back the use it counted, so a refreeze does not count the same question twice', async () => {
    const { tests, paper, finalizer, prisma } = builder();
    const draft = await tests.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );
    await pickWholePaper(paper, draft.id);
    await finalizer.finalize(draft.id);

    const drawn = prisma.paperQuestions.map((row) => row.questionId);
    const counted = () =>
      prisma.questions.filter((row) => drawn.includes(row.id)).map((row) => row.fixedUseCount);
    assert.deepEqual(
      counted(),
      drawn.map(() => 1),
    );

    // Taking one off thaws the paper, and the question goes straight back where it was.
    const row = rowAt(prisma.paperQuestions);
    await paper.removeQuestions(draft.id, [row.id]);
    assert.deepEqual(
      counted(),
      drawn.map(() => 0),
    );

    await paper.addQuestions(draft.id, {
      baseConfigSectionId: row.baseConfigSectionId,
      questionIds: [row.questionId],
    });
    await finalizer.finalize(draft.id);
    assert.deepEqual(
      counted(),
      drawn.map(() => 1),
    );
  });

  it('gives nothing back for a draft that was never frozen', async () => {
    const { tests, paper, prisma } = builder();
    const draft = await tests.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );

    await pickWholePaper(paper, draft.id);
    await paper.removeQuestions(draft.id, [rowAt(prisma.paperQuestions).id]);

    assert.deepEqual(
      prisma.questions.map((row) => row.fixedUseCount),
      prisma.questions.map(() => 0),
    );
  });

  /** Nobody has sat it, so there is nothing to protect — but the freeze cannot survive the edit. */
  it('lets a frozen paper nobody has sat be edited, and thaws it in doing so', async () => {
    const { tests, paper, finalizer, prisma } = builder();
    const draft = await tests.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );
    await pickWholePaper(paper, draft.id);
    await finalizer.finalize(draft.id);
    assert.equal(prisma.tests[0]?.isLocked, true);

    await paper.replaceQuestion(draft.id, rowAt(prisma.paperQuestions).id, { questionId: 'r8' });

    const test = rowAt(prisma.tests);
    assert.equal(test.isLocked, false);
    assert.equal(test.finalizedAt, null);
    assert.equal(test.status, TEST_STATUS.DRAFT);
  });

  it('a bank too thin stops the milestone at the draw, having written nothing', async () => {
    const { tests, finalizer, prisma } = builder([
      ...bank(8, 'sub_r', 'r'),
      ...bank(1, 'sub_q', 'q'),
    ]);
    const draft = await tests.create(
      {
        baseConfigId: 'cfg_1',
        title: 'Mock 1',
        testSeriesId: 'srs_2',
        paperBinding: PAPER_BINDING.GENERATED,
      },
      ADMIN,
    );

    const error = await finalizer.finalize(draft.id).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.DRAW_SHORTFALL);
    assert.equal(prisma.paperQuestions.length, 0);
    assert.equal(prisma.tests[0]?.isLocked, false);
    assert.equal(prisma.configs[0]?.locked, false);
  });
});

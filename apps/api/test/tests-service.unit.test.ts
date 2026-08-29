import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  DRAW_STRATEGY,
  EXAM_TEMPLATE,
  ErrorCodes,
  EVALUATION_MODE,
  PAPER_BINDING,
  TEST_SCOPE,
  TEST_STATUS,
} from '@iace/contracts';
import { TestsService } from '../src/tests/tests.service';
import { DOMAIN_EVENTS } from '../src/common/events';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { AuditContext } from '../src/audit';
import {
  type FakeBaseConfigRow,
  type FakeSectionRow,
  type FakeSeriesTestRow,
  type FakeTestModelRow,
  FakeEventBus,
  FakeTestsPrisma,
  makeBaseConfig,
  makeSection,
  makeTest,
} from './support/fakes';

const ADMIN = 'adm_1';

/** The SSC CGL Tier 1 pattern: two sections, 50 questions, an hour. */
const SECTIONS: FakeSectionRow[] = [
  makeSection({ id: 'sec_1', name: 'General Intelligence', order: 1 }),
  makeSection({ id: 'sec_2', name: 'Quantitative Aptitude', order: 2 }),
];

function serviceWith(
  tests: FakeTestModelRow[] = [],
  configs: FakeBaseConfigRow[] = [makeBaseConfig({ totalQuestions: 50, durationSec: 3600 })],
  usage: { attempts?: { testId: string }[]; seriesTests?: FakeSeriesTestRow[] } = {},
) {
  const prisma = new FakeTestsPrisma(
    tests,
    configs,
    SECTIONS,
    usage.attempts ?? [],
    usage.seriesTests ?? [],
  );
  const stages = new ExamStagesService(prisma.asService(), new AuditContext());
  const configsService = new BaseConfigsService(prisma.asService(), stages, new AuditContext());
  const events = new FakeEventBus();
  return {
    prisma,
    events,
    service: new TestsService(
      prisma.asService(),
      configsService,
      new AuditContext(),
      events.asService(),
    ),
  };
}

describe('TestsService — creating a draft from a config', () => {
  it('writes a draft whose shape is the config it points at', async () => {
    const { service } = serviceWith();

    const created = await service.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);

    assert.equal(created.status, TEST_STATUS.DRAFT);
    assert.equal(created.totalQuestions, 50);
    assert.equal(created.durationSec, 3600);
    assert.equal(created.baseConfig.sections.length, 2);
  });

  /** The screen is asked for at creation now; the blueprint only says where the answer starts. */
  it('wears the screen the admin chose, not the config default', async () => {
    const { service } = serviceWith();

    const created = await service.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', examTemplate: EXAM_TEMPLATE.STRICT },
      ADMIN,
    );

    assert.equal(created.examTemplate, EXAM_TEMPLATE.STRICT);
  });

  it('falls back to the config when the admin chose no screen', async () => {
    const config = makeBaseConfig({ examTemplate: EXAM_TEMPLATE.STRICT });
    const { service } = serviceWith([], [config]);

    const created = await service.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);

    assert.equal(created.examTemplate, EXAM_TEMPLATE.STRICT);
  });

  /** The copy is the point: re-skinning the blueprint must not re-skin a test already built. */
  it('keeps the screen it was built with when the config is re-skinned', async () => {
    const config = makeBaseConfig({ examTemplate: EXAM_TEMPLATE.COMFORTABLE });
    const { service } = serviceWith([], [config]);
    const created = await service.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);

    config.examTemplate = EXAM_TEMPLATE.STRICT;

    assert.equal((await service.detail(created.id)).examTemplate, EXAM_TEMPLATE.COMFORTABLE);
  });

  it('follows the config when it changes, because it never copied it', async () => {
    const config = makeBaseConfig({ totalQuestions: 50, durationSec: 3600 });
    const { service } = serviceWith([], [config]);

    const created = await service.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);
    config.durationSec = 4800;
    config.totalQuestions = 60;

    // The failure this prevents: an hour still served after the pattern moved to 80 minutes.
    const reread = await service.detail(created.id);
    assert.equal(reread.durationSec, 4800);
    assert.equal(reread.totalQuestions, 60);
  });

  it('takes the stage off the config, never off the body', async () => {
    const { service, prisma } = serviceWith(
      [],
      [makeBaseConfig({ id: 'cfg_1', examStageId: 'stage_2' })],
    );

    const created = await service.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);

    // The composite FK is what keeps a test and its blueprint on one stage; the body has no say.
    assert.equal(created.examStageId, 'stage_2');
    assert.equal(prisma.tests[0]!.examStageId, 'stage_2');
  });

  it('defaults to a full, ranked, fixed, randomly drawn paper', async () => {
    const { service } = serviceWith();

    const created = await service.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);

    assert.equal(created.scope, TEST_SCOPE.FULL);
    assert.equal(created.evaluationMode, EVALUATION_MODE.RANKED);
    assert.equal(created.paperBinding, PAPER_BINDING.FIXED);
    assert.equal(created.drawStrategy, DRAW_STRATEGY.RANDOM);
    assert.equal(created.maxRetakes, null);
  });

  it('refuses a ranked test on a generated paper', async () => {
    const { service, prisma } = serviceWith();

    // The failure this prevents: a leaderboard built from students who each sat a different paper.
    const error = await service
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

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.paperBinding?.[0]);
    assert.equal(prisma.tests.length, 0);
  });

  it('accepts a generated paper once the test is practice', async () => {
    const { service } = serviceWith();

    const created = await service.create(
      {
        baseConfigId: 'cfg_1',
        title: 'Mock 1',
        evaluationMode: EVALUATION_MODE.PRACTICE,
        paperBinding: PAPER_BINDING.GENERATED,
      },
      ADMIN,
    );

    assert.equal(created.paperBinding, PAPER_BINDING.GENERATED);
  });

  it('refuses a retired config', async () => {
    const { service } = serviceWith([], [makeBaseConfig({ id: 'cfg_1', isActive: false })]);

    const error = await service
      .create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.baseConfigId?.[0]);
  });

  it('still builds on a locked config — the lock freezes its shape, not its use', async () => {
    const { service } = serviceWith([], [makeBaseConfig({ id: 'cfg_1', locked: true })]);

    const created = await service.create({ baseConfigId: 'cfg_1', title: 'Mock 1' }, ADMIN);

    assert.equal(created.baseConfigId, 'cfg_1');
  });
});

describe('TestsService — the scope has to name a part of the config', () => {
  it('refuses a sectional test that names no section', async () => {
    const { service } = serviceWith();

    const error = await service
      .create({ baseConfigId: 'cfg_1', title: 'Mock 1', scope: TEST_SCOPE.SECTIONAL }, ADMIN)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.scopeRef?.[0]);
  });

  it('refuses a section that belongs to another config', async () => {
    const { service } = serviceWith();

    const error = await service
      .create(
        {
          baseConfigId: 'cfg_1',
          title: 'Mock 1',
          scope: TEST_SCOPE.SECTIONAL,
          scopeRef: { sectionId: 'sec_9' },
        },
        ADMIN,
      )
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
  });

  it('accepts a section of its own config', async () => {
    const { service } = serviceWith();

    const created = await service.create(
      {
        baseConfigId: 'cfg_1',
        title: 'Mock 1',
        scope: TEST_SCOPE.SECTIONAL,
        scopeRef: { sectionId: 'sec_2' },
      },
      ADMIN,
    );

    assert.deepEqual(created.scopeRef, { sectionId: 'sec_2' });
  });
});

describe('TestsService — editing and removing', () => {
  it('re-checks the pair when only one half of it moves', async () => {
    const { service } = serviceWith([
      makeTest({ id: 'tst_1', evaluationMode: EVALUATION_MODE.RANKED }),
    ]);

    const error = await service
      .update('tst_1', { paperBinding: PAPER_BINDING.GENERATED })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
  });

  it('refuses every change but the title once a student has sat it', async () => {
    const { service, prisma } = serviceWith(
      [makeTest({ id: 'tst_1', isLocked: true })],
      undefined,
      {
        attempts: [{ testId: 'tst_1' }],
      },
    );

    const error = await service
      .update('tst_1', { drawStrategy: DRAW_STRATEGY.NEWEST_FIRST })
      .catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);

    const renamed = await service.update('tst_1', { title: 'Mock 1 (revised)' });
    assert.equal(renamed.title, 'Mock 1 (revised)');
    // A rename moves no question, so it must not thaw the paper it was allowed to leave alone.
    assert.equal(prisma.tests[0]!.isLocked, true);
  });

  /** A generated test with one paper IS a fixed test, and every student would sit the same one. */
  it('refuses a paper per student with only one paper to draw from', async () => {
    const { service } = serviceWith([makeTest({ id: 'tst_1' })]);

    const error = await service
      .update('tst_1', {
        evaluationMode: EVALUATION_MODE.PRACTICE,
        paperBinding: PAPER_BINDING.GENERATED,
        variantCount: 1,
      })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.variantCount?.[0]);
  });

  /** Switching over carries a count of 1 it never chose, so it starts from the default instead. */
  it('gives a test only now drawing per student a bank to draw from', async () => {
    const { service, prisma } = serviceWith([makeTest({ id: 'tst_1' })]);

    await service.update('tst_1', {
      evaluationMode: EVALUATION_MODE.PRACTICE,
      paperBinding: PAPER_BINDING.GENERATED,
    });

    assert.ok(prisma.tests[0]!.variantCount > 1);
  });

  /** The failure this prevents: a generated test built before the count refusing every edit. */
  it('lets a generated test that predates the count be edited at all', async () => {
    const { service, prisma } = serviceWith([
      makeTest({
        id: 'tst_1',
        evaluationMode: EVALUATION_MODE.PRACTICE,
        paperBinding: PAPER_BINDING.GENERATED,
        variantCount: 1,
      }),
    ]);

    await service.update('tst_1', { drawStrategy: DRAW_STRATEGY.NEWEST_FIRST });

    assert.ok(prisma.tests[0]!.variantCount > 1);
  });

  /** One paper is what fixed MEANS, so the count is held there rather than argued about. */
  it('holds a fixed paper at one, whatever it is sent', async () => {
    const { service, prisma } = serviceWith([makeTest({ id: 'tst_1' })]);

    await service.update('tst_1', { variantCount: 12 });

    assert.equal(prisma.tests[0]!.variantCount, 1);
  });

  /** THE failure this prevents: a re-skin silently un-finalizing a paper it moves no question in. */
  it('re-skins a frozen test without thawing the paper', async () => {
    const { service, prisma } = serviceWith([
      makeTest({ id: 'tst_1', isLocked: true, status: TEST_STATUS.ACTIVE }),
    ]);

    const updated = await service.update('tst_1', { examTemplate: EXAM_TEMPLATE.STRICT });

    assert.equal(updated.examTemplate, EXAM_TEMPLATE.STRICT);
    assert.equal(prisma.tests[0]!.isLocked, true);
    assert.equal(prisma.tests[0]!.status, TEST_STATUS.ACTIVE);
  });

  /** A student who sat the comfortable screen must not have their test re-skinned under them. */
  it('refuses a re-skin once a student has sat it', async () => {
    const { service } = serviceWith([makeTest({ id: 'tst_1' })], undefined, {
      attempts: [{ testId: 'tst_1' }],
    });

    const error = await service
      .update('tst_1', { examTemplate: EXAM_TEMPLATE.STRICT })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  /** The failure this prevents: a frozen paper left pointing at a scope it no longer covers. */
  it('thaws a frozen test nobody has sat when its shape changes', async () => {
    const { service, prisma } = serviceWith([
      makeTest({ id: 'tst_1', isLocked: true, status: TEST_STATUS.ACTIVE }),
    ]);

    await service.update('tst_1', { drawStrategy: DRAW_STRATEGY.NEWEST_FIRST });

    const test = prisma.tests[0]!;
    assert.equal(test.isLocked, false);
    assert.equal(test.finalizedAt, null);
    // An unfrozen test cannot be offered, so it stops being offered rather than going incoherent.
    assert.equal(test.status, TEST_STATUS.DRAFT);
  });

  it('drops the paper when the test stops having one', async () => {
    const { service, prisma } = serviceWith([makeTest({ id: 'tst_1' })]);
    prisma.paperQuestions.push({
      id: 'pq_1',
      testId: 'tst_1',
      baseConfigId: 'cfg_1',
      baseConfigSectionId: 'sec_1',
      questionId: 'qst_1',
      questionVersionId: 'qst_1_v1',
      variant: 0,
      order: 1,
      marks: 2,
      negativeMarks: 0.5,
      status: 'ACTIVE',
    });

    // A paper belongs to a FIXED test; per-attempt draws would leave these rows unread forever.
    await service.update('tst_1', {
      evaluationMode: EVALUATION_MODE.PRACTICE,
      paperBinding: PAPER_BINDING.GENERATED,
    });

    assert.equal(prisma.paperQuestions.length, 0);
  });

  it('refuses to delete a test students have sat', async () => {
    const { service } = serviceWith([makeTest({ id: 'tst_1' })], undefined, {
      attempts: [{ testId: 'tst_1' }],
    });

    const error = await service.remove('tst_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  it('deletes a draft nothing depends on', async () => {
    const { service, prisma } = serviceWith([makeTest({ id: 'tst_1' })]);

    await service.remove('tst_1');

    assert.equal(prisma.tests.length, 0);
  });

  /** Being frozen and being offered are states a test can be talked out of; being sat is not. */
  it('deletes a finalized test that two series still offer, because nobody sat it', async () => {
    const { service, prisma } = serviceWith(
      [makeTest({ id: 'tst_1', isLocked: true, status: TEST_STATUS.ACTIVE })],
      undefined,
      {
        seriesTests: [
          { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
          { testSeriesId: 'srs_2', testId: 'tst_1', order: 1 },
        ],
      },
    );

    await service.remove('tst_1');

    assert.equal(prisma.tests.length, 0);
  });

  /** The failure this prevents: a deleted test still reachable in a student's cached catalog. */
  it('tells every series that carried it that the catalog has moved', async () => {
    const { service, events } = serviceWith([makeTest({ id: 'tst_1' })], undefined, {
      seriesTests: [
        { testSeriesId: 'srs_1', testId: 'tst_1', order: 1 },
        { testSeriesId: 'srs_2', testId: 'tst_1', order: 2 },
      ],
    });

    await service.remove('tst_1');

    assert.deepEqual(
      events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED).map((payload) => payload.testSeriesId),
      ['srs_1', 'srs_2'],
    );
  });
});

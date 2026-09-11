import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AppException,
  EXAM_TEMPLATE,
  ErrorCodes,
  EVALUATION_MODE,
  TEST_SCOPE,
  TEST_STATUS,
} from '@iace/contracts';
import { TestsService } from '../src/tests/tests.service';
import { DOMAIN_EVENTS } from '../src/common/events';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { AuditContext } from '../src/audit';
import {
  FakeEventBus,
  FakeTestsPrisma,
  makeBaseConfig,
  makeSection,
  makeSeries,
  makeTest,
  rowAt,
  type FakeBaseConfigRow,
  type FakeSectionRow,
  type FakeSeriesRow,
  type FakeTestModelRow,
} from './support/fakes';

const ADMIN = 'adm_1';

/** The SSC CGL Tier 1 pattern: two sections, 50 questions, an hour. */
const SECTIONS: FakeSectionRow[] = [
  makeSection({ id: 'sec_1', name: 'General Intelligence', order: 1 }),
  makeSection({ id: 'sec_2', name: 'Quantitative Aptitude', order: 2 }),
];

/** Stage-agnostic, so only the tests that are ABOUT the stage rule have to think about it. */
const SERIES: FakeSeriesRow[] = [
  makeSeries({ id: 'srs_1', name: 'SSC CGL Tier 1 mocks', examStageId: null }),
  makeSeries({
    id: 'srs_practice',
    name: 'SSC CGL Tier 1 drills',
    examStageId: null,
    evaluationMode: EVALUATION_MODE.PRACTICE,
  }),
];

function serviceWith(
  tests: FakeTestModelRow[] = [],
  configs: FakeBaseConfigRow[] = [makeBaseConfig({ totalQuestions: 50, durationSec: 3600 })],
  usage: { attempts?: { testId: string }[] } = {},
  series: FakeSeriesRow[] = SERIES,
) {
  const prisma = new FakeTestsPrisma(
    tests,
    configs,
    SECTIONS,
    usage.attempts ?? [],
    [],
    [],
    series,
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

    const created = await service.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );

    assert.equal(created.status, TEST_STATUS.DRAFT);
    assert.equal(created.totalQuestions, 50);
    assert.equal(created.durationSec, 3600);
    assert.equal(created.baseConfig.sections.length, 2);
  });

  /** The screen is asked for at creation now; the blueprint only says where the answer starts. */
  it('wears the screen the admin chose, not the config default', async () => {
    const { service } = serviceWith();

    const created = await service.create(
      {
        baseConfigId: 'cfg_1',
        title: 'Mock 1',
        testSeriesId: 'srs_1',
        examTemplate: EXAM_TEMPLATE.SSC_RAILWAYS,
      },
      ADMIN,
    );

    assert.equal(created.examTemplate, EXAM_TEMPLATE.SSC_RAILWAYS);
  });

  it('falls back to the config when the admin chose no screen', async () => {
    const config = makeBaseConfig({ examTemplate: EXAM_TEMPLATE.SSC_RAILWAYS });
    const { service } = serviceWith([], [config]);

    const created = await service.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );

    assert.equal(created.examTemplate, EXAM_TEMPLATE.SSC_RAILWAYS);
  });

  /** The copy is the point: re-skinning the blueprint must not re-skin a test already built. */
  it('keeps the screen it was built with when the config is re-skinned', async () => {
    const config = makeBaseConfig({ examTemplate: EXAM_TEMPLATE.DEFAULT });
    const { service } = serviceWith([], [config]);
    const created = await service.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );

    config.examTemplate = EXAM_TEMPLATE.SSC_RAILWAYS;

    assert.equal((await service.detail(created.id)).examTemplate, EXAM_TEMPLATE.DEFAULT);
  });

  it('follows the config when it changes, because it never copied it', async () => {
    const config = makeBaseConfig({ totalQuestions: 50, durationSec: 3600 });
    const { service } = serviceWith([], [config]);

    const created = await service.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );
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

    const created = await service.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );

    // The composite FK is what keeps a test and its blueprint on one stage; the body has no say.
    assert.equal(created.examStageId, 'stage_2');
    assert.equal(prisma.tests[0]?.examStageId, 'stage_2');
  });

  it('defaults to a full, ranked test', async () => {
    const { service } = serviceWith();

    const created = await service.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );

    assert.equal(created.scope, TEST_SCOPE.FULL);
    assert.equal(created.evaluationMode, EVALUATION_MODE.RANKED);
  });

  /** The failure this prevents: a practice series holding a test the leaderboard then ranks. */
  it('takes the mode off the series it is created in', async () => {
    const { service, prisma } = serviceWith();

    const created = await service.create(
      { baseConfigId: 'cfg_1', title: 'Speed drill 1', testSeriesId: 'srs_practice' },
      ADMIN,
    );

    assert.equal(created.evaluationMode, EVALUATION_MODE.PRACTICE);
    assert.equal(created.testSeriesId, 'srs_practice');
    assert.equal(prisma.tests[0]?.evaluationMode, EVALUATION_MODE.PRACTICE);
  });

  it('refuses a test in a series that is not there', async () => {
    const { service, prisma } = serviceWith();

    const error = await service
      .create({ baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_gone' }, ADMIN)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.testSeriesId?.[0]);
    assert.equal(prisma.tests.length, 0);
  });

  /** The failure this prevents: a Tier 1 paper served to the Tier 2 students the series reaches. */
  it('refuses a series built for another stage, and names it', async () => {
    const { service, prisma } = serviceWith([], undefined, {}, [
      makeSeries({ id: 'srs_1', name: 'SSC CHSL Tier 2 mocks', examStageId: 'stage_9' }),
    ]);

    const error = await service
      .create({ baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' }, ADMIN)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.fieldErrors?.testSeriesId?.[0] ?? '', /SSC CHSL Tier 2 mocks/);
    assert.equal(prisma.tests.length, 0);
  });

  it('refuses a retired config', async () => {
    const { service } = serviceWith([], [makeBaseConfig({ id: 'cfg_1', isActive: false })]);

    const error = await service
      .create({ baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' }, ADMIN)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.baseConfigId?.[0]);
  });

  it('still builds on a locked config — the lock freezes its shape, not its use', async () => {
    const { service } = serviceWith([], [makeBaseConfig({ id: 'cfg_1', locked: true })]);

    const created = await service.create(
      { baseConfigId: 'cfg_1', title: 'Mock 1', testSeriesId: 'srs_1' },
      ADMIN,
    );

    assert.equal(created.baseConfigId, 'cfg_1');
  });
});

describe('TestsService — the scope has to name a part of the config', () => {
  it('refuses a sectional test that names no section', async () => {
    const { service } = serviceWith();

    const error = await service
      .create(
        {
          baseConfigId: 'cfg_1',
          title: 'Mock 1',
          testSeriesId: 'srs_1',
          scope: TEST_SCOPE.SECTIONAL,
        },
        ADMIN,
      )
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
          testSeriesId: 'srs_1',
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
        testSeriesId: 'srs_1',
        scope: TEST_SCOPE.SECTIONAL,
        scopeRef: { sectionId: 'sec_2' },
      },
      ADMIN,
    );

    assert.deepEqual(created.scopeRef, { sectionId: 'sec_2' });
  });
});

describe('TestsService — editing and removing', () => {
  it('leaves the schedule alone on an edit that keeps the test ranked', async () => {
    const { service, prisma } = serviceWith([
      makeTest({ id: 'tst_1', lateEntrySec: 1800, extraTimeSec: 600 }),
    ]);
    prisma.programUnlocks.push({
      testId: 'tst_1',
      programCode: 'FOUNDATION',
      opensAt: new Date('2026-09-01T03:30:00.000Z'),
    });

    await service.update('tst_1', { title: 'Mock 1 (revised)' });

    assert.deepEqual([prisma.tests[0]?.lateEntrySec, prisma.tests[0]?.extraTimeSec], [1800, 600]);
    assert.equal(prisma.programUnlocks.length, 1);
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
      .update('tst_1', { questionPoolFilter: { sections: {} } })
      .catch((e: unknown) => e);
    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);

    const renamed = await service.update('tst_1', { title: 'Mock 1 (revised)' });
    assert.equal(renamed.title, 'Mock 1 (revised)');
    // A rename moves no question, so it must not thaw the paper it was allowed to leave alone.
    assert.equal(prisma.tests[0]?.isLocked, true);
  });

  /** THE failure this prevents: a re-skin silently un-finalizing a paper it moves no question in. */
  it('re-skins a frozen test without thawing the paper', async () => {
    const { service, prisma } = serviceWith([
      makeTest({ id: 'tst_1', isLocked: true, status: TEST_STATUS.ACTIVE }),
    ]);

    const updated = await service.update('tst_1', { examTemplate: EXAM_TEMPLATE.SSC_RAILWAYS });

    assert.equal(updated.examTemplate, EXAM_TEMPLATE.SSC_RAILWAYS);
    assert.equal(prisma.tests[0]?.isLocked, true);
    assert.equal(prisma.tests[0]?.status, TEST_STATUS.ACTIVE);
  });

  /** A student who sat the comfortable screen must not have their test re-skinned under them. */
  it('refuses a re-skin once a student has sat it', async () => {
    const { service } = serviceWith([makeTest({ id: 'tst_1' })], undefined, {
      attempts: [{ testId: 'tst_1' }],
    });

    const error = await service
      .update('tst_1', { examTemplate: EXAM_TEMPLATE.SSC_RAILWAYS })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  /** The failure this prevents: a frozen paper left pointing at a scope it no longer covers. */
  it('thaws a frozen test nobody has sat when its shape changes', async () => {
    const { service, prisma } = serviceWith([
      makeTest({ id: 'tst_1', isLocked: true, status: TEST_STATUS.ACTIVE }),
    ]);

    await service.update('tst_1', { questionPoolFilter: { sections: {} } });

    const test = rowAt(prisma.tests);
    assert.equal(test.isLocked, false);
    assert.equal(test.finalizedAt, null);
    // An unfrozen test cannot be offered, so it stops being offered rather than going incoherent.
    assert.equal(test.status, TEST_STATUS.DRAFT);
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
  it('deletes a finalized test a series still offers, because nobody sat it', async () => {
    const { service, prisma } = serviceWith([
      makeTest({
        id: 'tst_1',
        isLocked: true,
        status: TEST_STATUS.ACTIVE,
        testSeriesId: 'srs_1',
      }),
    ]);

    await service.remove('tst_1');

    assert.equal(prisma.tests.length, 0);
  });

  /** The failure this prevents: a deleted test still reachable in a student's cached catalog. */
  it('tells the series that carried it that the catalog has moved', async () => {
    const { service, events } = serviceWith([makeTest({ id: 'tst_1', testSeriesId: 'srs_1' })]);

    await service.remove('tst_1');

    assert.deepEqual(
      events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED).map((payload) => payload.testSeriesId),
      ['srs_1'],
    );
  });
});

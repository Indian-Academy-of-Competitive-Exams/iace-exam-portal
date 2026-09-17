import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, beforeEach, describe, it } from 'node:test';
import type { Prisma } from '@prisma/client';
import {
  AppException,
  EXAM_TEMPLATE,
  ErrorCodes,
  TEST_SCOPE,
  TEST_SERIES_KIND,
  TEST_STATUS,
} from '@iace/contracts';
import { AuditContext } from '../src/audit';
import { DOMAIN_EVENTS } from '../src/common/events';
import { BaseConfigsService } from '../src/configs/base-configs.service';
import { ExamStagesService } from '../src/configs/exam-stages.service';
import { TestsService } from '../src/tests/tests.service';
import { FakeEventBus } from '../test/support/fakes';
import {
  BUILDER,
  makeBuilder,
  makeSitting,
  makeStudent,
  resetDatabase,
  testPrisma,
} from './support/database';

/** One uuid per label, shared across the file so a test can name an id by what it means. */
const idCache = new Map<string, string>();
const idFor = (label: string): string => {
  const cached = idCache.get(label);
  if (cached) return cached;
  const id = randomUUID();
  idCache.set(label, id);
  return id;
};

const ADMIN = idFor('adm_1');
const TEST = idFor('tst_1');
const DRAFT = { baseConfigId: BUILDER.CONFIG, title: 'Mock 1', testSeriesId: idFor('srs_1') };

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

interface Bench {
  config?: Partial<Prisma.BaseConfigUncheckedCreateInput>;
  /** The series tests are made in: stage-agnostic (so FREE) unless given a stage. */
  series?: { id: string; name: string; examStageId?: string }[];
  test?: Partial<Prisma.TestUncheckedCreateInput>;
}

/** The SSC CGL Tier 1 pattern — two sections, 50 questions, an hour — and a series to build in. */
async function serviceWith(over: Bench = {}) {
  await makeBuilder(
    prisma,
    [
      { id: idFor('sec_1'), name: 'General Intelligence' },
      { id: idFor('sec_2'), name: 'Quantitative Aptitude' },
    ],
    { totalQuestions: 50, durationSec: 3600, ...over.config },
  );
  for (const series of over.series ?? [{ id: idFor('srs_1'), name: 'SSC CGL Tier 1 mocks' }]) {
    await prisma.testSeries.create({
      data: {
        ...series,
        kind: series.examStageId ? TEST_SERIES_KIND.STANDARD : TEST_SERIES_KIND.FREE,
      },
    });
  }
  if (over.test) {
    await prisma.test.create({
      data: {
        id: TEST,
        title: 'Mock 1',
        baseConfigId: BUILDER.CONFIG,
        examStageId: BUILDER.STAGE,
        testSeriesId: idFor('srs_1'),
        ...over.test,
      },
    });
  }
  const events = new FakeEventBus();
  const audit = new AuditContext();
  const configs = new BaseConfigsService(prisma, new ExamStagesService(prisma, audit), audit);
  return { events, service: new TestsService(prisma, configs, audit, events.asService()) };
}

const FROZEN = { isLocked: true, finalizedAt: new Date('2026-08-01T00:00:00.000Z') };

const testRow = () => prisma.test.findUnique({ where: { id: TEST } });

const sat = async () =>
  makeSitting(prisma, { testId: TEST, studentId: (await makeStudent(prisma)).id, score: 0 });

const refused = async (attempt: Promise<unknown>) => {
  const error = await attempt.catch((caught: unknown) => caught);
  assert.ok(AppException.is(error));
  return error;
};

describe('TestsService — creating a draft from a config', () => {
  it('writes a draft whose shape is the config it points at', async () => {
    const { service } = await serviceWith();

    const created = await service.create(DRAFT, ADMIN);

    assert.equal(created.status, TEST_STATUS.DRAFT);
    assert.equal(created.totalQuestions, 50);
    assert.equal(created.durationSec, 3600);
    assert.equal(created.baseConfig.sections.length, 2);
    assert.equal(created.scope, TEST_SCOPE.FULL);
  });

  /** The screen is asked for at creation now; the blueprint only says where the answer starts. */
  it('wears the screen the admin chose, and falls back to the config when they chose none', async () => {
    const { service } = await serviceWith({ config: { examTemplate: EXAM_TEMPLATE.SSC_RAILWAYS } });

    const chosen = await service.create(
      { ...DRAFT, title: 'Mock 1', examTemplate: EXAM_TEMPLATE.DEFAULT },
      ADMIN,
    );
    const defaulted = await service.create({ ...DRAFT, title: 'Mock 2' }, ADMIN);

    assert.equal(chosen.examTemplate, EXAM_TEMPLATE.DEFAULT);
    assert.equal(defaulted.examTemplate, EXAM_TEMPLATE.SSC_RAILWAYS);
  });

  /** The copy is the point: re-skinning the blueprint must not re-skin a test already built. */
  it('keeps the screen it was built with when the config is re-skinned', async () => {
    const { service } = await serviceWith();
    const created = await service.create(DRAFT, ADMIN);

    await prisma.baseConfig.update({
      where: { id: BUILDER.CONFIG },
      data: { examTemplate: EXAM_TEMPLATE.SSC_RAILWAYS },
    });

    assert.equal((await service.detail(created.id)).examTemplate, EXAM_TEMPLATE.DEFAULT);
  });

  it('follows the config when it changes, because it never copied it', async () => {
    const { service } = await serviceWith();
    const created = await service.create(DRAFT, ADMIN);

    await prisma.baseConfig.update({
      where: { id: BUILDER.CONFIG },
      data: { durationSec: 4800, totalQuestions: 60 },
    });

    // The failure this prevents: an hour still served after the pattern moved to 80 minutes.
    const reread = await service.detail(created.id);
    assert.equal(reread.durationSec, 4800);
    assert.equal(reread.totalQuestions, 60);
  });

  /** The composite FK is what keeps a test and its blueprint on one stage; the body has no say. */
  it('takes the stage off the config, never off the body', async () => {
    const { service } = await serviceWith({ config: { examStageId: BUILDER.OTHER_STAGE } });

    const created = await service.create(DRAFT, ADMIN);

    assert.equal(created.examStageId, BUILDER.OTHER_STAGE);
    const row = await prisma.test.findUniqueOrThrow({ where: { id: created.id } });
    assert.equal(row.examStageId, BUILDER.OTHER_STAGE);
  });

  it('refuses a test in a series that is not there', async () => {
    const { service } = await serviceWith();

    const error = await refused(
      service.create({ ...DRAFT, testSeriesId: idFor('srs_gone') }, ADMIN),
    );

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.testSeriesId?.[0]);
    assert.equal(await prisma.test.count(), 0);
  });

  /** The failure this prevents: a Tier 1 paper served to the Tier 2 students the series reaches. */
  it('refuses a series built for another stage, and names it', async () => {
    const { service } = await serviceWith({
      series: [
        { id: idFor('srs_1'), name: 'SSC CHSL Tier 2 mocks', examStageId: BUILDER.OTHER_STAGE },
      ],
    });

    const error = await refused(service.create(DRAFT, ADMIN));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.match(error.fieldErrors?.testSeriesId?.[0] ?? '', /SSC CHSL Tier 2 mocks/);
    assert.equal(await prisma.test.count(), 0);
  });

  it('refuses a retired config', async () => {
    const { service } = await serviceWith({ config: { isActive: false } });

    const error = await refused(service.create(DRAFT, ADMIN));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.baseConfigId?.[0]);
  });

  it('still builds on a locked config — the lock freezes its shape, not its use', async () => {
    const { service } = await serviceWith();
    await prisma.baseConfig.update({ where: { id: BUILDER.CONFIG }, data: { locked: true } });

    const created = await service.create(DRAFT, ADMIN);

    assert.equal(created.baseConfigId, BUILDER.CONFIG);
  });
});

describe('TestsService — the scope has to name a part of the config', () => {
  const sectional = (scopeRef?: { sectionId: string }) => ({
    ...DRAFT,
    scope: TEST_SCOPE.SECTIONAL,
    ...(scopeRef ? { scopeRef } : {}),
  });

  it('refuses a sectional test that names no section, or one the config does not hold', async () => {
    const { service } = await serviceWith();

    const unnamed = await refused(service.create(sectional(), ADMIN));
    const elsewhere = await refused(
      service.create(sectional({ sectionId: idFor('sec_9') }), ADMIN),
    );

    assert.equal(unnamed.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(unnamed.fieldErrors?.scopeRef?.[0]);
    assert.equal(elsewhere.code, ErrorCodes.VALIDATION_ERROR);
  });

  it('accepts a section of its own config', async () => {
    const { service } = await serviceWith();

    const created = await service.create(sectional({ sectionId: idFor('sec_2') }), ADMIN);

    assert.deepEqual(created.scopeRef, { sectionId: idFor('sec_2') });
  });
});

describe('TestsService — a name belongs to one test inside its series', () => {
  /** The failure this prevents: two "Mock 1" rows in one series, and no way to tell them apart. */
  it('refuses a second test named like one the series already holds, whatever its case', async () => {
    const { service } = await serviceWith({ test: {} });

    const error = await refused(service.create({ ...DRAFT, title: 'MOCK 1' }, ADMIN));

    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.ok(error.fieldErrors?.title);
  });

  /** Unique WITHIN a series: two series each running their own "Mock 1" is the normal case. */
  it('lets another series hold a test of the same name', async () => {
    const { service } = await serviceWith({
      test: {},
      series: [
        { id: idFor('srs_1'), name: 'SSC CGL Tier 1 mocks' },
        { id: idFor('srs_2'), name: 'SSC CGL Tier 2 mocks' },
      ],
    });

    const created = await service.create({ ...DRAFT, testSeriesId: idFor('srs_2') }, ADMIN);

    assert.equal(created.title, 'Mock 1');
  });

  it('lets a test keep its own name through an edit', async () => {
    const { service } = await serviceWith({ test: {} });

    assert.equal((await service.update(TEST, { title: 'Mock 1' })).title, 'Mock 1');
  });
});

describe('TestsService — editing and removing', () => {
  it('leaves the opening and its program openings alone on an edit that keeps the test ranked', async () => {
    const opensAt = new Date('2026-09-01T04:30:00.000Z');
    const { service } = await serviceWith({ test: { opensAt } });
    await prisma.program.create({ data: { code: 'FOUNDATION', name: 'Foundation' } });
    await prisma.testProgramUnlock.create({
      data: {
        testId: TEST,
        programCode: 'FOUNDATION',
        opensAt: new Date('2026-09-01T03:30:00.000Z'),
      },
    });

    await service.update(TEST, { title: 'Mock 1 (revised)' });

    assert.deepEqual((await testRow())?.opensAt, opensAt);
    assert.equal(await prisma.testProgramUnlock.count(), 1);
  });

  it('refuses every change but the title once a student has sat it', async () => {
    const { service } = await serviceWith({ test: FROZEN });
    await sat();

    const error = await refused(service.update(TEST, { questionPoolFilter: { sections: {} } }));
    assert.equal(error.code, ErrorCodes.CONFLICT);

    const renamed = await service.update(TEST, { title: 'Mock 1 (revised)' });
    assert.equal(renamed.title, 'Mock 1 (revised)');
    // A rename moves no question, so it must not thaw the paper it was allowed to leave alone.
    assert.equal((await testRow())?.isLocked, true);
  });

  /** THE failure this prevents: a re-skin silently un-finalizing a paper it moves no question in. */
  it('re-skins a frozen test without thawing the paper', async () => {
    const { service } = await serviceWith({ test: { ...FROZEN, status: TEST_STATUS.ACTIVE } });

    const updated = await service.update(TEST, { examTemplate: EXAM_TEMPLATE.SSC_RAILWAYS });

    assert.equal(updated.examTemplate, EXAM_TEMPLATE.SSC_RAILWAYS);
    const row = await testRow();
    assert.deepEqual([row?.isLocked, row?.status], [true, TEST_STATUS.ACTIVE]);
  });

  /** A student who sat the comfortable screen must not have their test re-skinned under them. */
  it('refuses a re-skin once a student has sat it', async () => {
    const { service } = await serviceWith({ test: {} });
    await sat();

    const error = await refused(service.update(TEST, { examTemplate: EXAM_TEMPLATE.SSC_RAILWAYS }));

    assert.equal(error.code, ErrorCodes.CONFLICT);
  });

  /** The failure this prevents: a frozen paper left pointing at a scope it no longer covers. */
  it('thaws a frozen test nobody has sat when its shape changes', async () => {
    const { service } = await serviceWith({ test: { ...FROZEN, status: TEST_STATUS.ACTIVE } });

    await service.update(TEST, { questionPoolFilter: { sections: {} } });

    const row = await testRow();
    assert.equal(row?.isLocked, false);
    assert.equal(row?.finalizedAt, null);
    // An unfrozen test cannot be offered, so it stops being offered rather than going incoherent.
    assert.equal(row?.status, TEST_STATUS.DRAFT);
  });

  it('refuses to delete a test students have sat', async () => {
    const { service } = await serviceWith({ test: {} });
    await sat();

    assert.equal((await refused(service.remove(TEST))).code, ErrorCodes.CONFLICT);
  });

  it('deletes a draft nothing depends on', async () => {
    const { service } = await serviceWith({ test: {} });

    await service.remove(TEST);

    assert.equal(await testRow(), null);
  });

  /** Being frozen and being offered are states a test can be talked out of; being sat is not. */
  it('deletes a finalized test a series still offers, because nobody sat it', async () => {
    const { service } = await serviceWith({ test: { ...FROZEN, status: TEST_STATUS.ACTIVE } });

    await service.remove(TEST);

    assert.equal(await testRow(), null);
  });

  /** The failure this prevents: a deleted test still reachable in a student's cached catalog. */
  it('tells the series that carried it that the catalog has moved', async () => {
    const { service, events } = await serviceWith({ test: {} });

    await service.remove(TEST);

    assert.deepEqual(
      events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED).map((payload) => payload.testSeriesId),
      [idFor('srs_1')],
    );
  });
});

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVERY_BRANCH } from '../src/common/security';
import {
  AppException,
  ErrorCodes,
  TEST_SERIES_KIND,
  updateBranchTestConfigSchema,
} from '@iace/contracts';
import { ProgramsService } from '../src/access/programs.service';
import { TestSeriesService } from '../src/access/test-series.service';
import { StudentGrantsService } from '../src/access/student-grants.service';
import { ExamStagesService } from '../src/configs';
import { AuditContext } from '../src/audit';
import { DOMAIN_EVENTS } from '../src/common/events';
import { BranchSeriesController } from '../src/access/access.controller';
import { ActorTypes, branchSeriesListQuerySchema } from '@iace/contracts';
import {
  FakeEventBus,
  type FakeBranch,
  type FakeProgramRow,
  type FakeBranchConfigRow,
  type FakeSeriesRow,
  type FakeStudent,
  FakeAccessPrisma,
  makeBranch,
  makeExamStage,
  makeProgram,
  makeBranchConfig,
  makeSeries,
  makeStudent,
} from './support/fakes';

const ADMIN = 'adm_1';

function build(
  options: {
    programs?: FakeProgramRow[];
    series?: FakeSeriesRow[];
    branches?: FakeBranch[];
    branchConfigs?: FakeBranchConfigRow[];
    students?: FakeStudent[];
  } = {},
) {
  const prisma = new FakeAccessPrisma(
    options.programs ?? [],
    options.series ?? [],
    options.branches ?? [],
    options.branchConfigs ?? [],
    options.students ?? [],
    [],
    [makeExamStage({ id: 'stage_1' })],
  );
  const auditContext = new AuditContext();
  const events = new FakeEventBus();
  const programs = new ProgramsService(prisma.asService(), auditContext);
  const stages = new ExamStagesService(prisma.asService(), auditContext);

  return {
    prisma,
    programs,
    events,
    series: new TestSeriesService(
      prisma.asService(),
      stages,
      programs,
      auditContext,
      events.asService(),
    ),
    grants: new StudentGrantsService(prisma.asService(), auditContext, events.asService()),
  };
}

const draft = (over: Record<string, unknown> = {}) =>
  ({ name: 'SSC CGL Tier 1 mocks', examStageId: 'stage_1', ...over }) as never;

describe('TestSeriesService — the branch fan-out', () => {
  /**
   * THE rule this exists for: "not offered at this centre" is `enabled: false` on a row that
   * exists. An ABSENT row would have to be read as a default, and a default is exactly what
   * nobody can see on a screen or find in an audit trail.
   */
  /** The fan-out leaves every row OFF, so the thirtieth switch is the one somebody forgets. */
  it('switches every branch on at once, and tells the catalog', async () => {
    const { series, prisma, events } = build({
      branches: [
        makeBranch({ id: 'br_1', name: 'AMEERPET' }),
        makeBranch({ id: 'br_2', name: 'DILSUKHNAGAR' }),
        makeBranch({ id: 'br_3', name: 'ONLINE' }),
      ],
    });
    const created = await series.create(draft());
    assert.deepEqual(
      prisma.branchConfigs.map((config) => config.enabled),
      [false, false, false],
      'the fan-out leaves a new series off everywhere',
    );

    const rows = await series.updateEveryBranchConfig(created.id, { enabled: true }, EVERY_BRANCH);

    assert.deepEqual(
      rows.map((row) => row.enabled),
      [true, true, true],
    );
    assert.deepEqual(
      events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED),
      [{ testSeriesId: created.id }],
      'a catalog nobody rebuilt would keep the series hidden from every student',
    );
  });

  /** Only this series: the switch is per series, and every other one keeps the state it had. */
  it('leaves another series alone', async () => {
    const { series, prisma } = build({ branches: [makeBranch({ id: 'br_1', name: 'AMEERPET' })] });
    const mine = await series.create(draft());
    const other = await series.create(draft({ name: 'RRB JE Tier 1 mocks' }));

    await series.updateEveryBranchConfig(mine.id, { enabled: true }, EVERY_BRANCH);

    assert.equal(prisma.branchConfigs.find((c) => c.testSeriesId === other.id)?.enabled, false);
  });

  it('gives every branch a row the moment the series is created', async () => {
    const { series, prisma } = build({
      branches: [
        makeBranch({ id: 'br_1', name: 'AMEERPET' }),
        makeBranch({ id: 'br_2', name: 'DILSUKHNAGAR' }),
        makeBranch({ id: 'br_3', name: 'ONLINE' }),
      ],
    });

    const created = await series.create(draft());

    assert.equal(prisma.branchConfigs.length, 3);
    assert.deepEqual(
      prisma.branchConfigs.map((config) => config.testSeriesId),
      [created.id, created.id, created.id],
    );
  });

  /** A new series must not appear at every centre in the country the moment it is saved. */
  it('starts every one of them switched off', async () => {
    const { series, prisma } = build({ branches: [makeBranch({ id: 'br_1' })] });

    const created = await series.create(draft());

    assert.equal(prisma.branchConfigs[0]?.enabled, false);
    assert.equal(created.enabledBranchCount, 0);
    assert.equal(created.branchCount, 1);
  });

  it('reports how many branches run it, out of how many could', async () => {
    const { series } = build({
      branches: [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_2', name: 'ONLINE' })],
    });
    const created = await series.create(draft());

    await series.updateBranchConfig(created.id, 'br_1', { enabled: true }, EVERY_BRANCH);
    const after = await series.detail(created.id);

    assert.equal(after.enabledBranchCount, 1);
    assert.equal(after.branchCount, 2);
  });

  /** A branch runs a series indefinitely: the only schedule left belongs to the test. */
  it('takes nothing but the switch', () => {
    const parsed = updateBranchTestConfigSchema.safeParse({
      enabled: true,
      startAt: '2026-09-01T00:00:00.000Z',
    });

    assert.equal(parsed.success, true);
    assert.equal('startAt' in (parsed.data ?? {}), false);
  });

  it('refuses to schedule a branch that has no row for the series', async () => {
    const { series } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());

    await assert.rejects(
      () => series.updateBranchConfig(created.id, 'br_gone', { enabled: true }, EVERY_BRANCH),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.NOT_FOUND);
        return true;
      },
    );
  });
});

describe('TestSeriesService — what a series may point at', () => {
  it('refuses a stage that is retired', async () => {
    const prisma = new FakeAccessPrisma(
      [],
      [],
      [],
      [],
      [],
      [],
      [makeExamStage({ id: 'stage_1', isActive: false })],
    );
    const auditContext = new AuditContext();
    const series = new TestSeriesService(
      prisma.asService(),
      new ExamStagesService(prisma.asService(), auditContext),
      new ProgramsService(prisma.asService(), auditContext),
      auditContext,
      new FakeEventBus().asService(),
    );

    await assert.rejects(() => series.create(draft()), AppException.is);
  });

  it('refuses a program code the catalog does not hold', async () => {
    const { series } = build();

    await assert.rejects(
      () => series.create(draft({ programCode: 'NOPE' })),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.programCode);
        return true;
      },
    );
  });

  it('refuses a series that waits on itself', async () => {
    const { series } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());

    await assert.rejects(
      () => series.update(created.id, { prerequisiteSeriesId: created.id }),
      AppException.is,
    );
  });

  /** The failure this prevents: a series offered in the browse list that is then held shut. */
  it('refuses a free series that waits on another', async () => {
    const { series } = build({ series: [makeSeries({ id: 'srs_1' })] });

    const error = await series
      .create(draft({ kind: TEST_SERIES_KIND.FREE, prerequisiteSeriesId: 'srs_1' }))
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    // Named on the field an admin clears to fix it, not on the kind they just chose.
    assert.ok(error.fieldErrors?.prerequisiteSeriesId);
  });

  it('refuses turning a series that waits on another into a free one', async () => {
    const { series } = build({
      series: [
        makeSeries({ id: 'srs_1' }),
        makeSeries({ id: 'srs_2', name: 'Tier 2', prerequisiteSeriesId: 'srs_1' }),
      ],
    });

    await assert.rejects(
      () => series.update('srs_2', { kind: TEST_SERIES_KIND.FREE }),
      AppException.is,
    );
  });

  it('refuses putting a prerequisite in front of a series that is already free', async () => {
    const { series } = build({
      series: [
        makeSeries({ id: 'srs_1' }),
        makeSeries({ id: 'srs_2', name: 'Free mocks', kind: TEST_SERIES_KIND.FREE }),
      ],
    });

    await assert.rejects(
      () => series.update('srs_2', { prerequisiteSeriesId: 'srs_1' }),
      AppException.is,
    );
  });

  it('leaves a standard series waiting on another alone', async () => {
    const { series } = build({
      series: [
        makeSeries({ id: 'srs_1' }),
        makeSeries({ id: 'srs_2', name: 'Tier 2', prerequisiteSeriesId: 'srs_1' }),
      ],
    });

    const updated = await series.update('srs_2', { name: 'Tier 2 mocks' });

    assert.equal(updated.prerequisiteSeriesId, 'srs_1');
  });

  it('refuses to delete one that another series waits on', async () => {
    const { series } = build({
      series: [
        makeSeries({ id: 'srs_1' }),
        makeSeries({ id: 'srs_2', name: 'Tier 2', prerequisiteSeriesId: 'srs_1' }),
      ],
    });

    await assert.rejects(() => series.remove('srs_1'), AppException.is);
  });
});

describe('ProgramsService', () => {
  it('creates a program and normalises its code', async () => {
    const { programs } = build();

    const created = await programs.create({ code: 'SSC CGL FOUNDATION', name: 'Foundation' });

    assert.equal(created.code, 'SSC CGL FOUNDATION');
  });

  it('refuses a code the catalog already holds', async () => {
    const { programs } = build({ programs: [makeProgram({ code: 'SSC CGL FOUNDATION' })] });

    await assert.rejects(
      () => programs.create({ code: 'SSC CGL FOUNDATION', name: 'Again' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        return true;
      },
    );
  });

  /**
   * `Student.programs` and `TestSeries.programCode` both hold the code as free text with no
   * foreign key, so a rename detaches every one of them with no error and no rows changed.
   */
  it('refuses a code change once a student carries it', async () => {
    const { programs, prisma } = build({
      programs: [makeProgram({ id: 'prog_1', code: 'SSC CGL FOUNDATION' })],
      students: [makeStudent({ programs: ['SSC CGL FOUNDATION'] })],
    });

    await assert.rejects(
      () => programs.update('prog_1', { code: 'SSC CGL FOUNDATION 2026' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.code);
        return true;
      },
    );
    assert.equal(prisma.programs[0]?.code, 'SSC CGL FOUNDATION');
  });

  it('refuses a code change once a series carries it, and offers retiring instead', async () => {
    const { programs } = build({
      programs: [makeProgram({ id: 'prog_1', code: 'SSC CGL FOUNDATION' })],
      series: [makeSeries({ programCode: 'SSC CGL FOUNDATION' })],
    });

    const error = await programs.update('prog_1', { code: 'RENAMED' }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /[Rr]etire/);
  });

  it('renames and retires without touching the code', async () => {
    const { programs } = build({
      programs: [makeProgram({ id: 'prog_1' })],
      students: [makeStudent({ programs: ['SSC CGL FOUNDATION'] })],
    });

    const updated = await programs.update('prog_1', { name: 'Foundation 2026', isActive: false });

    assert.equal(updated.name, 'Foundation 2026');
    assert.equal(updated.isActive, false);
  });

  it('refuses an inactive program where a student is being enrolled', async () => {
    const { programs } = build({ programs: [makeProgram({ isActive: false })] });

    const error = await programs
      .assertUsable(['SSC CGL FOUNDATION'], 'programs')
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.programs);
  });
});

describe('StudentGrantsService — the escape hatch', () => {
  it('grants a series to one student and reads it back named', async () => {
    const { grants } = build({
      series: [makeSeries({ id: 'srs_1', name: 'Scholarship mocks' })],
      students: [makeStudent({ id: 'stu_1' })],
    });

    const after = await grants.grant('stu_1', { testSeriesId: 'srs_1' }, ADMIN, EVERY_BRANCH);

    assert.equal(after.length, 1);
    assert.equal(after[0]?.testSeries.name, 'Scholarship mocks');
  });

  /** Re-reading the roster it came from is the normal way to use this. */
  it('is idempotent — granting twice leaves one grant', async () => {
    const { grants, prisma } = build({
      series: [makeSeries({ id: 'srs_1' })],
      students: [makeStudent({ id: 'stu_1' })],
    });

    await grants.grant('stu_1', { testSeriesId: 'srs_1' }, ADMIN, EVERY_BRANCH);
    await grants.grant('stu_1', { testSeriesId: 'srs_1' }, ADMIN, EVERY_BRANCH);

    assert.equal(prisma.grants.length, 1);
  });

  it('refuses a grant to a student who is blocked from tests', async () => {
    const { grants } = build({
      series: [makeSeries({ id: 'srs_1' })],
      students: [makeStudent({ id: 'stu_1', isTestBlocked: true })],
    });

    await assert.rejects(
      () => grants.grant('stu_1', { testSeriesId: 'srs_1' }, ADMIN, EVERY_BRANCH),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.testSeriesId);
        return true;
      },
    );
  });

  it('refuses a series that is not there', async () => {
    const { grants } = build({ students: [makeStudent({ id: 'stu_1' })] });

    await assert.rejects(
      () => grants.grant('stu_1', { testSeriesId: 'nope' }, ADMIN, EVERY_BRANCH),
      AppException.is,
    );
  });

  it('takes one back', async () => {
    const { grants, prisma } = build({
      series: [makeSeries({ id: 'srs_1' })],
      students: [makeStudent({ id: 'stu_1' })],
    });
    await grants.grant('stu_1', { testSeriesId: 'srs_1' }, ADMIN, EVERY_BRANCH);

    await grants.revoke('stu_1', 'srs_1', EVERY_BRANCH);

    assert.equal(prisma.grants.length, 0);
  });
});

/**
 * The cached catalog is only ever right because these fire. A write that moves access and stays
 * silent leaves the student on the old answer until the entry expires.
 */
describe('the access writes that bust the catalog cache', () => {
  it('announces the student on a grant and again on a revoke', async () => {
    const { grants, events } = build({
      series: [makeSeries({ id: 'srs_1' })],
      students: [makeStudent({ id: 'stu_1' })],
    });

    await grants.grant('stu_1', { testSeriesId: 'srs_1' }, ADMIN, EVERY_BRANCH);
    await grants.revoke('stu_1', 'srs_1', EVERY_BRANCH);

    assert.deepEqual(events.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED), [
      { studentId: 'stu_1' },
      { studentId: 'stu_1' },
    ]);
  });

  /** What the student is TOLD, as opposed to what the cache has to forget — two different facts. */
  it('announces the grant itself once, however often the roster is re-read', async () => {
    const { grants, events } = build({
      series: [makeSeries({ id: 'srs_1' })],
      students: [makeStudent({ id: 'stu_1' })],
    });

    await grants.grant('stu_1', { testSeriesId: 'srs_1' }, ADMIN, EVERY_BRANCH);
    await grants.grant('stu_1', { testSeriesId: 'srs_1' }, ADMIN, EVERY_BRANCH);

    assert.deepEqual(events.of(DOMAIN_EVENTS.SERIES_GRANTED), [
      { studentId: 'stu_1', testSeriesId: 'srs_1' },
    ]);
  });

  it('announces the series when a branch’s row for it moves', async () => {
    const { series, events } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());

    await series.updateBranchConfig(created.id, 'br_1', { enabled: true }, EVERY_BRANCH);

    assert.deepEqual(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED), [
      { testSeriesId: created.id },
    ]);
  });
});

describe('StudentGrantsService — the branches the admin asking may reach', () => {
  const held = { all: false, branchIds: ['br_1'] } as const;

  const atBranch = (branchId: string | null) =>
    build({
      series: [makeSeries({ id: 'srs_1' })],
      branches: [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_9' })],
      students: [makeStudent({ id: 'stu_1', currentBranchId: branchId })],
    });

  /** The failure this prevents: granting series to a student at somebody else's branch. */
  it('refuses to grant to a student at another branch', async () => {
    const { grants } = atBranch('br_9');

    const error = await grants
      .grant('stu_1', { testSeriesId: 'srs_1' }, ADMIN, held)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('refuses to list what a student at another branch reaches', async () => {
    const { grants } = atBranch('br_9');

    const error = await grants.reachedSeries('stu_1', held).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('refuses to read what a student at another branch was granted', async () => {
    const { grants } = atBranch('br_9');

    const error = await grants.list('stu_1', held).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('refuses to take a grant back from a student at another branch', async () => {
    const { grants } = atBranch('br_9');

    const error = await grants.revoke('stu_1', 'srs_1', held).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it("grants to a student at the admin's own branch", async () => {
    const { grants } = atBranch('br_1');

    const rows = await grants.grant('stu_1', { testSeriesId: 'srs_1' }, ADMIN, held);

    assert.equal(rows.length, 1);
  });
});

describe("TestSeriesService — one branch's series, from the branch's side", () => {
  const listQuery = (over: Record<string, string> = {}) =>
    branchSeriesListQuerySchema.parse({ page: '1', pageSize: '20', ...over });

  const twoSeries = () =>
    build({
      series: [
        makeSeries({ id: 'srs_1', name: 'SSC CGL Tier 1 mocks' }),
        makeSeries({ id: 'srs_2', name: 'RRB JE Stage 1' }),
      ],
      branches: [makeBranch({ id: 'br_1' })],
      branchConfigs: [
        makeBranchConfig({ id: 'btc_1', branchId: 'br_1', testSeriesId: 'srs_1', enabled: true }),
        makeBranchConfig({ id: 'btc_2', branchId: 'br_1', testSeriesId: 'srs_2', enabled: false }),
      ],
    });

  it("lists every series with this branch's switch", async () => {
    const { series } = twoSeries();

    const page = await series.seriesForBranch('br_1', listQuery());

    assert.deepEqual(
      page.items.map((row) => [row.testSeriesId, row.enabled]),
      [
        ['srs_2', false],
        ['srs_1', true],
      ],
    );
    assert.equal(page.total, 2);
  });

  /** The failure this prevents: a series with no config row vanishing instead of reading as off. */
  it('shows a series with no row for this branch as switched off', async () => {
    const { series } = build({
      series: [makeSeries({ id: 'srs_1' })],
      branches: [makeBranch({ id: 'br_1' })],
      branchConfigs: [],
    });

    const page = await series.seriesForBranch('br_1', listQuery());

    assert.equal(page.total, 1);
    assert.equal(page.items[0]?.enabled, false);
  });

  it('counts what the filter left, not the whole table', async () => {
    const { series } = twoSeries();

    const page = await series.seriesForBranch('br_1', listQuery({ q: 'RRB' }));

    assert.equal(page.total, 1);
    assert.equal(page.items.length, 1);
  });

  it('counts what the enabled filter left', async () => {
    const { series } = twoSeries();

    const page = await series.seriesForBranch('br_1', listQuery({ enabled: 'true' }));

    assert.equal(page.total, 1);
  });

  it('narrows to what the branch runs, and to what it does not', async () => {
    const { series } = twoSeries();

    const on = await series.seriesForBranch('br_1', listQuery({ enabled: 'true' }));
    const off = await series.seriesForBranch('br_1', listQuery({ enabled: 'false' }));

    assert.deepEqual(
      on.items.map((row) => row.testSeriesId),
      ['srs_1'],
    );
    assert.deepEqual(
      off.items.map((row) => row.testSeriesId),
      ['srs_2'],
    );
  });
});

describe("TestSeriesService — saving a branch's draft in one write", () => {
  const withBoth = () =>
    build({
      series: [makeSeries({ id: 'srs_1' }), makeSeries({ id: 'srs_2', name: 'Second' })],
      branches: [makeBranch({ id: 'br_1' })],
      branchConfigs: [
        makeBranchConfig({ id: 'btc_1', branchId: 'br_1', testSeriesId: 'srs_1', enabled: true }),
        makeBranchConfig({ id: 'btc_2', branchId: 'br_1', testSeriesId: 'srs_2', enabled: false }),
      ],
    });

  it('applies exactly the changes it was given', async () => {
    const { series, prisma } = withBoth();

    const changed = await series.setSeriesForBranch('br_1', {
      changes: [
        { testSeriesId: 'srs_1', enabled: false },
        { testSeriesId: 'srs_2', enabled: false },
      ],
    });

    // Only srs_1 MOVED; srs_2 was already off and is not counted or announced.
    assert.equal(changed, 1);
    assert.deepEqual(
      prisma.branchConfigs.map((row) => [row.testSeriesId, row.enabled]),
      [
        ['srs_1', false],
        ['srs_2', false],
      ],
    );
  });

  /** The listener busts the whole catalog whatever it is handed, so one event says the truth. */
  it('busts the catalog once, naming no series', async () => {
    const { series, events } = withBoth();

    await series.setSeriesForBranch('br_1', {
      changes: [
        { testSeriesId: 'srs_1', enabled: false },
        { testSeriesId: 'srs_2', enabled: true },
      ],
    });

    assert.deepEqual(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED), [{ testSeriesId: null }]);
  });

  /** A draft that asks for what is already true is not a change, and rings no bell. */
  it('busts nothing when the draft moves nothing', async () => {
    const { series, events } = withBoth();

    const changed = await series.setSeriesForBranch('br_1', {
      changes: [{ testSeriesId: 'srs_1', enabled: true }],
    });

    assert.equal(changed, 0);
    assert.deepEqual(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED), []);
  });

  /** The failure this prevents: one branch's save switching a series on for every branch. */
  it('leaves every other branch alone', async () => {
    const { series, prisma } = build({
      series: [makeSeries({ id: 'srs_1' })],
      branches: [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_2', name: 'KUKATPALLY' })],
      branchConfigs: [
        makeBranchConfig({ id: 'btc_1', branchId: 'br_1', testSeriesId: 'srs_1', enabled: true }),
        makeBranchConfig({ id: 'btc_2', branchId: 'br_2', testSeriesId: 'srs_1', enabled: true }),
      ],
    });

    await series.setSeriesForBranch('br_1', {
      changes: [{ testSeriesId: 'srs_1', enabled: false }],
    });

    assert.deepEqual(
      prisma.branchConfigs.map((row) => [row.branchId, row.enabled]),
      [
        ['br_1', false],
        ['br_2', true],
      ],
    );
  });

  /** A series configured elsewhere but not here is not this branch's to switch. */
  it('refuses a series whose row belongs to another branch', async () => {
    const { series, prisma } = build({
      series: [makeSeries({ id: 'srs_1' })],
      branches: [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_2', name: 'KUKATPALLY' })],
      branchConfigs: [
        makeBranchConfig({ id: 'btc_2', branchId: 'br_2', testSeriesId: 'srs_1', enabled: false }),
      ],
    });

    const error = await series
      .setSeriesForBranch('br_1', { changes: [{ testSeriesId: 'srs_1', enabled: true }] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(prisma.branchConfigs[0]?.enabled, false);
  });

  it('reads a branch that is not there as missing', async () => {
    const { series } = build({
      series: [makeSeries({ id: 'srs_1' })],
      branches: [makeBranch({ id: 'br_1' })],
      branchConfigs: [makeBranchConfig({ branchId: 'br_1', testSeriesId: 'srs_1' })],
    });

    const error = await series
      .setSeriesForBranch('br_nowhere', { changes: [{ testSeriesId: 'srs_1', enabled: true }] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  /** All or nothing: a half-applied draft leaves the screen disagreeing with the server. */
  it('writes nothing when one of the series is no longer here', async () => {
    const { series, prisma } = withBoth();

    const error = await series
      .setSeriesForBranch('br_1', {
        changes: [
          { testSeriesId: 'srs_1', enabled: false },
          { testSeriesId: 'srs_gone', enabled: true },
        ],
      })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.equal(prisma.branchConfigs[0]?.enabled, true);
  });
});

describe('TestSeriesService — the series side names a branch too', () => {
  const held = { all: false, branchIds: ['br_1'] } as const;

  const twoBranches = () =>
    build({
      series: [makeSeries({ id: 'srs_1' })],
      branches: [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_2', name: 'KUKATPALLY' })],
      branchConfigs: [
        makeBranchConfig({ id: 'btc_1', branchId: 'br_1', testSeriesId: 'srs_1', enabled: false }),
        makeBranchConfig({ id: 'btc_2', branchId: 'br_2', testSeriesId: 'srs_1', enabled: false }),
      ],
    });

  /** The same write, reached from the series rather than the branch, and refused the same way. */
  it('refuses to switch a series for a branch the admin does not hold', async () => {
    const { series, prisma } = twoBranches();

    const error = await series
      .updateBranchConfig('srs_1', 'br_2', { enabled: true }, held)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
    assert.equal(prisma.branchConfigs[1]?.enabled, false);
  });

  it('shows only the branches the admin holds', async () => {
    const { series } = twoBranches();

    const rows = await series.branchConfigs('srs_1', held);

    assert.deepEqual(
      rows.map((row) => row.branchId),
      ['br_1'],
    );
  });

  /** Every branch means every branch, including the ones the caller cannot see. */
  it('refuses the fan-out to an admin who does not reach every branch', async () => {
    const { series, prisma } = twoBranches();

    const error = await series
      .updateEveryBranchConfig('srs_1', { enabled: true }, held)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.FORBIDDEN);
    assert.deepEqual(
      prisma.branchConfigs.map((row) => row.enabled),
      [false, false],
    );
  });
});

describe("BranchSeriesController — the branch in the path is the caller's or it is missing", () => {
  const outsider = {
    id: 'adm_1',
    actor: ActorTypes.ADMIN,
    sessionId: 's',
    isSuperAdmin: false,
    isActive: true,
    permissions: {},
    allBranches: false,
    branchIds: ['br_1'],
  } as const;

  /** Never reached, because the scope check is the first statement of both handlers. */
  const unreachable = {
    seriesForBranch: () => Promise.reject(new Error('the service must not be reached')),
    setSeriesForBranch: () => Promise.reject(new Error('the service must not be reached')),
  } as never;

  const controller = new BranchSeriesController(unreachable);
  const query = branchSeriesListQuerySchema.parse({ page: '1', pageSize: '20' });

  it('refuses to list a branch the admin does not hold', async () => {
    const error = await Promise.resolve()
      .then(() => controller.list('br_9', query, outsider))
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  /** A positive control: a guard that refused everything would pass the two tests around it. */
  it('lets a branch the admin does hold through to the service', async () => {
    const reached = new BranchSeriesController({
      seriesForBranch: () => Promise.resolve({ items: [], page: 1, pageSize: 20, total: 0 }),
    } as never);

    const page = await reached.list('br_1', query, outsider);

    assert.equal(page.total, 0);
  });

  it('refuses to write a branch the admin does not hold', async () => {
    const error = await Promise.resolve()
      .then(() =>
        controller.set('br_9', { changes: [{ testSeriesId: 'srs_1', enabled: true }] }, outsider),
      )
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });
});

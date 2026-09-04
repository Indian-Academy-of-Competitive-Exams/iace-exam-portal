import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EVERY_BRANCH } from '../src/common/security';
import { AppException, ErrorCodes, TEST_SERIES_KIND } from '@iace/contracts';
import { ProgramsService } from '../src/access/programs.service';
import { TestSeriesService } from '../src/access/test-series.service';
import { StudentGrantsService } from '../src/access/student-grants.service';
import { ExamStagesService } from '../src/configs';
import { AuditContext } from '../src/audit';
import { DOMAIN_EVENTS } from '../src/common/events';
import {
  FakeEventBus,
  type FakeAccessTestRow,
  type FakeBranch,
  type FakeProgramRow,
  type FakeSeriesRow,
  type FakeStudent,
  FakeAccessPrisma,
  makeBranch,
  makeExamStage,
  makeProgram,
  makeSeries,
  makeStudent,
} from './support/fakes';

const ADMIN = 'adm_1';

function build(
  options: {
    programs?: FakeProgramRow[];
    series?: FakeSeriesRow[];
    branches?: FakeBranch[];
    students?: FakeStudent[];
    tests?: FakeAccessTestRow[];
  } = {},
) {
  const prisma = new FakeAccessPrisma(
    options.programs ?? [],
    options.series ?? [],
    options.branches ?? [],
    options.students ?? [],
    [],
    [makeExamStage({ id: 'stage_1' })],
    options.tests ?? [],
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

describe('TestSeriesService — branches are the truth about branches', () => {
  /** `branchIds` is what the resolver reads, so this write is the only thing that opens the door. */
  it('reaches a student at a branch the series names', async () => {
    const { series, prisma } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());

    await series.setBranches(created.id, { branchIds: ['br_1'] }, EVERY_BRANCH);

    assert.deepEqual(prisma.series[0]?.branchIds, ['br_1']);
  });

  it('stops reaching them when the branch is removed', async () => {
    const { series, prisma } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());
    await series.setBranches(created.id, { branchIds: ['br_1'] }, EVERY_BRANCH);

    await series.setBranches(created.id, { branchIds: [] }, EVERY_BRANCH);

    assert.deepEqual(prisma.series[0]?.branchIds, []);
  });

  /** `isEnabled` has ONE owner, and the branch writer is not it — it always passes nothing. */
  it('leaves the switch alone when branches change', async () => {
    const { series, prisma } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());
    await series.update(created.id, { isEnabled: true });

    await series.setBranches(created.id, { branchIds: ['br_1'] }, EVERY_BRANCH);

    assert.equal(prisma.series[0]?.isEnabled, true, 'the branch writer passes nothing');
  });

  /** Answered here so the form marks the field: the CHECK behind it can only leave as a 500. */
  it('refuses branches on a series that is not STANDARD', async () => {
    const { series } = build({
      series: [makeSeries({ id: 'srs_1', kind: TEST_SERIES_KIND.FREE })],
      branches: [makeBranch({ id: 'br_1' })],
    });

    const error = await series
      .setBranches('srs_1', { branchIds: ['br_1'] }, EVERY_BRANCH)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.kind);
  });

  it('tells the catalog when the list changes', async () => {
    const { series, events } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());
    events.forget();

    await series.setBranches(created.id, { branchIds: ['br_1'] }, EVERY_BRANCH);

    assert.deepEqual(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED), [
      { testSeriesId: created.id },
    ]);
  });

  /** Nothing in the array may name a branch that is not really there — it carries no FK. */
  it('refuses a branch that does not exist', async () => {
    const { series } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());

    const error = await series
      .setBranches(created.id, { branchIds: ['br_gone'] }, EVERY_BRANCH)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.branchIds);
  });

  /** Only this series: a write is per series, and every other one keeps the state it had. */
  it('leaves another series alone', async () => {
    const { series, prisma } = build({ branches: [makeBranch({ id: 'br_1', name: 'AMEERPET' })] });
    const mine = await series.create(draft());
    const other = await series.create(draft({ name: 'RRB JE Tier 1 mocks' }));

    await series.setBranches(mine.id, { branchIds: ['br_1'] }, EVERY_BRANCH);

    assert.deepEqual(prisma.series.find((row) => row.id === other.id)?.branchIds, []);
  });

  /** A new series must not appear at every centre in the country the moment it is saved. */
  it('starts every one of them switched off, reaching nobody', async () => {
    const { series } = build({ branches: [makeBranch({ id: 'br_1' })] });

    const created = await series.create(draft());

    assert.equal(created.isEnabled, false);
    assert.deepEqual(created.branchIds, []);
    assert.equal(created.enabledBranchCount, 0);
    assert.equal(created.branchCount, 1);
  });

  it('reports how many branches run it, out of how many could', async () => {
    const { series } = build({
      branches: [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_2', name: 'ONLINE' })],
    });
    const created = await series.create(draft());

    await series.setBranches(created.id, { branchIds: ['br_1'] }, EVERY_BRANCH);
    const after = await series.detail(created.id);

    assert.equal(after.enabledBranchCount, 1);
    assert.equal(after.branchCount, 2);
  });

  /** The series form owns this outright: what an admin chose must survive what the branches imply. */
  it('keeps a series off when the admin switched it off, whatever its kind implies', async () => {
    const { series, prisma } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft({ kind: TEST_SERIES_KIND.FREE }));
    assert.equal(created.isEnabled, true, 'a free series reaches past every branch');

    await series.update(created.id, { isEnabled: false });

    assert.equal(prisma.series[0]?.isEnabled, false);
  });

  it('switches a standard series on before any branch runs it', async () => {
    const { series, prisma } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());

    await series.update(created.id, { isEnabled: true });

    assert.equal(prisma.series[0]?.isEnabled, true);
    assert.deepEqual(prisma.series[0]?.branchIds, [], 'the switch is not a branch list');
  });

  /** The confirm is the only thing allowed to move it, so an unrelated save must not undo one. */
  it('leaves a switched-on series on when the next save is about something else', async () => {
    const { series, prisma } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());
    await series.update(created.id, { isEnabled: true });

    await series.update(created.id, { description: 'Six papers' });

    assert.equal(prisma.series[0]?.isEnabled, true, 'no branch runs it, and nobody asked it off');
  });

  it('leaves a switched-off series off when the next save is about something else', async () => {
    const { series, prisma } = build();
    const created = await series.create(draft({ kind: TEST_SERIES_KIND.FREE }));
    await series.update(created.id, { isEnabled: false });

    await series.update(created.id, { name: 'Free mocks, renamed' });

    assert.equal(
      prisma.series[0]?.isEnabled,
      false,
      'switching it off was confirmed; renaming was not',
    );
  });

  /** Two owners for one column is the defect. The switch stays put whichever way branches move. */
  it('keeps a series off when a branch is named beneath the switch', async () => {
    const { series, prisma } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());
    await series.update(created.id, { isEnabled: false });

    await series.setBranches(created.id, { branchIds: ['br_1'] }, EVERY_BRANCH);

    assert.deepEqual(prisma.series[0]?.branchIds, ['br_1'], 'the write still lands');
    assert.equal(prisma.series[0]?.isEnabled, false);
  });

  /** `isEnabled` sits OUTSIDE the reach OR, so one student's grant cannot publish a parked series. */
  it('leaves a switched-off free series off when a student is granted it', async () => {
    const { series, grants, prisma } = build({
      branches: [makeBranch({ id: 'br_1' })],
      students: [makeStudent({ id: 'stu_1', currentBranchId: 'br_1' })],
    });
    const created = await series.create(draft({ kind: TEST_SERIES_KIND.FREE }));
    await series.update(created.id, { isEnabled: false });

    await grants.grant('stu_1', { testSeriesId: created.id }, ADMIN, EVERY_BRANCH);

    assert.equal(prisma.series[0]?.isEnabled, false, 'switched on, a free series reaches everyone');
    assert.equal(
      prisma.grants.length,
      1,
      'the grant is still written — it opens once somebody does',
    );
  });

  it('leaves a standard series off when a grant is made where no branch runs it', async () => {
    const { series, grants, prisma } = build({
      branches: [makeBranch({ id: 'br_1' })],
      students: [makeStudent({ id: 'stu_1', currentBranchId: 'br_1' })],
    });
    const created = await series.create(draft());

    await grants.grant('stu_1', { testSeriesId: created.id }, ADMIN, EVERY_BRANCH);

    assert.equal(prisma.series[0]?.isEnabled, false);
  });

  /** Taking ONE student's grant back is not a decision about the series, so it moves no switch. */
  it('leaves the switch alone when a grant is revoked', async () => {
    const { series, grants, prisma } = build({
      branches: [makeBranch({ id: 'br_1' })],
      students: [makeStudent({ id: 'stu_1', currentBranchId: 'br_1' })],
    });
    const created = await series.create(draft());
    await series.update(created.id, { isEnabled: true });
    await grants.grant('stu_1', { testSeriesId: created.id }, ADMIN, EVERY_BRANCH);

    await grants.revoke('stu_1', created.id, EVERY_BRANCH);

    assert.equal(
      prisma.series[0]?.isEnabled,
      true,
      'the admin switched it on; a revoke is not that',
    );
    assert.deepEqual(prisma.series[0]?.branchIds, []);
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

  it('refuses to delete one that another series waits on', async () => {
    const { series } = build({
      series: [
        makeSeries({ id: 'srs_1' }),
        makeSeries({ id: 'srs_2', name: 'Tier 2', prerequisiteSeriesId: 'srs_1' }),
      ],
    });

    await assert.rejects(() => series.remove('srs_1'), AppException.is);
  });

  it('refuses to delete one still carrying a test', async () => {
    const { series, prisma } = build({
      series: [makeSeries({ id: 'srs_1' })],
      tests: [{ id: 'tst_1', testSeriesId: 'srs_1' }],
    });

    const error = await series.remove('srs_1').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(prisma.series.length, 1);
  });

  /** The failure this prevents: a test taken out of a series, and the series then undeletable. */
  it('deletes one a test was taken out of, rather than tripping its restrict key', async () => {
    const { series, prisma } = build({
      series: [makeSeries({ id: 'srs_1' })],
      tests: [{ id: 'tst_1', testSeriesId: null }],
    });

    await series.remove('srs_1');

    assert.equal(prisma.series.length, 0);
  });
});
/** The four CHECKs answered before Postgres has to, which can only refuse an ordinary save as a 500. */
describe('TestSeriesService — a kind and its columns say the same thing', () => {
  const PROGRAM = 'SSC CGL FOUNDATION';
  const withProgram = () => build({ programs: [makeProgram()] });

  it('creates a program series that names its program', async () => {
    const { series } = withProgram();

    const created = await series.create(
      draft({ kind: TEST_SERIES_KIND.PROGRAM, programCode: PROGRAM }),
    );

    assert.equal(created.kind, TEST_SERIES_KIND.PROGRAM);
    assert.equal(created.programCode, PROGRAM);
  });

  /** FREE is the one kind whose reach is the course, so it is the one kind that may span none. */
  it('creates a free series with no stage at all', async () => {
    const { series } = build();

    const created = await series.create(draft({ kind: TEST_SERIES_KIND.FREE, examStageId: null }));

    assert.equal(created.examStageId, null);
    assert.equal(created.kind, TEST_SERIES_KIND.FREE);
  });

  for (const [what, input, field] of [
    [
      'a program series naming no program',
      { kind: TEST_SERIES_KIND.PROGRAM, programCode: null },
      'programCode',
    ],
    [
      'a program on a series of some other kind',
      { kind: TEST_SERIES_KIND.STANDARD, programCode: PROGRAM },
      'kind',
    ],
    ['a series that is not free and has no stage', { examStageId: null }, 'examStageId'],
    ['an event series naming no event', { kind: TEST_SERIES_KIND.EVENT }, 'eventId'],
    [
      'an event on a series of some other kind',
      { kind: TEST_SERIES_KIND.STANDARD, eventId: 'ev_1' },
      'kind',
    ],
  ] as const) {
    it(`refuses ${what}, on the field that fixes it`, async () => {
      const { series } = withProgram();

      const error = await series.create(draft(input)).catch((e: unknown) => e);

      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
      assert.ok(error.fieldErrors?.[field], `expected the failure to name ${field}`);
    });
  }

  /** The only screen that creates a series creates all four kinds, so EVENT has to be settable. */
  it('creates an event series on the event it names', async () => {
    const { series } = build();

    const created = await series.create(draft({ kind: TEST_SERIES_KIND.EVENT, eventId: 'ev_1' }));

    assert.equal(created.kind, TEST_SERIES_KIND.EVENT);
    assert.equal(created.eventId, 'ev_1');
  });

  it('moves an event series onto another event', async () => {
    const { series } = build({
      series: [makeSeries({ id: 'srs_1', kind: TEST_SERIES_KIND.EVENT, eventId: 'ev_1' })],
    });

    const updated = await series.update('srs_1', { eventId: 'ev_2' });

    assert.equal(updated.eventId, 'ev_2');
  });

  it('refuses clearing the event a series is still an event series by', async () => {
    const { series } = build({
      series: [makeSeries({ id: 'srs_1', kind: TEST_SERIES_KIND.EVENT, eventId: 'ev_1' })],
    });

    const error = await series.update('srs_1', { eventId: null }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.eventId);
  });

  it('leaves an event series that already holds its event editable', async () => {
    const { series } = build({
      series: [makeSeries({ id: 'srs_1', kind: TEST_SERIES_KIND.EVENT, eventId: 'ev_1' })],
    });

    const updated = await series.update('srs_1', { name: 'Scholarship round two' });

    assert.equal(updated.name, 'Scholarship round two');
  });

  it('refuses taking an event series off its event by changing the kind', async () => {
    const { series } = build({
      series: [makeSeries({ id: 'srs_1', kind: TEST_SERIES_KIND.EVENT, eventId: 'ev_1' })],
    });

    const error = await series
      .update('srs_1', { kind: TEST_SERIES_KIND.STANDARD })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.kind);
  });

  /** Only STANDARD reaches branch by branch, and the message says how many would lose it. */
  it('refuses making a series that runs at branches free', async () => {
    const { series } = build({
      series: [makeSeries({ id: 'srs_1', branchIds: ['br_1', 'br_2'] })],
    });

    const error = await series
      .update('srs_1', { kind: TEST_SERIES_KIND.FREE })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.fieldErrors?.kind?.[0] ?? '', /2 branches/);
  });

  /** The count and the list are the same fact now, so clearing the list clears the refusal. */
  it('lets the kind change once the branches it named are cleared', async () => {
    const { series, prisma } = build({
      series: [makeSeries({ id: 'srs_1', branchIds: ['br_1', 'br_2'], isEnabled: true })],
      branches: [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_2', name: 'ONLINE' })],
    });

    await series.setBranches('srs_1', { branchIds: [] }, EVERY_BRANCH);
    assert.deepEqual(prisma.series[0]?.branchIds, []);

    const updated = await series.update('srs_1', { kind: TEST_SERIES_KIND.FREE });

    assert.equal(updated.kind, TEST_SERIES_KIND.FREE);
    // Emptying the branches is what clears the refusal; the switch is nobody's business but the form's.
    assert.equal(prisma.series[0]?.isEnabled, true);
  });

  it('leaves a standard series that runs at branches alone', async () => {
    const { series } = build({
      series: [makeSeries({ id: 'srs_1', branchIds: ['br_1', 'br_2'] })],
    });

    const updated = await series.update('srs_1', { name: 'Tier 1 mocks' });

    assert.equal(updated.name, 'Tier 1 mocks');
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
  /** A free series is switched on the instant it saves, so a cached catalog already omits it. */
  it('announces a series the moment it is created', async () => {
    const { series, events } = build({ branches: [makeBranch({ id: 'br_1' })] });

    const created = await series.create(draft({ kind: TEST_SERIES_KIND.FREE }));

    assert.equal(created.isEnabled, true);
    assert.deepEqual(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED), [
      { testSeriesId: created.id },
    ]);
  });

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

  it('announces the series when its branches move', async () => {
    const { series, events } = build({ branches: [makeBranch({ id: 'br_1' })] });
    const created = await series.create(draft());

    events.forget();

    await series.setBranches(created.id, { branchIds: ['br_1'] }, EVERY_BRANCH);

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

describe('TestSeriesService — a scoped admin only moves the branches they hold', () => {
  const held = { all: false, branchIds: ['br_1'] } as const;

  const twoBranches = (branchIds: string[] = []) =>
    build({
      series: [makeSeries({ id: 'srs_1', branchIds })],
      branches: [makeBranch({ id: 'br_1' }), makeBranch({ id: 'br_2', name: 'KUKATPALLY' })],
    });

  it('refuses to switch on a branch the admin does not hold', async () => {
    const { series } = twoBranches();

    const error = await series
      .setBranches('srs_1', { branchIds: ['br_2'] }, held)
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.NOT_FOUND);
  });

  it('shows only the branches the admin holds', async () => {
    const { series } = twoBranches();

    const rows = await series.branches('srs_1', held);

    assert.deepEqual(
      rows.map((row) => row.id),
      ['br_1'],
    );
  });

  /** A scoped write must not silently drop what somebody else already named. */
  it('leaves a branch outside the admin’s scope untouched', async () => {
    const { series, prisma } = twoBranches(['br_2']);

    await series.setBranches('srs_1', { branchIds: ['br_1'] }, held);

    assert.deepEqual([...(prisma.series[0]?.branchIds ?? [])].sort(), ['br_1', 'br_2']);
  });
});

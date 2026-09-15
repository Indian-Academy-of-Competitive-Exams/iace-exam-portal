import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { AppException, ErrorCodes, TEST_SERIES_KIND, type TestSeriesKind } from '@iace/contracts';
import { ProgramsService } from '../src/access/programs.service';
import { TestSeriesService } from '../src/access/test-series.service';
import { StudentGrantsService } from '../src/access/student-grants.service';
import { ExamStagesService } from '../src/configs';
import { AuditContext } from '../src/audit';
import { DOMAIN_EVENTS } from '../src/common/events';
import { NotificationOutbox } from '../src/notifications/notification-outbox';
import { FakeEventBus, FakeQueue } from '../test/support/fakes';
import {
  makeBranch,
  makeCatalog,
  makeStage,
  makeStudent,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const ADMIN = 'adm_1';
const PROGRAM = 'SSC CGL FOUNDATION';

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

/** The three access services over one stage, with the bus they announce on. */
async function build(stageActive = true) {
  const stageId = await makeStage(prisma, stageActive);
  const auditContext = new AuditContext();
  const events = new FakeEventBus();
  const programs = new ProgramsService(prisma, auditContext);
  return {
    stageId,
    events,
    programs,
    series: new TestSeriesService(
      prisma,
      new ExamStagesService(prisma, auditContext),
      programs,
      auditContext,
      events.asService(),
    ),
    grants: new StudentGrantsService(
      prisma,
      auditContext,
      events.asService(),
      new NotificationOutbox(new FakeQueue().asQueue()),
    ),
  };
}

const draft = (examStageId: string | null, over: Record<string, unknown> = {}) =>
  ({ name: 'SSC CGL Tier 1 mocks', examStageId, ...over }) as never;

interface SeriesSeed {
  examStageId: string;
  name?: string;
  kind?: TestSeriesKind;
  eventId?: string;
  programCode?: string;
  branchIds?: string[];
  isEnabled?: boolean;
}

const seedSeries = (seed: SeriesSeed) =>
  prisma.testSeries.create({
    data: { name: 'SSC CGL Tier 1 mocks', ...seed },
    select: { id: true },
  });

const seriesRow = (id: string) => prisma.testSeries.findUniqueOrThrow({ where: { id } });

const makeProgram = (isActive = true) =>
  prisma.program.create({
    data: { code: PROGRAM, name: 'SSC CGL Foundation', isActive },
    select: { id: true },
  });

const makeEvent = () =>
  prisma.event.create({ data: { name: uid('Scholarship') }, select: { id: true } });

describe('TestSeriesService — branches are the truth about branches', () => {
  /** `branchIds` is what the resolver reads, so this write is the only thing that opens the door. */
  it('reaches a student at a branch the series names', async () => {
    const { series, stageId } = await build();
    const branch = await makeBranch(prisma);
    const created = await series.create(draft(stageId));

    await series.setBranches(created.id, { branchIds: [branch.id] });

    assert.deepEqual((await seriesRow(created.id)).branchIds, [branch.id]);
  });

  it('stops reaching them when the branch is removed', async () => {
    const { series, stageId } = await build();
    const branch = await makeBranch(prisma);
    const created = await series.create(draft(stageId));
    await series.setBranches(created.id, { branchIds: [branch.id] });

    await series.setBranches(created.id, { branchIds: [] });

    assert.deepEqual((await seriesRow(created.id)).branchIds, []);
  });

  /** `isEnabled` has ONE owner, and the branch writer is not it — it always passes nothing. */
  it('leaves the switch alone when branches change', async () => {
    const { series, stageId } = await build();
    const branch = await makeBranch(prisma);
    const created = await series.create(draft(stageId));
    await series.update(created.id, { isEnabled: true });

    await series.setBranches(created.id, { branchIds: [branch.id] });

    assert.equal((await seriesRow(created.id)).isEnabled, true, 'the branch writer passes nothing');
  });

  /** Answered here so the form marks the field: the CHECK behind it can only leave as a 500. */
  it('refuses branches on a series that is not STANDARD', async () => {
    const { series, stageId } = await build();
    const branch = await makeBranch(prisma);
    const free = await seedSeries({ examStageId: stageId, kind: TEST_SERIES_KIND.FREE });

    const error = await series
      .setBranches(free.id, { branchIds: [branch.id] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.kind);
  });

  it('tells the catalog when the list changes', async () => {
    const { series, events, stageId } = await build();
    const branch = await makeBranch(prisma);
    const created = await series.create(draft(stageId));
    events.forget();

    await series.setBranches(created.id, { branchIds: [branch.id] });

    assert.deepEqual(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED), [
      { testSeriesId: created.id },
    ]);
  });

  /** Nothing in the array may name a branch that is not really there — it carries no FK. */
  it('refuses a branch that does not exist', async () => {
    const { series, stageId } = await build();
    await makeBranch(prisma);
    const created = await series.create(draft(stageId));

    const error = await series
      .setBranches(created.id, { branchIds: [uid('branch')] })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.branchIds);
  });

  /** Only this series: a write is per series, and every other one keeps the state it had. */
  it('leaves another series alone', async () => {
    const { series, stageId } = await build();
    const branch = await makeBranch(prisma, 'AMEERPET');
    const mine = await series.create(draft(stageId));
    const other = await series.create(draft(stageId, { name: 'RRB JE Tier 1 mocks' }));

    await series.setBranches(mine.id, { branchIds: [branch.id] });

    assert.deepEqual((await seriesRow(other.id)).branchIds, []);
  });

  /** A new series must not appear at every centre in the country the moment it is saved. */
  it('starts every one of them switched off, reaching nobody', async () => {
    const { series, stageId } = await build();
    await makeBranch(prisma);

    const created = await series.create(draft(stageId));

    assert.equal(created.isEnabled, false);
    assert.deepEqual(created.branchIds, []);
    assert.equal(created.enabledBranchCount, 0);
    assert.equal(created.branchCount, 1);
  });

  it('reports how many branches run it, out of how many could', async () => {
    const { series, stageId } = await build();
    const runs = await makeBranch(prisma);
    await makeBranch(prisma, 'ONLINE');
    const created = await series.create(draft(stageId));

    await series.setBranches(created.id, { branchIds: [runs.id] });
    const detail = await series.detail(created.id);

    assert.equal(detail.enabledBranchCount, 1);
    assert.equal(detail.branchCount, 2);
  });

  /** The series form owns this outright: what an admin chose must survive what the branches imply. */
  it('keeps a series off when the admin switched it off, whatever its kind implies', async () => {
    const { series, stageId } = await build();
    await makeBranch(prisma);
    const created = await series.create(draft(stageId, { kind: TEST_SERIES_KIND.FREE }));
    assert.equal(created.isEnabled, true, 'a free series reaches past every branch');

    await series.update(created.id, { isEnabled: false });

    assert.equal((await seriesRow(created.id)).isEnabled, false);
  });

  it('switches a standard series on before any branch runs it', async () => {
    const { series, stageId } = await build();
    await makeBranch(prisma);
    const created = await series.create(draft(stageId));

    await series.update(created.id, { isEnabled: true });

    const row = await seriesRow(created.id);
    assert.equal(row.isEnabled, true);
    assert.deepEqual(row.branchIds, [], 'the switch is not a branch list');
  });

  /** The confirm is the only thing allowed to move it, so an unrelated save must not undo one. */
  it('leaves a switched-on series on when the next save is about something else', async () => {
    const { series, stageId } = await build();
    await makeBranch(prisma);
    const created = await series.create(draft(stageId));
    await series.update(created.id, { isEnabled: true });

    await series.update(created.id, { name: 'Six papers' });

    assert.equal(
      (await seriesRow(created.id)).isEnabled,
      true,
      'no branch runs it, and nobody asked it off',
    );
  });

  it('leaves a switched-off series off when the next save is about something else', async () => {
    const { series, stageId } = await build();
    const created = await series.create(draft(stageId, { kind: TEST_SERIES_KIND.FREE }));
    await series.update(created.id, { isEnabled: false });

    await series.update(created.id, { name: 'Free mocks, renamed' });

    assert.equal(
      (await seriesRow(created.id)).isEnabled,
      false,
      'switching it off was confirmed; renaming was not',
    );
  });

  /** Two owners for one column is the defect. The switch stays put whichever way branches move. */
  it('keeps a series off when a branch is named beneath the switch', async () => {
    const { series, stageId } = await build();
    const branch = await makeBranch(prisma);
    const created = await series.create(draft(stageId));
    await series.update(created.id, { isEnabled: false });

    await series.setBranches(created.id, { branchIds: [branch.id] });

    const row = await seriesRow(created.id);
    assert.deepEqual(row.branchIds, [branch.id], 'the write still lands');
    assert.equal(row.isEnabled, false);
  });

  /** `isEnabled` sits OUTSIDE the reach OR, so one student's grant cannot publish a parked series. */
  it('leaves a switched-off free series off when a student is granted it', async () => {
    const { series, grants, stageId } = await build();
    const branch = await makeBranch(prisma);
    const student = await makeStudent(prisma, { currentBranchId: branch.id });
    const created = await series.create(draft(stageId, { kind: TEST_SERIES_KIND.FREE }));
    await series.update(created.id, { isEnabled: false });

    await grants.grant(student.id, { testSeriesId: created.id }, ADMIN);

    assert.equal(
      (await seriesRow(created.id)).isEnabled,
      false,
      'switched on, a free series reaches everyone',
    );
    assert.equal(
      await prisma.studentGrant.count(),
      1,
      'the grant is still written — it opens once somebody does',
    );
  });

  it('leaves a standard series off when a grant is made where no branch runs it', async () => {
    const { series, grants, stageId } = await build();
    const branch = await makeBranch(prisma);
    const student = await makeStudent(prisma, { currentBranchId: branch.id });
    const created = await series.create(draft(stageId));

    await grants.grant(student.id, { testSeriesId: created.id }, ADMIN);

    assert.equal((await seriesRow(created.id)).isEnabled, false);
  });

  /** Taking ONE student's grant back is not a decision about the series, so it moves no switch. */
  it('leaves the switch alone when a grant is revoked', async () => {
    const { series, grants, stageId } = await build();
    const branch = await makeBranch(prisma);
    const student = await makeStudent(prisma, { currentBranchId: branch.id });
    const created = await series.create(draft(stageId));
    await series.update(created.id, { isEnabled: true });
    await grants.grant(student.id, { testSeriesId: created.id }, ADMIN);

    await grants.revoke(student.id, created.id);

    const row = await seriesRow(created.id);
    assert.equal(row.isEnabled, true, 'the admin switched it on; a revoke is not that');
    assert.deepEqual(row.branchIds, []);
  });
});

describe('TestSeriesService — a name belongs to one series', () => {
  /** The failure this prevents: two rows reading "SSC CGL Tier 1 mocks" in every picker that lists them. */
  it('refuses a second series with a name already taken, whatever its case', async () => {
    const { series, stageId } = await build();
    await series.create(draft(stageId));

    const error = await series
      .create(draft(stageId, { name: 'ssc cgl TIER 1 MOCKS' }))
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.ok(error.fieldErrors?.name);
  });

  it('lets a series keep its own name through an edit that changes something else', async () => {
    const { series, stageId } = await build();
    const created = await series.create(draft(stageId));

    const updated = await series.update(created.id, { name: created.name, isEnabled: true });

    assert.equal(updated.name, created.name);
  });

  it('refuses a rename onto another series', async () => {
    const { series, stageId } = await build();
    await series.create(draft(stageId, { name: 'Foundation mocks' }));
    const second = await series.create(draft(stageId, { name: 'Sectional mocks' }));

    const error = await series
      .update(second.id, { name: 'foundation mocks' })
      .catch((e: unknown) => e);

    assert.equal(AppException.is(error) ? error.code : null, ErrorCodes.CONFLICT);
  });
});

describe('TestSeriesService — what a series may point at', () => {
  it('refuses a stage that is retired', async () => {
    const { series, stageId } = await build(false);

    await assert.rejects(() => series.create(draft(stageId)), AppException.is);
  });

  it('refuses a program code the catalog does not hold', async () => {
    const { series, stageId } = await build();

    await assert.rejects(
      () => series.create(draft(stageId, { programCode: 'NOPE' })),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.programCode);
        return true;
      },
    );
  });

  it('refuses to delete one still carrying a test', async () => {
    const { series } = await build();
    const catalog = await makeCatalog(prisma);
    await makeTest(prisma, catalog);

    const error = await series.remove(catalog.testSeriesId).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.equal(error.code, ErrorCodes.CONFLICT);
    assert.equal(await prisma.testSeries.count({ where: { id: catalog.testSeriesId } }), 1);
  });

  it('deletes one that carries no test, so the refusal is the count and not the table', async () => {
    const { series, stageId } = await build();
    const empty = await seedSeries({ examStageId: stageId });

    await series.remove(empty.id);

    assert.equal(await prisma.testSeries.count(), 0);
  });
});

/** The four CHECKs answered before Postgres has to, which can only refuse an ordinary save as a 500. */
describe('TestSeriesService — a kind and its columns say the same thing', () => {
  it('creates a program series that names its program', async () => {
    const { series, stageId } = await build();
    await makeProgram();

    const created = await series.create(
      draft(stageId, { kind: TEST_SERIES_KIND.PROGRAM, programCode: PROGRAM }),
    );

    assert.equal(created.kind, TEST_SERIES_KIND.PROGRAM);
    assert.equal(created.programCode, PROGRAM);
  });

  /** FREE is the one kind whose reach is the course, so it is the one kind that may span none. */
  it('creates a free series with no stage at all', async () => {
    const { series } = await build();

    const created = await series.create(draft(null, { kind: TEST_SERIES_KIND.FREE }));

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
      const { series, stageId } = await build();
      await makeProgram();

      const error = await series.create(draft(stageId, input)).catch((e: unknown) => e);

      assert.ok(AppException.is(error));
      assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
      assert.ok(error.fieldErrors?.[field], `expected the failure to name ${field}`);
    });
  }

  /** The only screen that creates a series creates all four kinds, so EVENT has to be settable. */
  it('creates an event series on the event it names', async () => {
    const { series, stageId } = await build();
    const event = await makeEvent();

    const created = await series.create(
      draft(stageId, { kind: TEST_SERIES_KIND.EVENT, eventId: event.id }),
    );

    assert.equal(created.kind, TEST_SERIES_KIND.EVENT);
    assert.equal(created.eventId, event.id);
  });

  it('moves an event series onto another event', async () => {
    const { series, stageId } = await build();
    const [first, second] = [await makeEvent(), await makeEvent()];
    const held = await seedSeries({
      examStageId: stageId,
      kind: TEST_SERIES_KIND.EVENT,
      eventId: first.id,
    });

    const updated = await series.update(held.id, { eventId: second.id });

    assert.equal(updated.eventId, second.id);
  });

  it('refuses clearing the event a series is still an event series by', async () => {
    const { series, stageId } = await build();
    const event = await makeEvent();
    const held = await seedSeries({
      examStageId: stageId,
      kind: TEST_SERIES_KIND.EVENT,
      eventId: event.id,
    });

    const error = await series.update(held.id, { eventId: null }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.eventId);
  });

  it('leaves an event series that already holds its event editable', async () => {
    const { series, stageId } = await build();
    const event = await makeEvent();
    const held = await seedSeries({
      examStageId: stageId,
      kind: TEST_SERIES_KIND.EVENT,
      eventId: event.id,
    });

    const updated = await series.update(held.id, { name: 'Scholarship round two' });

    assert.equal(updated.name, 'Scholarship round two');
  });

  it('refuses taking an event series off its event by changing the kind', async () => {
    const { series, stageId } = await build();
    const event = await makeEvent();
    const held = await seedSeries({
      examStageId: stageId,
      kind: TEST_SERIES_KIND.EVENT,
      eventId: event.id,
    });

    const error = await series
      .update(held.id, { kind: TEST_SERIES_KIND.STANDARD })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.kind);
  });

  /** Only STANDARD reaches branch by branch, and the message says how many would lose it. */
  it('refuses making a series that runs at branches free', async () => {
    const { series, stageId } = await build();
    const [first, second] = [await makeBranch(prisma), await makeBranch(prisma)];
    const held = await seedSeries({ examStageId: stageId, branchIds: [first.id, second.id] });

    const error = await series
      .update(held.id, { kind: TEST_SERIES_KIND.FREE })
      .catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.fieldErrors?.kind?.[0] ?? '', /2 branches/);
  });

  /** The count and the list are the same fact now, so clearing the list clears the refusal. */
  it('lets the kind change once the branches it named are cleared', async () => {
    const { series, stageId } = await build();
    const [first, second] = [await makeBranch(prisma), await makeBranch(prisma, 'ONLINE')];
    const held = await seedSeries({
      examStageId: stageId,
      branchIds: [first.id, second.id],
      isEnabled: true,
    });

    await series.setBranches(held.id, { branchIds: [] });
    assert.deepEqual((await seriesRow(held.id)).branchIds, []);

    const updated = await series.update(held.id, { kind: TEST_SERIES_KIND.FREE });

    assert.equal(updated.kind, TEST_SERIES_KIND.FREE);
    // Emptying the branches is what clears the refusal; the switch is nobody's business but the form's.
    assert.equal((await seriesRow(held.id)).isEnabled, true);
  });

  it('leaves a standard series that runs at branches alone', async () => {
    const { series, stageId } = await build();
    const [first, second] = [await makeBranch(prisma), await makeBranch(prisma)];
    const held = await seedSeries({ examStageId: stageId, branchIds: [first.id, second.id] });

    const updated = await series.update(held.id, { name: 'Tier 1 mocks' });

    assert.equal(updated.name, 'Tier 1 mocks');
  });
});

describe('ProgramsService', () => {
  it('creates a program and normalises its code', async () => {
    const { programs } = await build();

    const created = await programs.create({ code: PROGRAM, name: 'Foundation' });

    assert.equal(created.code, PROGRAM);
  });

  it('refuses a code the catalog already holds', async () => {
    const { programs } = await build();
    await makeProgram();

    await assert.rejects(
      () => programs.create({ code: PROGRAM, name: 'Again' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.equal(error.code, ErrorCodes.CONFLICT);
        return true;
      },
    );
  });

  /** Both hold the code as free text with no FK, so a rename would detach every one of them silently. */
  it('refuses a code change once a student carries it', async () => {
    const { programs } = await build();
    const program = await makeProgram();
    await makeStudent(prisma, { programs: [PROGRAM] });

    await assert.rejects(
      () => programs.update(program.id, { code: 'SSC CGL FOUNDATION 2026' }),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.code);
        return true;
      },
    );
    const row = await prisma.program.findUniqueOrThrow({ where: { id: program.id } });
    assert.equal(row.code, PROGRAM);
  });

  it('refuses a code change once a series carries it, and offers retiring instead', async () => {
    const { programs, stageId } = await build();
    const program = await makeProgram();
    await seedSeries({
      examStageId: stageId,
      kind: TEST_SERIES_KIND.PROGRAM,
      programCode: PROGRAM,
    });

    const error = await programs.update(program.id, { code: 'RENAMED' }).catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.match(error.message, /[Rr]etire/);
  });

  it('renames and retires without touching the code', async () => {
    const { programs } = await build();
    const program = await makeProgram();
    await makeStudent(prisma, { programs: [PROGRAM] });

    const updated = await programs.update(program.id, { name: 'Foundation 2026', isActive: false });

    assert.equal(updated.name, 'Foundation 2026');
    assert.equal(updated.isActive, false);
  });

  it('refuses an inactive program where a student is being enrolled', async () => {
    const { programs } = await build();
    await makeProgram(false);

    const error = await programs.assertUsable([PROGRAM], 'programs').catch((e: unknown) => e);

    assert.ok(AppException.is(error));
    assert.ok(error.fieldErrors?.programs);
  });
});

describe('StudentGrantsService — the escape hatch', () => {
  it('grants a series to one student and reads it back named', async () => {
    const { grants, stageId } = await build();
    const held = await seedSeries({ examStageId: stageId, name: 'Scholarship mocks' });
    const student = await makeStudent(prisma);

    const granted = await grants.grant(student.id, { testSeriesId: held.id }, ADMIN);

    assert.equal(granted.length, 1);
    assert.equal(granted[0]?.testSeries.name, 'Scholarship mocks');
  });

  /** Re-reading the roster it came from is the normal way to use this. */
  it('is idempotent — granting twice leaves one grant', async () => {
    const { grants, stageId } = await build();
    const held = await seedSeries({ examStageId: stageId });
    const student = await makeStudent(prisma);

    await grants.grant(student.id, { testSeriesId: held.id }, ADMIN);
    await grants.grant(student.id, { testSeriesId: held.id }, ADMIN);

    assert.equal(await prisma.studentGrant.count(), 1);
  });

  it('refuses a grant to a student who is blocked from tests', async () => {
    const { grants, stageId } = await build();
    const held = await seedSeries({ examStageId: stageId });
    const student = await makeStudent(prisma, { isTestBlocked: true });

    await assert.rejects(
      () => grants.grant(student.id, { testSeriesId: held.id }, ADMIN),
      (error: unknown) => {
        assert.ok(AppException.is(error));
        assert.ok(error.fieldErrors?.testSeriesId);
        return true;
      },
    );
  });

  it('refuses a series that is not there', async () => {
    const { grants } = await build();
    const student = await makeStudent(prisma);

    await assert.rejects(
      () => grants.grant(student.id, { testSeriesId: uid('series') }, ADMIN),
      AppException.is,
    );
  });

  it('takes one back', async () => {
    const { grants, stageId } = await build();
    const held = await seedSeries({ examStageId: stageId });
    const student = await makeStudent(prisma);
    await grants.grant(student.id, { testSeriesId: held.id }, ADMIN);

    await grants.revoke(student.id, held.id);

    assert.equal(await prisma.studentGrant.count(), 0);
  });
});

/** The cached catalog is only ever right because these fire; a silent access write leaves it stale. */
describe('the access writes that bust the catalog cache', () => {
  /** A free series is switched on the instant it saves, so a cached catalog already omits it. */
  it('announces a series the moment it is created', async () => {
    const { series, events, stageId } = await build();
    await makeBranch(prisma);

    const created = await series.create(draft(stageId, { kind: TEST_SERIES_KIND.FREE }));

    assert.equal(created.isEnabled, true);
    assert.deepEqual(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED), [
      { testSeriesId: created.id },
    ]);
  });

  it('announces the student on a grant and again on a revoke', async () => {
    const { grants, events, stageId } = await build();
    const held = await seedSeries({ examStageId: stageId });
    const student = await makeStudent(prisma);

    await grants.grant(student.id, { testSeriesId: held.id }, ADMIN);
    await grants.revoke(student.id, held.id);

    assert.deepEqual(events.of(DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED), [
      { studentId: student.id },
      { studentId: student.id },
    ]);
  });

  it('announces the series when its branches move', async () => {
    const { series, events, stageId } = await build();
    const branch = await makeBranch(prisma);
    const created = await series.create(draft(stageId));
    events.forget();

    await series.setBranches(created.id, { branchIds: [branch.id] });

    assert.deepEqual(events.of(DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED), [
      { testSeriesId: created.id },
    ]);
  });
});

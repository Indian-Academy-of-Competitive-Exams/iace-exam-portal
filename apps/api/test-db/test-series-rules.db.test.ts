import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import {
  AppException,
  ErrorCodes,
  TEST_SERIES_KIND,
  testSeriesListQuerySchema,
} from '@iace/contracts';
import { AccessResolverService } from '../src/access/access-resolver.service';
import { ProgramsService } from '../src/access/programs.service';
import { TestSeriesService } from '../src/access/test-series.service';
import { AuditContext } from '../src/audit';
import { ExamStagesService } from '../src/configs';
import { FakeEventBus, FakeRedis } from '../test/support/fakes';
import {
  makeBranch,
  makeCatalog,
  makeStage,
  makeTest,
  resetDatabase,
  testPrisma,
  uid,
} from './support/database';

const PROGRAM = 'SSC CGL FOUNDATION';
const FIRST_OPENING = new Date('2026-09-01T04:30:00.000Z');
const SECOND_OPENING = new Date('2026-09-02T04:30:00.000Z');

const prisma = testPrisma();

beforeEach(() => resetDatabase(prisma));
after(() => prisma.$disconnect());

function build() {
  const auditContext = new AuditContext();
  const events = new FakeEventBus().asService();
  const series = new TestSeriesService(
    prisma,
    new ExamStagesService(prisma, auditContext, events),
    new ProgramsService(prisma, auditContext),
    new AccessResolverService(prisma, new FakeRedis().asService()),
    auditContext,
    events,
  );
  return { series, auditContext };
}

const draft = (examStageId: string | null, over: Record<string, unknown> = {}) =>
  ({ name: 'SSC CGL Tier 1 mocks', examStageId, ...over }) as never;

const seriesRow = (id: string) => prisma.testSeries.findUniqueOrThrow({ where: { id } });

const refused = async (attempt: Promise<unknown>) => {
  const error = await attempt.catch((caught: unknown) => caught);
  assert.ok(AppException.is(error));
  return error;
};

describe('TestSeriesService — a target is judged when it is chosen', () => {
  /** The failure this prevents: a deleted event answered by the foreign key, and a retired one accepted. */
  it('refuses an event series on an event that is gone or retired, under Event', async () => {
    const { series } = build();
    const stageId = await makeStage(prisma);
    const retired = await prisma.event.create({ data: { name: uid(), isActive: false } });

    for (const eventId of [uid(), retired.id]) {
      const error = await refused(
        series.create(draft(stageId, { kind: TEST_SERIES_KIND.EVENT, eventId })),
      );

      assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
      assert.ok(error.fieldErrors?.eventId);
    }
    assert.equal(await prisma.testSeries.count(), 0);
  });

  /** The form sends every field with each save, so a target retired since must not block an unrelated edit. */
  it('renames a series whose stage was retired after it was chosen', async () => {
    const { series } = build();
    const stageId = await makeStage(prisma);
    const created = await series.create(draft(stageId));
    await prisma.examStage.update({ where: { id: stageId }, data: { isActive: false } });

    const updated = await series.update(created.id, {
      name: 'Tier 1 mocks',
      examStageId: stageId,
    });

    assert.equal(updated.name, 'Tier 1 mocks');
  });

  it('opens the tests in order on a series whose program was retired after it was chosen', async () => {
    const { series } = build();
    const stageId = await makeStage(prisma);
    await prisma.program.create({ data: { code: PROGRAM, name: 'SSC CGL Foundation' } });
    const created = await series.create(
      draft(stageId, { kind: TEST_SERIES_KIND.PROGRAM, programCode: PROGRAM }),
    );
    await prisma.program.update({ where: { code: PROGRAM }, data: { isActive: false } });

    const updated = await series.update(created.id, {
      programCode: PROGRAM,
      sequentialTests: true,
    });

    assert.equal(updated.sequentialTests, true);
  });

  it('still refuses moving a series onto a stage that is retired', async () => {
    const { series } = build();
    const created = await series.create(draft(await makeStage(prisma)));
    const retired = await makeStage(prisma, false);

    const error = await refused(series.update(created.id, { examStageId: retired }));

    assert.ok(error.fieldErrors?.examStageId);
  });
});

describe('TestSeriesService — a series carries only tests built for its stage', () => {
  /** The failure this prevents: a test left in a series built for another stage, which create and move both refuse. */
  it('refuses moving the stage away from the tests it holds, under Stage', async () => {
    const { series } = build();
    const catalog = await makeCatalog(prisma);
    await makeTest(prisma, catalog);
    const elsewhere = await makeStage(prisma);

    const error = await refused(series.update(catalog.testSeriesId, { examStageId: elsewhere }));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    assert.ok(error.fieldErrors?.examStageId);
    assert.equal((await seriesRow(catalog.testSeriesId)).examStageId, catalog.examStageId);
  });

  it('moves the stage of a series that holds no test', async () => {
    const { series } = build();
    const catalog = await makeCatalog(prisma);
    const elsewhere = await makeStage(prisma);

    const updated = await series.update(catalog.testSeriesId, { examStageId: elsewhere });

    assert.equal(updated.examStageId, elsewhere);
  });
});

describe('TestSeriesService — opening the tests in order', () => {
  const inOrder = (id: string) => build().series.update(id, { sequentialTests: true });

  /** The failure this prevents: a later test already open while it waits behind one that opens next week. */
  it('refuses the switch while a test opens no later than one before it, naming both', async () => {
    const catalog = await makeCatalog(prisma);
    await makeTest(prisma, catalog, { title: 'Mock 1', seriesOrder: 1, opensAt: SECOND_OPENING });
    await makeTest(prisma, catalog, { title: 'Mock 2', seriesOrder: 2, opensAt: FIRST_OPENING });

    const error = await refused(inOrder(catalog.testSeriesId));

    assert.equal(error.code, ErrorCodes.VALIDATION_ERROR);
    const [issue] = error.fieldErrors?.sequentialTests ?? [];
    assert.match(issue ?? '', /Mock 1/);
    assert.match(issue ?? '', /Mock 2/);
    assert.equal((await seriesRow(catalog.testSeriesId)).sequentialTests, false);
  });

  it('switches on where the openings ascend, a test with no opening aside', async () => {
    const catalog = await makeCatalog(prisma);
    await makeTest(prisma, catalog, { title: 'Mock 1', seriesOrder: 1, opensAt: FIRST_OPENING });
    await makeTest(prisma, catalog, { title: 'Mock 2', seriesOrder: 2 });
    await makeTest(prisma, catalog, { title: 'Mock 3', seriesOrder: 3, opensAt: SECOND_OPENING });

    const updated = await inOrder(catalog.testSeriesId);

    assert.equal(updated.sequentialTests, true);
  });
});

describe('TestSeriesService — the whole branch list at once', () => {
  /** The single toggle logs the list before and after; the whole-list save was a bare "Updated". */
  it('logs the list before and after', async () => {
    const { series, auditContext } = build();
    const [kept, added] = [await makeBranch(prisma), await makeBranch(prisma)];
    const created = await series.create(draft(await makeStage(prisma)));
    await series.setBranches(created.id, { branchIds: [kept.id] });

    const logged = await auditContext.run(async () => {
      await series.setBranches(created.id, { branchIds: [kept.id, added.id] });
      return auditContext.current();
    });

    assert.deepEqual(logged?.changed, {
      branchIds: { from: [kept.id], to: [kept.id, added.id] },
    });
  });
});

/** `branchIds` carries no foreign key, so a deleted branch stays on the list until the series is next written. */
describe('TestSeriesService — a branch deleted from under a series', () => {
  it('counts and lists only the branches that are still there', async () => {
    const { series } = build();
    const [kept, gone] = [await makeBranch(prisma), await makeBranch(prisma)];
    const created = await series.create(draft(await makeStage(prisma)));
    await series.setBranches(created.id, { branchIds: [kept.id, gone.id] });
    await prisma.branch.delete({ where: { id: gone.id } });

    const detail = await series.detail(created.id);
    const [listed] = (await series.list(testSeriesListQuerySchema.parse({}))).items;

    assert.deepEqual(
      [detail.enabledBranchCount, detail.branchCount, detail.branchIds],
      [1, 1, [kept.id]],
    );
    assert.equal(listed?.enabledBranchCount, 1);
  });

  /** The failure this prevents: a kind change refused for "1 branch" that no longer exists. */
  it('lets the kind change once no live branch is left on the list, and clears it', async () => {
    const { series } = build();
    const gone = await makeBranch(prisma);
    const created = await series.create(draft(await makeStage(prisma)));
    await series.setBranches(created.id, { branchIds: [gone.id] });
    await prisma.branch.delete({ where: { id: gone.id } });

    const updated = await series.update(created.id, { kind: TEST_SERIES_KIND.FREE });

    assert.equal(updated.kind, TEST_SERIES_KIND.FREE);
    assert.deepEqual((await seriesRow(created.id)).branchIds, []);
  });
});

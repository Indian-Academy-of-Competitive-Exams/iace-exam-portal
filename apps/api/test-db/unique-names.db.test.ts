import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { isUniqueViolation } from '../src/common/prisma-errors';
import { makeCatalog, makeTest, testPrisma, uid } from './support/database';

const prisma = testPrisma();

after(() => prisma.$disconnect());

const refusal = (error: unknown): string => (error instanceof Error ? error.message : '');

describe('a series name is taken once, across the platform', () => {
  it('refuses a second series of the same name, whatever its case', async () => {
    const name = uid();
    const { examStageId } = await makeCatalog(prisma);
    await prisma.testSeries.create({ data: { id: uid(), name, examStageId } });

    const error = await prisma.testSeries
      .create({ data: { id: uid(), name: name.toUpperCase(), examStageId } })
      .catch((e: unknown) => e);

    assert.ok(isUniqueViolation(error));
    assert.match(refusal(error), /lower\(name\)/);
  });
});

describe('a test name is taken once inside its series', () => {
  it('refuses a second test of the same name in one series, whatever its case', async () => {
    const catalog = await makeCatalog(prisma);
    const title = uid();
    await makeTest(prisma, catalog, { title });

    const error = await makeTest(prisma, catalog, { title: title.toUpperCase() }).catch(
      (e: unknown) => e,
    );

    assert.ok(isUniqueViolation(error));
    assert.match(refusal(error), /testSeriesId.*lower\(title\)/s);
  });

  /** Unique WITHIN a series: every series runs its own Mock 1, and they are different papers. */
  it('lets another series hold a test of the same name', async () => {
    const title = uid();
    const here = await makeCatalog(prisma);
    const elsewhere = await makeCatalog(prisma);
    await makeTest(prisma, here, { title });

    const twin = await makeTest(prisma, elsewhere, { title });

    assert.ok(twin.id);
  });

  /** A draft nobody has named yet is not a duplicate of the last one: NULLs are distinct. */
  it('lets a series hold as many unnamed drafts as it likes', async () => {
    const catalog = await makeCatalog(prisma);
    await prisma.test.create({
      data: {
        id: uid(),
        title: null,
        baseConfigId: catalog.baseConfigId,
        examStageId: catalog.examStageId,
        testSeriesId: catalog.testSeriesId,
      },
    });

    const second = await prisma.test.create({
      data: {
        id: uid(),
        title: null,
        baseConfigId: catalog.baseConfigId,
        examStageId: catalog.examStageId,
        testSeriesId: catalog.testSeriesId,
      },
      select: { id: true },
    });

    assert.ok(second.id);
  });
});

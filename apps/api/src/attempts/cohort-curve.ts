/** The cohort's distribution, counted off the sittings themselves: `TestStat` does not store it. */
import { type Prisma } from '@prisma/client';
import { cohortShapeOf, type CohortShape } from './performance-analytics';
import { cohortSittingsOf } from './rollup-fold';

export async function cohortCurveOf(
  client: Pick<Prisma.TransactionClient, 'attempt'>,
  testId: string,
): Promise<CohortShape> {
  const grouped = await client.attempt.groupBy({
    by: ['score'],
    where: { ...cohortSittingsOf(testId), score: { not: null } },
    _count: true,
  });
  return cohortShapeOf(
    grouped.flatMap((row) =>
      row.score === null ? [] : [{ score: Number(row.score), count: row._count }],
    ),
  );
}

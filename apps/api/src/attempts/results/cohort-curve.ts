/** The cohort's distribution, counted off the sittings themselves: `TestStat` does not store it. */
import { type Prisma } from '@prisma/client';
import { cohortShapeOf, type CohortShape } from './performance-analytics';
import { IN_COHORT } from './ranking-sql';

/** Raw, so the cohort filter stays literal and the count is read off `Attempt_ranking_idx` alone (docs/03 §9). */
export async function cohortCurveOf(
  client: Pick<Prisma.TransactionClient, '$queryRaw'>,
  testId: string,
): Promise<CohortShape> {
  const counted = await client.$queryRaw<{ score: number; count: number }[]>`
    SELECT "score"::float8 AS score, COUNT(*)::int AS count
    FROM "Attempt"
    WHERE "testId" = ${testId}::uuid AND ${IN_COHORT}
    GROUP BY "score"`;
  return cohortShapeOf(counted);
}

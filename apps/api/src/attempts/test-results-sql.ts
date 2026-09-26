/**
 * Every sitting of one test with its standing, for the report an admin downloads. One window pass
 * over the same cohort, order and `sitting_percentile` as `standingsSql`; the parity test holds the
 * two together. A sitting outside the cohort comes back with a NULL rank and percentile.
 */
import { Prisma } from '@prisma/client';

export interface TestResultRow {
  attempt_id: string;
  rank: number | null;
  percentile: number | null;
}

/** Ranked first in rank order, then the unranked; ASC keeps NULLS LAST, the slowest a time can be. */
export function testResultsSql(testId: string): Prisma.Sql {
  return Prisma.sql`
    WITH ranked AS (
      SELECT a."id",
             (ROW_NUMBER() OVER (ORDER BY a."score" DESC, a."timeTakenSec" ASC NULLS LAST, a."id" ASC))::int AS rank,
             sitting_percentile(
               RANK() OVER (ORDER BY a."score" ASC) - 1,
               COUNT(*) OVER (PARTITION BY a."score"),
               COUNT(*) OVER ()
             )::float8 AS percentile
      FROM "Attempt" a
      WHERE a."testId" = ${testId}::uuid
        AND a."isGraded" AND a."status" = 'EVALUATED' AND a."score" IS NOT NULL
    )
    SELECT a."id" AS attempt_id, r.rank, r.percentile
    FROM "Attempt" a
    LEFT JOIN ranked r ON r."id" = a."id"
    WHERE a."testId" = ${testId}::uuid
    ORDER BY r.rank ASC NULLS LAST, a."id" ASC
  `;
}

/**
 * Every ranking query, counted live from Postgres. A test's cohort is its graded, evaluated, scored
 * sittings, ordered by marks, then time taken, then id; `sitting_percentile` owns the percentile.
 * The cohort filter stays literal SQL so the planner can match `Attempt_ranking_idx`, and a sitting
 * with no recorded time ranks as the slowest there is.
 */
import { LEADERBOARD_NEIGHBOURS, LEADERBOARD_PODIUM } from '@iace/contracts';
import { Prisma } from '@prisma/client';

/** Unqualified, so it binds to the nearest `Attempt` in scope — the inner one inside the LATERAL. */
export const IN_COHORT = Prisma.sql`"isGraded" AND "status" = 'EVALUATED' AND "score" IS NOT NULL`;

/** The board's order, unqualified like `IN_COHORT`: marks, then less time, then id; no time is slowest. */
export const RANK_ORDER = Prisma.sql`"score" DESC, "timeTakenSec" ASC NULLS LAST, "id" ASC`;

/** The board's rank 1 alone: `RANK_ORDER` is `Attempt_ranking_idx`'s own order, so one index probe. */
export function rankOneSql(testId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT "id" FROM "Attempt"
    WHERE "testId" = ${testId}::uuid AND ${IN_COHORT}
    ORDER BY ${RANK_ORDER}
    LIMIT 1
  `;
}

/** One chosen sitting's standing in its own test's cohort. */
export interface StandingRow {
  attempt_id: string;
  test_id: string;
  rank: number;
  percentile: number;
  cohort_size: number;
}

type StandingsWhere =
  { attemptId: string } | { studentId: string } | { attemptIds: readonly string[] };

/** One sitting, a named few, or every one a student has sat — the three ways standings are asked for. */
function chosenSittings(where: StandingsWhere): Prisma.Sql {
  if ('attemptId' in where) return Prisma.sql`a."id" = ${where.attemptId}::uuid`;
  if ('attemptIds' in where) return Prisma.sql`a."id" = ANY(${[...where.attemptIds]}::uuid[])`;
  return Prisma.sql`a."studentId" = ${where.studentId}::uuid`;
}

/** Each chosen sitting counted against its test's cohort, one LATERAL count per sitting. */
export function standingsSql(where: StandingsWhere, newest?: number): Prisma.Sql {
  const chosen = chosenSittings(where);
  // Chosen BEFORE the laterals, so a bound is a bound on how many cohorts are counted.
  const bounded =
    newest === undefined
      ? Prisma.empty
      : Prisma.sql`ORDER BY a."submittedAt" DESC NULLS LAST, a."id" DESC LIMIT ${newest}`;
  return Prisma.sql`
    WITH chosen AS (
      SELECT a."id", a."testId", a."score", a."timeTakenSec"
      FROM "Attempt" a
      WHERE ${chosen} AND ${IN_COHORT}
      ${bounded}
    )
    SELECT a."id" AS attempt_id,
           a."testId" AS test_id,
           c.rank::int AS rank,
           sitting_percentile(c.outscored, c.tied, c.cohort)::float8 AS percentile,
           c.cohort::int AS cohort_size
    FROM chosen a
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS cohort,
             COUNT(*) FILTER (WHERE b."score" < a."score") AS outscored,
             COUNT(*) FILTER (WHERE b."score" = a."score") AS tied,
             COUNT(*) FILTER (
               WHERE b."score" > a."score"
                  OR (b."score" = a."score"
                      AND COALESCE(b."timeTakenSec", 2147483647) < COALESCE(a."timeTakenSec", 2147483647))
                  OR (b."score" = a."score"
                      AND COALESCE(b."timeTakenSec", 2147483647) = COALESCE(a."timeTakenSec", 2147483647)
                      AND b."id" < a."id")
             ) + 1 AS rank
      FROM "Attempt" b
      WHERE b."testId" = a."testId" AND ${IN_COHORT}
    ) c
  `;
}

/** How many sittings `standingsSql` ranks on one test: the n every standing on it is out of. */
export function cohortSizeSql(testId: string): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::int AS cohort_size FROM "Attempt"
    WHERE "testId" = ${testId}::uuid AND ${IN_COHORT}
  `;
}

/** One seat on one test's board. Nothing here says who is reading it — that is decided in Node. */
export interface CohortSeatRow {
  attempt_id: string;
  rank: number;
  score: number;
  cohort: number;
  percentile: number;
  name: string | null;
  branch: string | null;
}

/** Every seat, in `RANK_ORDER`, with `testResultsSql`'s percentile: what a whole board is held as. */
const SEATED = Prisma.sql`
  SELECT a."id", a."studentId", a."score",
         (ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER}))::int AS rank,
         (COUNT(*) OVER ())::int AS cohort,
         sitting_percentile(
           RANK() OVER (ORDER BY a."score" ASC) - 1,
           COUNT(*) OVER (PARTITION BY a."score"),
           COUNT(*) OVER ()
         )::float8 AS percentile
  FROM "Attempt" a
`;

/** The named half of a seat, which only the rows a board actually shows ever pay for. */
const NAMED = Prisma.sql`
  SELECT r."id" AS attempt_id, r.rank, r."score"::float8 AS score, r.cohort, r.percentile,
         s."fullName" AS name, br."name" AS branch
  FROM ranked r
  JOIN "Student" s ON s."id" = r."studentId"
  LEFT JOIN "Branch" br ON br."id" = s."currentBranchId"
`;

/** One paper's whole ranking, read once per rollup and sliced per reader from memory. */
export function rankedCohortSql(testId: string): Prisma.Sql {
  return Prisma.sql`
    WITH ranked AS (${SEATED} WHERE a."testId" = ${testId}::uuid AND ${IN_COHORT})
    ${NAMED}
    ORDER BY r.rank
  `;
}

/** The podium and one reader's neighbourhood alone — the live answer where no held ranking has them. */
export function testBoardSql(testId: string, attemptId: string): Prisma.Sql {
  return Prisma.sql`
    WITH ranked AS (${SEATED} WHERE a."testId" = ${testId}::uuid AND ${IN_COHORT}),
    mine AS (SELECT rank FROM ranked WHERE "id" = ${attemptId}::uuid)
    ${NAMED}
    WHERE r.rank <= ${LEADERBOARD_PODIUM}
       OR r.rank BETWEEN (SELECT rank FROM mine) - ${LEADERBOARD_NEIGHBOURS}
                     AND (SELECT rank FROM mine) + ${LEADERBOARD_NEIGHBOURS}
    ORDER BY r.rank
  `;
}

/** A sitting in the report an admin downloads; outside the cohort, its rank is NULL. */
export interface TestResultRow {
  attempt_id: string;
  rank: number | null;
  percentile: number | null;
}

/** One window pass in `standingsSql`'s order; ranked first in rank order, then the unranked. */
export function testResultsSql(testId: string): Prisma.Sql {
  return Prisma.sql`
    WITH ranked AS (
      SELECT a."id",
             (ROW_NUMBER() OVER (ORDER BY ${RANK_ORDER}))::int AS rank,
             sitting_percentile(
               RANK() OVER (ORDER BY a."score" ASC) - 1,
               COUNT(*) OVER (PARTITION BY a."score"),
               COUNT(*) OVER ()
             )::float8 AS percentile
      FROM "Attempt" a
      WHERE a."testId" = ${testId}::uuid AND ${IN_COHORT}
    )
    SELECT a."id" AS attempt_id, r.rank, r.percentile
    FROM "Attempt" a
    LEFT JOIN ranked r ON r."id" = a."id"
    WHERE a."testId" = ${testId}::uuid
    ORDER BY r.rank ASC NULLS LAST, a."id" ASC
  `;
}

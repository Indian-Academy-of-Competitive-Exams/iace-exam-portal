/**
 * Every ranking query, counted live from Postgres. A test's cohort is its graded, evaluated, scored
 * sittings, ordered by marks, then time taken, then id; `sitting_percentile` owns the percentile.
 * The cohort filter stays literal SQL so the planner can match `Attempt_ranking_idx`, and a sitting
 * with no recorded time ranks as the slowest there is.
 */
import { LEADERBOARD_NEIGHBOURS, LEADERBOARD_PODIUM } from '@iace/contracts';
import { Prisma } from '@prisma/client';

/** One chosen sitting's standing in its own test's cohort. */
export interface StandingRow {
  attempt_id: string;
  test_id: string;
  rank: number;
  percentile: number;
  cohort_size: number;
}

/** Each chosen sitting counted against its test's cohort, one LATERAL count per sitting. */
export function standingsSql(where: { attemptId: string } | { studentId: string }): Prisma.Sql {
  const chosen =
    'attemptId' in where
      ? Prisma.sql`a."id" = ${where.attemptId}`
      : Prisma.sql`a."studentId" = ${where.studentId}`;
  return Prisma.sql`
    SELECT a."id" AS attempt_id,
           a."testId" AS test_id,
           c.rank::int AS rank,
           sitting_percentile(c.outscored, c.tied, c.cohort)::float8 AS percentile,
           c.cohort::int AS cohort_size
    FROM "Attempt" a
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
      WHERE b."testId" = a."testId"
        AND b."isGraded" AND b."status" = 'EVALUATED' AND b."score" IS NOT NULL
    ) c
    WHERE ${chosen}
      AND a."isGraded" AND a."status" = 'EVALUATED' AND a."score" IS NOT NULL
  `;
}

/** One paper's cohort size: the "N sat" its card shows. */
export interface SittingCountRow {
  test_id: string;
  sat: number;
}

/** Many papers' cohort sizes in one read. A paper nobody ranks on returns no row, never a zero. */
export function sittingCountsSql(testIds: readonly string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT a."testId" AS test_id, COUNT(*)::int AS sat
    FROM "Attempt" a
    WHERE a."testId" = ANY(${[...testIds]}::text[])
      AND a."isGraded" AND a."status" = 'EVALUATED' AND a."score" IS NOT NULL
    GROUP BY a."testId"
  `;
}

/** A seat on one test's board: the podium and the reader's neighbourhood, ranked in SQL. */
export interface TestBoardRow {
  attempt_id: string;
  rank: number;
  score: number;
  cohort: number;
  name: string | null;
  branch: string | null;
  is_you: boolean;
}

/** ASC keeps NULLS LAST, so a sitting with no recorded time sits where its standing counts it. */
export function testBoardSql(testId: string, attemptId: string): Prisma.Sql {
  return Prisma.sql`
    WITH ranked AS (
      SELECT a."id", a."studentId", a."score",
             (ROW_NUMBER() OVER (ORDER BY a."score" DESC, a."timeTakenSec" ASC, a."id" ASC))::int AS rank,
             (COUNT(*) OVER ())::int AS cohort
      FROM "Attempt" a
      WHERE a."testId" = ${testId}
        AND a."isGraded" AND a."status" = 'EVALUATED' AND a."score" IS NOT NULL
    ),
    mine AS (SELECT rank FROM ranked WHERE "id" = ${attemptId})
    SELECT r."id" AS attempt_id, r.rank, r."score"::float8 AS score, r.cohort,
           s."fullName" AS name, br."name" AS branch, (r."id" = ${attemptId}) AS is_you
    FROM ranked r
    JOIN "Student" s ON s."id" = r."studentId"
    LEFT JOIN "Branch" br ON br."id" = s."currentBranchId"
    WHERE r.rank <= ${LEADERBOARD_PODIUM}
       OR r.rank BETWEEN (SELECT rank FROM mine) - ${LEADERBOARD_NEIGHBOURS}
                     AND (SELECT rank FROM mine) + ${LEADERBOARD_NEIGHBOURS}
    ORDER BY r.rank
  `;
}

/** One returned seat. `cohort` and `prior_rank` repeat on every row — a window function's output. */
export interface PointsRow {
  rank: number;
  points: number;
  sittings: number;
  cohort: number;
  name: string | null;
  branch: string | null;
  is_you: boolean;
  prior_rank: number | null;
}

/** Every sitting's percentile over its whole test cohort, averaged per live student and ranked. */
export function pointsBoardSql(studentId: string, testIds: readonly string[] | null): Prisma.Sql {
  const inScope =
    testIds === null ? Prisma.empty : Prisma.sql`AND a."testId" = ANY(${[...testIds]}::text[])`;

  return Prisma.sql`
    WITH cohort AS (
      SELECT a."testId"      AS test_id,
             a."studentId"   AS student_id,
             a."score"       AS score,
             a."submittedAt" AS submitted_at
      FROM "Attempt" a
      WHERE a."isGraded" AND a."status" = 'EVALUATED' AND a."score" IS NOT NULL
        ${inScope}
    ),
    counted AS (
      SELECT student_id,
             submitted_at,
             sitting_percentile(
               RANK() OVER (PARTITION BY test_id ORDER BY score ASC) - 1,
               COUNT(*) OVER (PARTITION BY test_id, score),
               COUNT(*) OVER (PARTITION BY test_id)
             ) AS percentile
      FROM cohort
    ),
    -- An erased student's sittings still count in each test's cohort; only their row goes.
    scoped AS (
      SELECT c.student_id, c.percentile, c.submitted_at
      FROM counted c
      JOIN "Student" s ON s."id" = c.student_id
      WHERE s."deletedAt" IS NULL
    ),
    board AS (
      SELECT student_id,
             ROUND(AVG(percentile), 2)::float8 AS points,
             COUNT(*)::int AS sittings
      FROM scoped
      GROUP BY student_id
    ),
    ranked AS (
      SELECT b.*,
             (ROW_NUMBER() OVER (ORDER BY b.points DESC, b.sittings DESC, b.student_id))::int AS rank,
             (COUNT(*) OVER ())::int AS cohort
      FROM board b
    ),
    mine AS (
      SELECT rank FROM ranked WHERE student_id = ${studentId}
    ),
    -- Where the reader stood before their most recent sitting counted.
    before AS (
      SELECT ROUND(AVG(percentile), 2)::float8 AS points
      FROM (
        SELECT percentile FROM scoped
        WHERE student_id = ${studentId}
        ORDER BY submitted_at DESC NULLS LAST
        OFFSET 1
      ) earlier
    ),
    prior AS (
      SELECT CASE WHEN (SELECT points FROM before) IS NULL THEN NULL ELSE (
        SELECT COUNT(*)::int + 1 FROM ranked r
        WHERE r.points > (SELECT points FROM before) AND r.student_id <> ${studentId}
      ) END AS rank
    )
    SELECT r.rank,
           r.points,
           r.sittings,
           r.cohort,
           s."fullName" AS name,
           br."name" AS branch,
           (r.student_id = ${studentId}) AS is_you,
           (SELECT rank FROM prior) AS prior_rank
    FROM ranked r
    JOIN "Student" s ON s."id" = r.student_id
    LEFT JOIN "Branch" br ON br."id" = s."currentBranchId"
    WHERE r.rank <= ${LEADERBOARD_PODIUM}
       OR r.rank BETWEEN COALESCE((SELECT rank FROM mine), 0) - ${LEADERBOARD_NEIGHBOURS}
                     AND COALESCE((SELECT rank FROM mine), 0) + ${LEADERBOARD_NEIGHBOURS}
    ORDER BY r.rank
  `;
}

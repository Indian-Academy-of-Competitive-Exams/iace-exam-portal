import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { Prisma } from '@prisma/client';
import { testPrisma, uid } from './support/database';

const prisma = testPrisma();

after(() => prisma.$disconnect());

interface PercentileRow {
  percentile: number;
}

interface PlanRow {
  'QUERY PLAN': string;
}

interface PercentileCase {
  name: string;
  outscored: number;
  tied: number;
  cohort: number;
  expected: number;
}

/** Each expectation is the formula by hand: a tie counts half, and a field of one is 100. */
const PERCENTILE_CASES: readonly PercentileCase[] = [
  { name: 'a field of one is its own top', outscored: 0, tied: 1, cohort: 1, expected: 100 },
  { name: 'the top of four, nobody tied', outscored: 3, tied: 1, cohort: 4, expected: 87.5 },
  { name: 'the bottom of four', outscored: 0, tied: 1, cohort: 4, expected: 12.5 },
  { name: 'a two-way tie at the top of four', outscored: 2, tied: 2, cohort: 4, expected: 75 },
  { name: 'a two-way tie in the middle of four', outscored: 1, tied: 2, cohort: 4, expected: 50 },
  { name: 'four who all tied', outscored: 0, tied: 4, cohort: 4, expected: 50 },
  { name: 'the bottom of three, to hundredths', outscored: 0, tied: 1, cohort: 3, expected: 16.67 },
  { name: 'the top of three, to hundredths', outscored: 2, tied: 1, cohort: 3, expected: 83.33 },
  { name: 'fewer than none outscored or tied', outscored: -2, tied: 0, cohort: 4, expected: 12.5 },
  { name: 'more outscored than the field holds', outscored: 9, tied: 9, cohort: 4, expected: 100 },
  { name: 'more tied than are left', outscored: 1, tied: 7, cohort: 4, expected: 62.5 },
  { name: 'an empty field', outscored: 0, tied: 0, cohort: 0, expected: 100 },
  {
    name: 'a half-hundredth rounds up, exactly',
    outscored: 0,
    tied: 23,
    cohort: 80,
    expected: 14.38,
  },
];

async function sittingPercentile({ outscored, tied, cohort }: PercentileCase): Promise<number> {
  const [row] = await prisma.$queryRaw<PercentileRow[]>(Prisma.sql`
    SELECT sitting_percentile(${outscored}::bigint, ${tied}::bigint, ${cohort}::bigint)::float8
      AS percentile
  `);
  assert.ok(row);
  return row.percentile;
}

describe('sitting_percentile', () => {
  for (const asked of PERCENTILE_CASES) {
    it(asked.name, async () => {
      assert.equal(await sittingPercentile(asked), asked.expected);
    });
  }
});

describe('Attempt_ranking_idx', () => {
  it('serves the cohort count of one test', async () => {
    const plan = await prisma.$transaction(async (tx) => {
      // A table this small is cheaper to read whole, which would say nothing about the index.
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<PlanRow[]>(Prisma.sql`
        EXPLAIN SELECT count(*) FROM "Attempt"
        WHERE "testId" = ${uid('test')}
          AND "isGraded" AND "status" = 'EVALUATED' AND "score" IS NOT NULL
      `);
    });

    assert.match(plan.map((row) => row['QUERY PLAN']).join('\n'), /Attempt_ranking_idx/);
  });
});

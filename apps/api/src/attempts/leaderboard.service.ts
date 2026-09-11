/** Rank, percentile and "N sat", counted live from Postgres on every read. Nothing is saved. */
import { Injectable } from '@nestjs/common';
import { ATTEMPT_STATUS } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { standingsSql, type StandingRow } from './ranking-sql';

/** One sitting's place in its cohort, as of this read. */
export interface Standing {
  rank: number;
  percentile: number;
  cohortSize: number;
}

/** A standing that says which sitting, on which test, it belongs to. */
export interface SittingStanding extends Standing {
  attemptId: string;
  testId: string;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Null for a sitting outside the cohort: a retake, a voided sitting, or one not yet scored. */
  async standing(testId: string, attemptId: string): Promise<Standing | null> {
    const [row] = await this.prisma.$queryRaw<StandingRow[]>(standingsSql({ attemptId }));
    return row?.test_id === testId ? standingOf(row) : null;
  }

  /** Every graded sitting of one student, each against its own test's cohort, keyed by sitting. */
  async standingsOfStudent(studentId: string): Promise<ReadonlyMap<string, SittingStanding>> {
    const rows = await this.prisma.$queryRaw<StandingRow[]>(standingsSql({ studentId }));
    return new Map(
      rows.map((row) => [
        row.attempt_id,
        { attemptId: row.attempt_id, testId: row.test_id, ...standingOf(row) },
      ]),
    );
  }

  /** The cohort size a score card names, per test. A test nobody ranks on is left out, never zero. */
  async sittingCounts(testIds: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (testIds.length === 0) return new Map();
    const grouped = await this.prisma.attempt.groupBy({
      by: ['testId'],
      where: {
        testId: { in: [...testIds] },
        isGraded: true,
        status: ATTEMPT_STATUS.EVALUATED,
        score: { not: null },
      },
      _count: true,
    });
    return new Map(grouped.map((row) => [row.testId, row._count]));
  }
}

const standingOf = (row: StandingRow): Standing => ({
  rank: row.rank,
  percentile: row.percentile,
  cohortSize: row.cohort_size,
});

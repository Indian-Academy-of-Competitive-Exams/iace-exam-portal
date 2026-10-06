/** Rank and percentile, counted live from Postgres on every read. Nothing is saved. */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  cohortFiguresSql,
  cohortSizeSql,
  cohortStandingsSql,
  standingsSql,
  type CohortFiguresRow,
  type CohortSittingRow,
  type HandedIn,
  type StandingRow,
} from './ranking-sql';

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

/** A ranked sitting as a report over many tests reads it: its standing, and who sat it. */
export interface CohortSitting extends SittingStanding {
  studentId: string;
}

/** A test's cohort in four figures. A test nobody is ranked on has no entry. */
export interface CohortFigures {
  size: number;
  mean: number;
  highest: number;
  topperId: string;
}

@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** Null for a sitting outside the cohort: a retake, a voided sitting, or one not yet scored. */
  async standing(testId: string, attemptId: string): Promise<Standing | null> {
    const [row] = await this.prisma.$queryRaw<StandingRow[]>(standingsSql({ attemptId }));
    return row?.test_id === testId ? standingOf(row) : null;
  }

  /** The cohort a standing on this test is out of, counted now — a retake's reader still sees it. */
  async cohortSize(testId: string): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Pick<StandingRow, 'cohort_size'>[]>(
      cohortSizeSql(testId),
    );
    return row?.cohort_size ?? 0;
  }

  /** One student's graded sittings, newest first, each against its own test's cohort. Bounded by `newest`. */
  async standingsOfStudent(
    studentId: string,
    newest?: number,
  ): Promise<ReadonlyMap<string, SittingStanding>> {
    const rows = await this.prisma.$queryRaw<StandingRow[]>(standingsSql({ studentId }, newest));
    return sittingsOf(rows);
  }

  /** The ranked sittings on these tests, keyed by sitting; `within` returns only those handed in then, still ranked among all. */
  async standingsOfTests(
    testIds: readonly string[],
    within?: HandedIn,
  ): Promise<ReadonlyMap<string, CohortSitting>> {
    if (testIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<CohortSittingRow[]>(
      cohortStandingsSql(testIds, within),
    );
    return new Map(
      rows.map((row) => [
        row.attempt_id,
        {
          attemptId: row.attempt_id,
          testId: row.test_id,
          studentId: row.student_id,
          ...standingOf(row),
        },
      ]),
    );
  }

  /** Each test's cohort summed up, keyed by test. */
  async cohortsOf(testIds: readonly string[]): Promise<ReadonlyMap<string, CohortFigures>> {
    if (testIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<CohortFiguresRow[]>(cohortFiguresSql(testIds));
    return new Map(
      rows.map((row) => [
        row.test_id,
        { size: row.cohort_size, mean: row.mean, highest: row.highest, topperId: row.topper_id },
      ]),
    );
  }

  /** Only the named sittings, each against its own test's cohort — a report's bounded plot. */
  async standingsOf(attemptIds: readonly string[]): Promise<ReadonlyMap<string, SittingStanding>> {
    if (attemptIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<StandingRow[]>(standingsSql({ attemptIds }));
    return sittingsOf(rows);
  }
}

const standingOf = (row: StandingRow): Standing => ({
  rank: row.rank,
  percentile: row.percentile,
  cohortSize: row.cohort_size,
});

const sittingsOf = (rows: readonly StandingRow[]): ReadonlyMap<string, SittingStanding> =>
  new Map(
    rows.map((row) => [
      row.attempt_id,
      { attemptId: row.attempt_id, testId: row.test_id, ...standingOf(row) },
    ]),
  );

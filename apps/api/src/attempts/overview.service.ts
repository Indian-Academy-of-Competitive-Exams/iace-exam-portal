/**
 * The overall dashboard: `StudentStat` and `StudentSubjectStat` for the tallies, and the student's
 * live standings for the percentiles, which no rollup can hold still. The student's own path and the
 * admin's call the same method with a different studentId, exactly as the per-test report does; the
 * only difference is who is allowed to name the student.
 */
import { Injectable } from '@nestjs/common';
import {
  AppException,
  ErrorCodes,
  measureOf,
  type StudentOverview,
  type SubjectStanding,
  type SubjectTally,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { LeaderboardService, type SittingStanding } from './leaderboard.service';

const NO_STUDENT = 'No such student';

/** A student who has sat nothing has no row at all, which is a clean slate rather than an error. */
const NO_SITTINGS: StudentOverview['standing'] = {
  testsAttempted: 0,
  testsEvaluated: 0,
  retakeCount: 0,
  avgPercentile: null,
  bestPercentile: null,
  avgScore: null,
  sumTimeSec: 0,
  lastAttemptAt: null,
};

const NOTHING_ANSWERED: StudentOverview['disposition'] = {
  correct: 0,
  wrong: 0,
  unattempted: 0,
};

const SUBJECT_SELECT = {
  subjectId: true,
  scope: true,
  attempted: true,
  correct: true,
  sumTimeSec: true,
  subject: { select: { name: true } },
} as const;

@Injectable()
export class StudentOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  /** The admin path. The student is named, so an unknown id must read as missing, not as empty. */
  async forStudent(studentId: string): Promise<StudentOverview> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, NO_STUDENT);
    return this.overview(studentId);
  }

  async overview(studentId: string): Promise<StudentOverview> {
    const [stat, rows, standings] = await Promise.all([
      this.prisma.studentStat.findUnique({ where: { studentId } }),
      this.prisma.studentSubjectStat.findMany({
        where: { studentId },
        select: SUBJECT_SELECT,
      }),
      this.leaderboard.standingsOfStudent(studentId),
    ]);
    const percentiles = percentilesOf(standings);

    const subjects = subjectsOf(rows);
    const tallies = subjects.flatMap((subject) => subject.tallies);

    return {
      studentId,
      generatedAt: new Date().toISOString(),
      standing:
        stat === null
          ? { ...NO_SITTINGS, ...percentiles }
          : {
              testsAttempted: stat.testsAttempted,
              testsEvaluated: stat.testsEvaluated,
              retakeCount: stat.retakeCount,
              ...percentiles,
              avgScore: perSitting(Number(stat.sumScore), stat.testsEvaluated),
              sumTimeSec: Number(stat.sumTimeSec),
              lastAttemptAt: stat.lastAttemptAt?.toISOString() ?? null,
            },
      disposition:
        stat === null
          ? NOTHING_ANSWERED
          : {
              correct: stat.totalCorrect,
              wrong: stat.totalWrong,
              unattempted: stat.totalUnattempted,
            },
      measure: measureOf(tallies),
      subjects,
    };
  }
}

type SubjectStatRow = {
  subjectId: string;
  scope: SubjectTally['scope'];
  attempted: number;
  correct: number;
  sumTimeSec: bigint;
  subject: { name: string };
};

/** One entry per subject carrying its scope rows, so a scope filter costs no second call. */
function subjectsOf(rows: readonly SubjectStatRow[]): SubjectStanding[] {
  const held = new Map<string, SubjectStanding>();

  for (const row of rows) {
    const standing = held.get(row.subjectId) ?? {
      subjectId: row.subjectId,
      name: row.subject.name,
      tallies: [],
    };
    standing.tallies.push({
      scope: row.scope,
      attempted: row.attempted,
      correct: row.correct,
      sumTimeSec: Number(row.sumTimeSec),
    });
    held.set(row.subjectId, standing);
  }

  return [...held.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every graded sitting's current percentile. No standing at all is a dash on screen, not a nought. */
function percentilesOf(
  standings: ReadonlyMap<string, SittingStanding>,
): Pick<StudentOverview['standing'], 'avgPercentile' | 'bestPercentile'> {
  const held = [...standings.values()].map((standing) => standing.percentile);
  if (held.length === 0) return { avgPercentile: null, bestPercentile: null };
  const sum = held.reduce((total, percentile) => total + percentile, 0);
  return {
    avgPercentile: Math.round((sum / held.length) * 100) / 100,
    bestPercentile: Math.max(...held),
  };
}

/** Nothing evaluated is nothing to average, which is a dash on screen rather than a nought. */
const perSitting = (sum: number, sittings: number): number | null =>
  sittings === 0 ? null : Math.round((sum / sittings) * 100) / 100;

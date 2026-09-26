/**
 * The overall dashboard: `StudentStat` and `StudentSubjectStat` for the tallies, and the student's
 * live standings for the percentiles, which no rollup can hold still. The student's own path and the
 * admin's call the same method with a different studentId, exactly as the per-test report does; the
 * only difference is who is allowed to name the student.
 */
import { Injectable } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import {
  TEST_SCOPE,
  measureOf,
  round2,
  type StudentOverview,
  type SubjectStanding,
} from '@iace/contracts';
import { readInBatches } from '../common/exporting';
import { PrismaService } from '../prisma/prisma.service';
import { perSitting } from './attempt-report';
import { requireStudent } from './require-student';
import { LeaderboardService, type SittingStanding } from './leaderboard.service';

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
} as const satisfies Prisma.StudentSubjectStatSelect;

@Injectable()
export class StudentOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  /** The admin path. The student is named, so an unknown id must read as missing, not as empty. */
  async forStudent(studentId: string): Promise<StudentOverview> {
    await requireStudent(this.prisma, studentId);
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

  /** Many students' tallies at once, for an export; a student with no row has sat nothing. */
  async rollupsFor(studentIds: readonly string[]): Promise<StudentRollups> {
    const [stats, rows] = await Promise.all([
      readInBatches(studentIds, (batch) =>
        this.prisma.studentStat.findMany({ where: { studentId: { in: batch } } }),
      ),
      readInBatches(studentIds, (batch) =>
        this.prisma.studentSubjectStat.findMany({
          where: { studentId: { in: batch }, scope: TEST_SCOPE.FULL },
          select: { studentId: true, ...SUBJECT_SELECT },
        }),
      ),
    ]);

    const subjects = new Map(rows.map((row) => [row.subjectId, row.subject.name]));
    const byStudent = new Map<string, StudentRollup>(
      stats.map((stat) => [
        stat.studentId,
        {
          testsAttempted: stat.testsAttempted,
          testsEvaluated: stat.testsEvaluated,
          avgScore: perSitting(Number(stat.sumScore), stat.testsEvaluated),
          accuracy:
            stat.totalAnswered === 0
              ? null
              : round2((stat.totalCorrect / stat.totalAnswered) * 100),
          avgTimeSec: perSitting(Number(stat.sumTimeSec), stat.testsAttempted),
          lastAttemptAt: stat.lastAttemptAt,
          subjectAccuracy: new Map(),
        },
      ]),
    );
    for (const row of rows) {
      const tally = { ...row, sumTimeSec: Number(row.sumTimeSec) };
      byStudent.get(row.studentId)?.subjectAccuracy.set(row.subjectId, measureOf([tally]).accuracy);
    }

    return {
      subjects: [...subjects]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      byStudent,
    };
  }
}

export interface StudentRollup {
  testsAttempted: number;
  testsEvaluated: number;
  avgScore: number | null;
  /** Percent, over the questions answered. */
  accuracy: number | null;
  avgTimeSec: number | null;
  lastAttemptAt: Date | null;
  /** Subject id to FULL-scope accuracy, percent. */
  subjectAccuracy: Map<string, number | null>;
}

export interface StudentRollups {
  /** Every subject any of them has a FULL-scope row for, by name. */
  subjects: { id: string; name: string }[];
  byStudent: ReadonlyMap<string, StudentRollup>;
}

type SubjectStatRow = Prisma.StudentSubjectStatGetPayload<{ select: typeof SUBJECT_SELECT }>;

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

/**
 * ONE metric set, parameterised by (studentId, scope). The student's own path and the admin's call
 * the same method with a different studentId, so the two can never drift apart; the only difference
 * is who is allowed to name the student. No select here loads `questionVersion`, so no scope and no
 * caller can reach an answer key through this file.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  PERFORMANCE_SCOPES,
  PERFORMANCE_SCOPE_FIELD,
  type CohortCurve,
  type PerformanceReport,
  type PerformanceReportQuery,
  type PercentilePoint,
  type SatSeries,
  type ScoreCardSection,
  type SeriesProgression,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { LeaderboardService, type Standing } from './leaderboard.service';
import { marksBySection, numberOrNull, sectionsWithScores } from './attempt-report';
import { sectionScoresIn } from './score-paper';
import { timeUseOf } from './attempt-analytics';
import {
  cohortShapeOf,
  compositionOf,
  curveBandsOf,
  difficultyStandingOf,
  flagYours,
  sectionalStandingOf,
  seriesProgressionOf,
  type CohortShape,
  type ReportedQuestion,
  type SatPaper,
  type SectionCohort,
} from './performance-analytics';

const NOT_YOURS = 'No such sitting';
const NO_STUDENT = 'No such student';
const NO_SERIES = 'No such test series';

/** How many sittings any one report folds in. Beyond this a trajectory is a smear, not a line. */
const SCOPE_ATTEMPT_CAP = 20;

/** Everything the report buckets by, and nothing that could carry an answer. */
const REPORT_SELECT = {
  id: true,
  testId: true,
  isGraded: true,
  score: true,
  sectionScores: true,
  submittedAt: true,
  lastRank: true,
  lastPercentile: true,
  test: {
    select: {
      title: true,
      evaluationMode: true,
      baseConfig: {
        select: {
          sections: {
            select: {
              id: true,
              name: true,
              order: true,
              questionCount: true,
              marksPerQuestion: true,
            },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  },
  questions: {
    select: {
      baseConfigSectionId: true,
      paperQuestionId: true,
      state: true,
      selectedOptionId: true,
      typedAnswer: true,
      isCorrect: true,
      marksAwarded: true,
      timeSpentSec: true,
      paperItem: { select: { marks: true, negativeMarks: true, status: true } },
      question: { select: { difficulty: true, subject: { select: { id: true, name: true } } } },
    },
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.AttemptSelect;

type ReportRow = Prisma.AttemptGetPayload<{ select: typeof REPORT_SELECT }>;

@Injectable()
export class PerformanceAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  /** The admin path. The student is named, so an unknown id must read as missing, not as empty. */
  async forStudent(studentId: string, query: PerformanceReportQuery): Promise<PerformanceReport> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: { id: true },
    });
    if (!student) throw new AppException(ErrorCodes.NOT_FOUND, NO_STUDENT);
    return this.report(studentId, query);
  }

  async report(studentId: string, query: PerformanceReportQuery): Promise<PerformanceReport> {
    const recent = await this.prisma.attempt.findMany({
      where: scopeWhere(studentId, query),
      orderBy: { submittedAt: { sort: 'desc', nulls: 'last' } },
      take: SCOPE_ATTEMPT_CAP,
      select: REPORT_SELECT,
    });
    if (recent.length === 0 && query.scope === PERFORMANCE_SCOPES.ATTEMPT) {
      throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    }

    const sat = recent.toReversed();
    // Everything but the trajectory describes the anchor, so one payload never mixes two papers.
    const anchor = sat.findLast((row) => row.isGraded) ?? sat.at(-1) ?? null;
    const rows = anchor === null ? [] : toReported(anchor);
    const testIds = [...new Set(sat.map((row) => row.testId))];

    const [testStats, pValues, sectionCohort, standing, series] = await Promise.all([
      this.testStats(testIds),
      this.pValues(anchor === null ? [] : [anchor.testId]),
      this.sectionCohort(anchor),
      anchor === null ? null : this.leaderboard.liveStanding(anchor.testId, anchor.id),
      this.seriesOf(studentId, query),
    ]);

    return {
      studentId,
      scope: query.scope,
      scopeId: scopeIdOf(query),
      label: series?.name ?? anchor?.test.title ?? null,
      evaluationMode: anchor?.test.evaluationMode ?? null,
      attemptsCounted: sat.length,
      generatedAt: new Date().toISOString(),
      trajectory: sat.map((row) => toPoint(row, testStats.get(row.testId)?.evaluatedCount ?? null)),
      cohort: await this.curveOf(query, anchor, standing, testStats),
      composition: compositionOf(rows),
      sections: sectionalStandingOf(sectionsOf(anchor), sectionCohort),
      difficulty: difficultyStandingOf(rows, pValues),
      time: timeUseOf(rows),
      progression: progressionOf(series, sat),
    };
  }

  /** Only a single paper has a curve: two papers with different marks cannot share a distribution. */
  private async curveOf(
    query: PerformanceReportQuery,
    anchor: ReportRow | null,
    standing: Standing | null,
    testStats: ReadonlyMap<string, TestStatRow>,
  ): Promise<CohortCurve | null> {
    if (anchor === null || !ONE_PAPER_SCOPES.has(query.scope)) return null;

    const rolled = testStats.get(anchor.testId) ?? null;
    const score = Number(anchor.score ?? 0);
    const rolledBands = curveBandsOf(rolled?.scoreHistogram, score);
    // The rollup wins field by field; the live count fills in whatever no job has written yet.
    const live = rolledBands.length === 0 ? await this.liveCohort(anchor.testId) : null;
    const counted = rolled?.evaluatedCount ?? 0;

    return {
      testId: anchor.testId,
      score,
      topperScore: numberOrNull(rolled?.maxScore ?? null) ?? live?.topperScore ?? null,
      averageScore: averageOf(rolled) ?? live?.averageScore ?? null,
      rank: standing?.rank ?? anchor.lastRank,
      percentile: standing?.percentile ?? numberOrNull(anchor.lastPercentile),
      cohortSize: counted === 0 ? (standing?.cohortSize ?? live?.size ?? 0) : counted,
      bands: rolledBands.length > 0 ? rolledBands : flagYours(live?.bands ?? [], score),
    };
  }

  /** The distribution counted off the sittings themselves — a cold path, so one grouped read. */
  private async liveCohort(testId: string): Promise<CohortShape> {
    const grouped = await this.prisma.attempt.groupBy({
      by: ['score'],
      where: { testId, isGraded: true, status: ATTEMPT_STATUS.EVALUATED, score: { not: null } },
      _count: true,
    });
    return cohortShapeOf(
      grouped.flatMap((row) =>
        row.score === null ? [] : [{ score: Number(row.score), count: row._count }],
      ),
    );
  }

  private async testStats(testIds: readonly string[]): Promise<Map<string, TestStatRow>> {
    if (testIds.length === 0) return new Map();
    const rows = await this.prisma.testStat.findMany({
      where: { testId: { in: [...testIds] } },
      select: {
        testId: true,
        evaluatedCount: true,
        sumScore: true,
        maxScore: true,
        scoreHistogram: true,
      },
    });
    return new Map(rows.map((row) => [row.testId, row]));
  }

  /** Item analysis for every paper in scope, keyed by the PAPER question the student was served. */
  private async pValues(testIds: readonly string[]): Promise<Map<string, number>> {
    if (testIds.length === 0) return new Map();
    const rows = await this.prisma.testQuestionStat.findMany({
      where: { testId: { in: [...testIds] }, pValue: { not: null } },
      select: { paperQuestionId: true, pValue: true },
    });
    return new Map(rows.map((row) => [row.paperQuestionId, Number(row.pValue)]));
  }

  private async sectionCohort(anchor: ReportRow | null): Promise<Map<string, SectionCohort>> {
    if (anchor === null) return new Map();
    const rows = await this.prisma.testSectionStat.findMany({
      where: { testId: anchor.testId },
      select: { baseConfigSectionId: true, attempted: true, sumScore: true, sumTimeSec: true },
    });
    return new Map(
      rows.map((row) => [
        row.baseConfigSectionId,
        {
          attempted: row.attempted,
          sumScore: Number(row.sumScore),
          sumTimeSec: Number(row.sumTimeSec),
        },
      ]),
    );
  }

  /** What the report is OF, and the ramp it is read along — the owner is in this WHERE too. */
  private async seriesOf(
    studentId: string,
    query: PerformanceReportQuery,
  ): Promise<ScopedSeries | null> {
    if (query.scope !== PERFORMANCE_SCOPES.SERIES) return null;
    const series = await this.prisma.testSeries.findFirst({
      where: {
        id: query.seriesId,
        tests: { some: { test: { attempts: { some: { studentId } } } } },
      },
      select: {
        id: true,
        name: true,
        progressive: true,
        tests: { select: { testId: true, order: true }, orderBy: { order: 'asc' } },
      },
    });
    if (!series) throw new AppException(ErrorCodes.NOT_FOUND, NO_SERIES);
    return {
      id: series.id,
      name: series.name,
      progressive: series.progressive,
      // A null order is a rung nobody numbered, so it keeps the place the ordered read gave it.
      order: new Map(series.tests.map((row, index) => [row.testId, row.order ?? index])),
    };
  }

  /** The scope picker's only honest list: a series they have never sat has no report to show. */
  async satSeries(studentId: string): Promise<SatSeries[]> {
    const rows = await this.prisma.testSeries.findMany({
      where: {
        tests: {
          some: { test: { attempts: { some: { studentId, status: ATTEMPT_STATUS.EVALUATED } } } },
        },
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, progressive: true },
    });
    return rows;
  }
}

interface ScopedSeries {
  id: string;
  name: string;
  progressive: boolean;
  order: ReadonlyMap<string, number>;
}

/** A flat series has no ramp to draw a climb against, so it never carries one. */
function progressionOf(
  series: ScopedSeries | null,
  sat: readonly ReportRow[],
): SeriesProgression | null {
  if (!series?.progressive) return null;
  const papers: SatPaper[] = sat.map((row) => ({
    testId: row.testId,
    attemptId: row.id,
    title: row.test.title,
    percentile: numberOrNull(row.lastPercentile),
    questions: toReported(row),
  }));
  return seriesProgressionOf(series.id, series.order, papers);
}

interface TestStatRow {
  testId: string;
  evaluatedCount: number;
  sumScore: Prisma.Decimal;
  maxScore: Prisma.Decimal | null;
  scoreHistogram: Prisma.JsonValue;
}

const ONE_PAPER_SCOPES = new Set<string>([PERFORMANCE_SCOPES.ATTEMPT, PERFORMANCE_SCOPES.TEST]);

const averageOf = (rolled: TestStatRow | null): number | null =>
  rolled === null || rolled.evaluatedCount === 0
    ? null
    : Math.round((Number(rolled.sumScore) / rolled.evaluatedCount) * 100) / 100;

/** The owner is part of every WHERE, so another student's work reads as missing, not as refused. */
function scopeWhere(studentId: string, query: PerformanceReportQuery): Prisma.AttemptWhereInput {
  const sat = { studentId, status: ATTEMPT_STATUS.EVALUATED };
  if (query.scope === PERFORMANCE_SCOPES.ATTEMPT) return { ...sat, id: query.attemptId };
  if (query.scope === PERFORMANCE_SCOPES.TEST) return { ...sat, testId: query.testId };
  if (query.scope === PERFORMANCE_SCOPES.SERIES) {
    return { ...sat, test: { series: { some: { testSeriesId: query.seriesId } } } };
  }
  return sat;
}

/** The id the scope was answered by, and never one left over from a different scope's field. */
function scopeIdOf(query: PerformanceReportQuery): string | null {
  const field = PERFORMANCE_SCOPE_FIELD[query.scope];
  return field === null ? null : (query[field] ?? null);
}

function toPoint(row: ReportRow, cohortSize: number | null): PercentilePoint {
  return {
    attemptId: row.id,
    testId: row.testId,
    testTitle: row.test.title,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    percentile: numberOrNull(row.lastPercentile),
    rank: row.lastRank,
    cohortSize,
  };
}

function sectionsOf(anchor: ReportRow | null): ScoreCardSection[] {
  if (anchor === null) return [];
  return sectionsWithScores(
    anchor.test.baseConfig.sections.map((section) => ({
      ...section,
      marksPerQuestion: Number(section.marksPerQuestion),
    })),
    sectionScoresIn(anchor.sectionScores),
    marksBySection(
      anchor.questions.map((row) => ({
        baseConfigSectionId: row.baseConfigSectionId,
        marks: Number(row.paperItem?.marks ?? 0),
      })),
    ),
  );
}

function toReported(row: ReportRow): ReportedQuestion[] {
  return row.questions.map((question) => ({
    baseConfigSectionId: question.baseConfigSectionId,
    subjectId: question.question.subject.id,
    subjectName: question.question.subject.name,
    difficulty: question.question.difficulty,
    state: question.state,
    answered: question.selectedOptionId !== null || (question.typedAnswer?.trim() ?? '') !== '',
    isCorrect: question.isCorrect,
    marksAwarded: Number(question.marksAwarded ?? 0),
    timeSpentSec: question.timeSpentSec,
    paperQuestionId: question.paperQuestionId,
    marks: Number(question.paperItem?.marks ?? 0),
    negativeMarks: Number(question.paperItem?.negativeMarks ?? 0),
    disposition: question.paperItem?.status ?? PAPER_QUESTION_STATUS.ACTIVE,
  }));
}

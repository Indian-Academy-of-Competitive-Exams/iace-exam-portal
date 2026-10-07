/**
 * ONE metric set for a sitting, `figuresOf`, read two ways: the score card a student opens on their
 * own sitting, and the report an admin opens at any scope for a student they may see. Both run the
 * one method, so the two can never drift apart. No select here loads `questionVersion`, so no scope
 * and no caller can reach an answer key through this file.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  PERFORMANCE_SCOPES,
  PERFORMANCE_SCOPE_FIELD,
  type CohortCurve,
  type FieldEffort,
  type PerformanceReport,
  type PerformanceReportQuery,
  type PercentilePoint,
  type ScoreCard,
  type ScoreCardSection,
  civilDate,
  scopedDurationSec,
  scopedQuestionCount,
  scopedSections,
  type TestCalendar,
} from '@iace/contracts';
import { startOfInstituteDay } from '../common/time/institute-day';
import { scopeRefOf } from '../common/prisma-json';
import { PrismaService } from '../prisma/prisma.service';
import { cohortCurveOf } from './cohort-curve';
import { NO_FIELD, effortIn, fieldEffortOf, type FieldShape } from './field-effort';
import { servedSheet, type ServedAnswer } from './answer-sheet';
import { SHEET_ROW_SELECT, hold } from './paper-sheet.service';
import { requireStudent } from './require-student';
import { LeaderboardService, type Standing } from './leaderboard.service';
import { elapsedSeconds, marksBySection, percentageOf, sectionsWithScores } from './attempt-report';
import { sectionScoresIn } from './score-paper';
import { timeUseOf } from './attempt-analytics';
import { NO_TOPPER, topperOf } from './topper';
import { paceIndexOf } from './question-report';
import {
  compositionOf,
  flagYours,
  sectionalStandingOf,
  type CohortShape,
  type ReportedQuestion,
  type SectionCohort,
} from './performance-analytics';

const NOT_YOURS = 'No such sitting';
const NOT_MARKED = 'This paper has not been marked yet. Its score card opens the moment it is.';

/** Handed in, marked or not: the two states a paper's effort can be read in. */
const ENDED = [ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.EVALUATED];

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
  startedAt: true,
  shuffleSeed: true,
  test: {
    select: {
      title: true,
      scope: true,
      scopeRef: true,
      baseConfig: {
        select: {
          shuffleQuestions: true,
          sections: {
            select: {
              id: true,
              moduleId: true,
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
} as const satisfies Prisma.AttemptSelect;

type ReportRow = Prisma.AttemptGetPayload<{ select: typeof REPORT_SELECT }>;

/** The report's row, and what only a card prints: its counts, its clock and the paper's scope. */
const SCORE_CARD_SELECT = {
  ...REPORT_SELECT,
  attemptNo: true,
  evaluatedAt: true,
  correctCount: true,
  wrongCount: true,
  unattemptedCount: true,
  test: {
    select: {
      title: true,
      scope: true,
      scopeRef: true,
      baseConfig: {
        select: {
          durationSec: true,
          totalQuestions: true,
          shuffleQuestions: true,
          sections: {
            select: {
              id: true,
              moduleId: true,
              durationSec: true,
              perQuestionSec: true,
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
} as const satisfies Prisma.AttemptSelect;

/** Everything a question buckets by off the paper row, and nothing that could carry an answer. */
const PERFORMANCE_ROW_SELECT = {
  ...SHEET_ROW_SELECT,
  marks: true,
  negativeMarks: true,
  status: true,
} as const satisfies Prisma.PaperQuestionSelect;

type PerformancePaperRow = Prisma.PaperQuestionGetPayload<{
  select: typeof PERFORMANCE_ROW_SELECT;
}>;

@Injectable()
export class PerformanceAnalyticsService {
  private readonly curves = new Map<string, Promise<CohortShape>>();
  private readonly fields = new Map<string, Promise<FieldShape>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  /** The admin path. The student is named, so an unknown id must read as missing, not as empty. */
  async forStudent(studentId: string, query: PerformanceReportQuery): Promise<PerformanceReport> {
    await requireStudent(this.prisma, studentId);
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
    const testIds = [...new Set(sat.map((row) => row.testId))];
    const [testStats, standings] = await Promise.all([
      this.testStats(testIds),
      this.leaderboard.standingsOf(sat.map((row) => row.id)),
    ]);
    const standing = anchor === null ? null : (standings.get(anchor.id) ?? null);

    return {
      studentId,
      scope: query.scope,
      scopeId: scopeIdOf(query),
      label: anchor?.test.title ?? null,
      attemptsCounted: sat.length,
      generatedAt: new Date().toISOString(),
      trajectory: sat.map((row) =>
        toPoint(row, standings.get(row.id), testStats.get(row.testId)?.evaluatedCount ?? null),
      ),
      ...(await this.figuresOf(query, anchor, standing, testStats)),
    };
  }

  /** The student path: one request answers every tab of a sitting's report, so it is read once. */
  async scoreCard(studentId: string, attemptId: string): Promise<ScoreCard> {
    // Marked is in the WHERE, so a refusal never pays for the nested reads behind the row.
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId, status: ATTEMPT_STATUS.EVALUATED },
      select: SCORE_CARD_SELECT,
    });
    if (!attempt) return this.refuseCard(studentId, attemptId);

    const [testStats, standing] = await Promise.all([
      this.testStats([attempt.testId]),
      this.leaderboard.standing(attempt.testId, attempt.id),
    ]);
    const oneSitting = { scope: PERFORMANCE_SCOPES.ATTEMPT, attemptId: attempt.id };
    const figures = await this.figuresOf(oneSitting, attempt, standing, testStats);
    const { test } = attempt;
    const scopeRef = scopeRefOf(test);
    const score = Number(attempt.score ?? 0);
    const { maxMarks } = figures.composition;

    return {
      ...figures,
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: test.title,
      attemptNo: attempt.attemptNo,
      isGraded: attempt.isGraded,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      evaluatedAt: attempt.evaluatedAt?.toISOString() ?? null,
      score,
      maxMarks,
      percentage: percentageOf(score, maxMarks),
      correctCount: attempt.correctCount ?? 0,
      wrongCount: attempt.wrongCount ?? 0,
      unattemptedCount: attempt.unattemptedCount ?? 0,
      totalQuestions: scopedQuestionCount(test.baseConfig.sections, test.scope, scopeRef),
      timeTakenSec:
        attempt.submittedAt === null ? 0 : elapsedSeconds(attempt.startedAt, attempt.submittedAt),
      durationSec: scopedDurationSec(
        test.baseConfig.sections,
        test.baseConfig,
        test.scope,
        scopeRef,
      ),
      rank: standing?.rank ?? null,
      percentile: standing?.percentile ?? null,
      cohortSize: standing?.cohortSize ?? null,
    };
  }

  /** A handed-in paper beside its cohort in effort alone, so it answers before the marking has run. */
  async fieldEffort(studentId: string, attemptId: string): Promise<FieldEffort> {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId, status: { in: ENDED } },
      select: { id: true, testId: true, attemptNo: true },
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);

    const [testStats, previous] = await Promise.all([
      this.testStats([attempt.testId]),
      // A first attempt has nothing before it, and a whole hall is on its first.
      attempt.attemptNo === 1
        ? null
        : this.prisma.attempt.findFirst({
            where: {
              testId: attempt.testId,
              studentId,
              attemptNo: { lt: attempt.attemptNo },
              status: ATTEMPT_STATUS.EVALUATED,
            },
            orderBy: { attemptNo: 'desc' },
            select: { sectionScores: true },
          }),
    ]);
    const field = await this.fieldOf(attempt.testId, testStats.get(attempt.testId) ?? null);

    return {
      testId: attempt.testId,
      attemptNo: attempt.attemptNo,
      cohortSize: field.cohortSize,
      average: field.average,
      // Themselves drawn as the topper would hand them their rank on a page that carries no marks.
      topper: field.topperStudentId === studentId ? null : field.topper,
      previous: effortIn(previous?.sectionScores),
    };
  }

  /** Held under the rollup's own revision, like the curve: a hall handing in together counts it once. */
  private fieldOf(testId: string, stat: TestStatRow | null): Promise<FieldShape> {
    if (stat === null || stat.evaluatedCount === 0) return Promise.resolve(NO_FIELD);
    return hold(this.fields, `${testId}:${stat.computedAt.getTime()}`, () =>
      fieldEffortOf(this.prisma, testId),
    );
  }

  /** Only a refusal reads this: the owner is in the WHERE, so another student's sitting is missing. */
  private async refuseCard(studentId: string, attemptId: string): Promise<never> {
    const theirs = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: { id: true },
    });
    if (theirs === null) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    throw new AppException(ErrorCodes.CONFLICT, NOT_MARKED);
  }

  /** The anchor's figures alone: the other sittings only ever give the trajectory their marks. */
  private async figuresOf(
    query: PerformanceReportQuery,
    anchor: ReportRow | null,
    standing: Standing | null,
    testStats: ReadonlyMap<string, TestStatRow>,
  ) {
    const stat = anchor === null ? null : (testStats.get(anchor.testId) ?? null);
    const [paper, sheet, sectionCohort, topper, cohort] = await Promise.all([
      anchor === null
        ? []
        : this.prisma.paperQuestion.findMany({
            where: { testId: anchor.testId },
            orderBy: { order: 'asc' },
            select: PERFORMANCE_ROW_SELECT,
          }),
      anchor === null
        ? null
        : this.prisma.attemptSheet.findUnique({
            where: { attemptId: anchor.id },
            select: { answers: true, verdicts: true },
          }),
      this.sectionCohort(anchor),
      anchor === null ? NO_TOPPER : topperOf(this.prisma, anchor.testId),
      this.curveOf(query, anchor, standing, stat),
    ]);
    const rows =
      anchor === null
        ? []
        : toReported(
            servedSheet(paper, { ...anchor, sheet }, anchor.test.baseConfig.shuffleQuestions),
          );

    return {
      cohort,
      composition: compositionOf(rows),
      sections: sectionalStandingOf(sectionsOf(anchor, paper), sectionCohort, topper.bySection),
      time: timeUseOf(rows),
      paceIndex: paceOf(rows, stat),
    };
  }

  /** Only a single paper has a curve: two papers with different marks cannot share a distribution. */
  private async curveOf(
    query: PerformanceReportQuery,
    anchor: ReportRow | null,
    standing: Standing | null,
    stat: TestStatRow | null,
  ): Promise<CohortCurve | null> {
    if (anchor === null || query.scope !== PERFORMANCE_SCOPES.ATTEMPT) return null;

    const score = Number(anchor.score ?? 0);
    // One cohort scan a rollup, not one a reader: the watermark that moved the cohort keys the copy.
    const live = await hold(
      this.curves,
      `${anchor.testId}:${stat?.computedAt.getTime() ?? 0}`,
      () => cohortCurveOf(this.prisma, anchor.testId),
    );

    return {
      testId: anchor.testId,
      score,
      topperScore: live.topperScore,
      averageScore: live.averageScore,
      rank: standing?.rank ?? null,
      percentile: standing?.percentile ?? null,
      cohortSize: standing?.cohortSize ?? live.size,
      bands: flagYours(live.bands, score),
    };
  }

  private async testStats(testIds: readonly string[]): Promise<Map<string, TestStatRow>> {
    if (testIds.length === 0) return new Map();
    const rows = await this.prisma.testStat.findMany({
      where: { testId: { in: [...testIds] } },
      select: TEST_STAT_SELECT,
    });
    return new Map(rows.map((row) => [row.testId, row]));
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

  /** Sitting counts by institute day, since the account opened. No paper is read, ever. */
  async testDays(studentId: string): Promise<TestCalendar> {
    const student = await requireStudent(this.prisma, studentId);
    const from = civilDate(student.createdAt);
    const floor = startOfInstituteDay(from);
    const rows = await this.prisma.attempt.findMany({
      where: {
        studentId,
        status: ATTEMPT_STATUS.EVALUATED,
        submittedAt: { gte: floor },
      },
      select: { submittedAt: true },
    });

    const counted = new Map<string, number>();
    for (const row of rows) {
      if (row.submittedAt === null) continue;
      const day = civilDate(row.submittedAt);
      counted.set(day, (counted.get(day) ?? 0) + 1);
    }
    return { from, days: [...counted].map(([date, sittings]) => ({ date, sittings })) };
  }
}

const TEST_STAT_SELECT = {
  testId: true,
  evaluatedCount: true,
  sumTimeSec: true,
  computedAt: true,
} as const satisfies Prisma.TestStatSelect;

type TestStatRow = Prisma.TestStatGetPayload<{ select: typeof TEST_STAT_SELECT }>;

/** The owner is part of every WHERE, so another student's work reads as missing, not as refused. */
function scopeWhere(studentId: string, query: PerformanceReportQuery): Prisma.AttemptWhereInput {
  const sat = { studentId, status: ATTEMPT_STATUS.EVALUATED };
  return query.scope === PERFORMANCE_SCOPES.ATTEMPT ? { ...sat, id: query.attemptId } : sat;
}

/** The id the scope was answered by, and never one left over from a different scope's field. */
function scopeIdOf(query: PerformanceReportQuery): string | null {
  const field = PERFORMANCE_SCOPE_FIELD[query.scope];
  return field === null ? null : (query[field] ?? null);
}

function toPoint(
  row: ReportRow,
  standing: Standing | undefined,
  rolledCohortSize: number | null,
): PercentilePoint {
  return {
    attemptId: row.id,
    testId: row.testId,
    testTitle: row.test.title,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    percentile: standing?.percentile ?? null,
    rank: standing?.rank ?? null,
    cohortSize: standing?.cohortSize ?? rolledCohortSize,
  };
}

function sectionsOf(
  anchor: ReportRow | null,
  paper: readonly PerformancePaperRow[],
): ScoreCardSection[] {
  if (anchor === null) return [];
  const { test } = anchor;
  return sectionsWithScores(
    scopedSections(test.baseConfig.sections, test.scope, scopeRefOf(test)).map((section) => ({
      ...section,
      marksPerQuestion: Number(section.marksPerQuestion),
    })),
    sectionScoresIn(anchor.sectionScores),
    marksBySection(
      paper.map((row) => ({
        baseConfigSectionId: row.baseConfigSectionId,
        marks: Number(row.marks),
      })),
    ),
  );
}

function toReported(served: readonly (PerformancePaperRow & ServedAnswer)[]): ReportedQuestion[] {
  return served.map((question) => ({
    baseConfigSectionId: question.baseConfigSectionId,
    state: question.state,
    answered: question.selectedOptionId !== null || (question.typedAnswer?.trim() ?? '') !== '',
    isCorrect: question.isCorrect,
    marksAwarded: question.marksAwarded ?? 0,
    timeSpentSec: question.timeSpentSec,
    paperQuestionId: question.id,
    marks: Number(question.marks),
    negativeMarks: Number(question.negativeMarks),
    disposition: question.status,
  }));
}

/** Their whole paper against the cohort's average one. No rollup, no comparison to draw. */
function paceOf(
  rows: readonly ReportedQuestion[],
  paper: { evaluatedCount: number; sumTimeSec: bigint } | null,
): number | null {
  if (paper === null) return null;
  const spent = rows.reduce((total, row) => total + row.timeSpentSec, 0);
  return paceIndexOf(spent, Number(paper.sumTimeSec), paper.evaluatedCount);
}

/**
 * What a student is shown about a sitting they have finished. TWO reads live here and they are not
 * the same: the score card's select never loads `questionVersion`, so no key can reach it; the
 * review's does, and is reachable only past `solutionsAreOpen`. Keep them that way.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  contentLanguageOf,
  type AnswerKey,
  type LanguageCode,
  type LocalizedContent,
  type QuestionOption,
  type AttemptAnalytics,
  type PerformancePoint,
  type PerformanceTrend,
  type ScoreCard,
  type ScoreCardQuestion,
  type SolutionQuestion,
  type SolutionReport,
  type TestScopeRef,
  scopedQuestionCount,
  scopedDurationSec,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { imageUrlsIn } from './exam-images';
import {
  bucketOf,
  bucketsBy,
  byDifficulty,
  strategyOf,
  timeUseOf,
  type AnalysedQuestion,
} from './attempt-analytics';
import { htmlIn, narrowRich, signLocalizedRich, signRich } from './exam-content';
import { seededRandom, shuffle } from '../common/seeded-shuffle';
import { sectionScoresIn } from './score-paper';
import { LeaderboardService } from './leaderboard.service';
import {
  elapsedSeconds,
  marksBySection,
  numberOrNull,
  percentageOf,
  sectionsWithScores,
} from './attempt-report';

const NOT_YOURS = 'No such sitting';

/** The key the whole-paper bucket carries, and the word a screen shows for it. */
const ALL_QUESTIONS = 'Overall';

/** How many sat tests a trend line carries. Beyond this a chart is a smear, not a trend. */
const TREND_LENGTH = 20;
const NOT_REVIEWABLE = 'This paper has not been marked yet, so there is nothing to review.';
const NOT_MARKED = 'This paper has not been marked yet. Its score card opens the moment it is.';

const SCORE_CARD_SELECT = {
  id: true,
  testId: true,
  attemptNo: true,
  isGraded: true,
  status: true,
  startedAt: true,
  submittedAt: true,
  evaluatedAt: true,
  score: true,
  correctCount: true,
  wrongCount: true,
  unattemptedCount: true,
  sectionScores: true,
  lastRank: true,
  lastPercentile: true,
  test: {
    select: {
      title: true,
      scope: true,
      scopeRef: true,
      baseConfig: {
        select: {
          durationSec: true,
          totalQuestions: true,
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
  questions: {
    select: {
      questionId: true,
      order: true,
      baseConfigSectionId: true,
      state: true,
      selectedOptionId: true,
      typedAnswer: true,
      isCorrect: true,
      marksAwarded: true,
      timeSpentSec: true,
      paperItem: { select: { marks: true, negativeMarks: true, status: true } },
    },
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.AttemptSelect;

/** The score card's read plus the question meta every figure is bucketed by. No key, still. */
const ANALYTICS_SELECT = {
  ...SCORE_CARD_SELECT,
  questions: {
    select: {
      ...SCORE_CARD_SELECT.questions.select,
      question: { select: { difficulty: true, subject: { select: { id: true, name: true } } } },
    },
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.AttemptSelect;

/** What the GATE needs, and nothing else — this read happens before anybody has been let in. */
const GATE_SELECT = {
  id: true,
  testId: true,
  status: true,
  test: { select: { evaluationMode: true, baseConfig: { select: { durationSec: true } } } },
} as const satisfies Prisma.AttemptSelect;

/** The KEY. Reached only past `solutionsAreOpen`, which is why it is a second read and not a join. */
const SOLUTION_SELECT = {
  id: true,
  testId: true,
  languages: true,
  shuffleSeed: true,
  test: {
    select: {
      title: true,
      baseConfig: {
        select: {
          shuffleOptions: true,
          sections: {
            select: {
              id: true,
              name: true,
              order: true,
              questionCount: true,
              durationSec: true,
            },
            orderBy: { order: 'asc' },
          },
        },
      },
    },
  },
  questions: {
    select: {
      ...SCORE_CARD_SELECT.questions.select,
      question: { select: { type: true } },
      questionVersion: { select: { content: true, options: true, answerKey: true } },
    },
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.AttemptSelect;

type ScoreCardRow = Prisma.AttemptGetPayload<{ select: typeof SCORE_CARD_SELECT }>;
type AnalyticsRow = Prisma.AttemptGetPayload<{ select: typeof ANALYTICS_SELECT }>;
type SolutionRow = Prisma.AttemptGetPayload<{ select: typeof SOLUTION_SELECT }>;

@Injectable()
export class AttemptReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
    private readonly storage: StorageService,
  ) {}

  async scoreCard(studentId: string, attemptId: string): Promise<ScoreCard> {
    const attempt = await this.require(studentId, attemptId);
    if (attempt.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_MARKED);
    }

    const config = attempt.test.baseConfig;
    const questions = attempt.questions.map(toScoreCardQuestion);
    const perSection = marksBySection(questions);

    const standing = await this.leaderboard.liveStanding(attempt.testId, attempt.id);
    const score = Number(attempt.score ?? 0);
    const maxMarks = round([...perSection.values()].reduce((sum, marks) => sum + marks, 0));

    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: attempt.test.title,
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
      totalQuestions: scopedQuestionCount(
        config.sections,
        attempt.test.scope,
        (attempt.test.scopeRef as TestScopeRef | null) ?? null,
      ),
      timeTakenSec:
        attempt.submittedAt === null ? 0 : elapsedSeconds(attempt.startedAt, attempt.submittedAt),
      durationSec: scopedDurationSec(
        config.sections,
        config,
        attempt.test.scope,
        (attempt.test.scopeRef as TestScopeRef | null) ?? null,
      ),
      // The snapshot only where the live board could not answer, so a screen is never blank.
      rank: standing?.rank ?? attempt.lastRank,
      percentile: standing?.percentile ?? numberOrNull(attempt.lastPercentile),
      cohortSize: standing?.cohortSize ?? null,
      sections: sectionsWithScores(
        config.sections.map((section) => ({
          ...section,
          marksPerQuestion: Number(section.marksPerQuestion),
        })),
        sectionScoresIn(attempt.sectionScores),
        perSection,
      ),
      questions,
    };
  }

  /** How the paper was sat, derived from what the exam wrote. Same gate as the score card. */
  async analytics(studentId: string, attemptId: string): Promise<AttemptAnalytics> {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: ANALYTICS_SELECT,
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    if (attempt.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_MARKED);
    }

    const sections = new Map(
      attempt.test.baseConfig.sections.map((section) => [section.id, section.name]),
    );
    const rows = attempt.questions.map(toAnalysed);
    const [standing, cohort] = await Promise.all([
      this.leaderboard.liveStanding(attempt.testId, attempt.id),
      this.cohortOf(attempt.testId),
    ]);

    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: attempt.test.title,
      overall: bucketOf(ALL_QUESTIONS, ALL_QUESTIONS, rows),
      sections: bucketsBy(
        rows,
        (row) => row.baseConfigSectionId,
        (row) => sections.get(row.baseConfigSectionId) ?? row.baseConfigSectionId,
      ),
      subjects: bucketsBy(
        rows,
        (row) => row.subjectId,
        (row) => row.subjectName,
      ),
      difficulty: byDifficulty(rows),
      time: timeUseOf(rows),
      strategy: strategyOf(rows),
      cohort: {
        score: Number(attempt.score ?? 0),
        topperScore: cohort.topperScore,
        averageScore: cohort.averageScore,
        rank: standing?.rank ?? attempt.lastRank,
        percentile: standing?.percentile ?? numberOrNull(attempt.lastPercentile),
        cohortSize: standing?.cohortSize ?? cohort.size,
      },
    };
  }

  /** Every test this student has sat, oldest first — the line a trend chart draws. */
  async performance(studentId: string): Promise<PerformanceTrend> {
    const sat = await this.prisma.attempt.findMany({
      where: { studentId, status: ATTEMPT_STATUS.EVALUATED },
      orderBy: { submittedAt: 'desc' },
      take: TREND_LENGTH,
      select: TREND_SELECT,
    });

    const tests = await this.prisma.attempt.findMany({
      where: { studentId, status: ATTEMPT_STATUS.EVALUATED },
      distinct: ['testId'],
      select: { testId: true },
    });

    return { testsSat: tests.length, points: [...sat].reverse().map(toPerformancePoint) };
  }

  /** One indexed aggregate, off the report path's own budget — never off a live sitting's. */
  private cohortOf(testId: string) {
    return cohortAggregate(this.prisma, testId);
  }

  /** The answer key. Only a sitting the student finished and had marked ever reaches it. */
  async solutions(studentId: string, attemptId: string): Promise<SolutionReport> {
    const gate = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: GATE_SELECT,
    });
    if (!gate) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    if (gate.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_REVIEWABLE);
    }

    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: SOLUTION_SELECT,
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);

    // The same seed the exam used, so the option they remember as "C" is "C" in the review too.
    const random = seededRandom(attempt.shuffleSeed);
    const shuffleOptions = attempt.test.baseConfig.shuffleOptions;
    const questions = attempt.questions.map((row) =>
      toSolutionQuestion(row, attempt.languages, shuffleOptions, random),
    );
    const urls = await imageUrlsIn(this.storage, questions.flatMap(htmlOf));

    return {
      attemptId: attempt.id,
      testId: attempt.testId,
      testTitle: attempt.test.title,
      languages: attempt.languages,
      sections: attempt.test.baseConfig.sections.map((section) => ({
        id: section.id,
        name: section.name,
        order: section.order,
        questionCount: section.questionCount,
        durationSec: section.durationSec,
      })),
      questions: urls.size === 0 ? questions : questions.map((row) => signed(row, urls)),
    };
  }

  /** The owner is part of the QUERY, so another student's sitting reads as missing, not refused. */
  private async require(studentId: string, attemptId: string): Promise<ScoreCardRow> {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: SCORE_CARD_SELECT,
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    return attempt;
  }
}

function toScoreCardQuestion(row: ScoreCardRow['questions'][number]): ScoreCardQuestion {
  return {
    questionId: row.questionId,
    order: row.order,
    baseConfigSectionId: row.baseConfigSectionId,
    state: row.state,
    selectedOptionId: row.selectedOptionId,
    typedAnswer: row.typedAnswer,
    isCorrect: row.isCorrect,
    marksAwarded: numberOrNull(row.marksAwarded),
    marks: Number(row.paperItem?.marks ?? 0),
    negativeMarks: Number(row.paperItem?.negativeMarks ?? 0),
    disposition: row.paperItem?.status ?? PAPER_QUESTION_STATUS.ACTIVE,
    timeSpentSec: row.timeSpentSec,
  };
}

/** Shared with the performance report, so the two can never disagree about who the topper is. */
export async function cohortAggregate(prisma: PrismaService, testId: string) {
  const cohort = await prisma.attempt.aggregate({
    where: { testId, isGraded: true, status: ATTEMPT_STATUS.EVALUATED, score: { not: null } },
    _avg: { score: true },
    _max: { score: true },
    _count: true,
  });
  return {
    topperScore: numberOrNull(cohort._max.score),
    averageScore: cohort._avg.score === null ? null : round(Number(cohort._avg.score)),
    size: cohort._count,
  };
}

const round = (value: number) => Math.round(value * 100) / 100;

function toSolutionQuestion(
  row: SolutionRow['questions'][number],
  languages: readonly LanguageCode[],
  shuffleOptions: boolean,
  random: () => number,
): SolutionQuestion {
  const stored = (row.questionVersion.options as QuestionOption[] | null) ?? [];
  const options = stored.map((option) => ({ ...option, text: narrowRich(option.text, languages) }));
  return {
    ...toScoreCardQuestion(row),
    type: row.question.type,
    content: narrowContent(row.questionVersion.content as LocalizedContent | null, languages),
    options: shuffleOptions ? shuffle(options, random) : options,
    answerKey: (row.questionVersion.answerKey as AnswerKey | null) ?? null,
  };
}

/** Stem AND solution, unlike the exam paper — explaining the answer is the whole point here. */
function narrowContent(
  content: LocalizedContent | null,
  languages: readonly LanguageCode[],
): LocalizedContent {
  const kept: LocalizedContent = {};
  for (const code of languages) {
    const key = contentLanguageOf(code);
    const held = content?.[key];
    if (held) kept[key] = held;
  }
  return kept;
}

/** Every piece of HTML one reviewed question carries — stem, solution and every option. */
function htmlOf(question: SolutionQuestion): string[] {
  const content = Object.values(question.content).flatMap((held) => [
    ...htmlIn(held?.stem),
    ...htmlIn(held?.solution),
  ]);
  const options = question.options.flatMap((option) =>
    Object.values(option.text).flatMap((nodes) => htmlIn(nodes)),
  );
  return [...content, ...options];
}

function signed(question: SolutionQuestion, urls: ReadonlyMap<string, string>): SolutionQuestion {
  return {
    ...question,
    content: Object.fromEntries(
      Object.entries(question.content).map(([language, held]) => [
        language,
        // `solution` is optional, so it is added back only where there was one to sign.
        held
          ? {
              stem: signRich(held.stem, urls),
              ...(held.solution ? { solution: signRich(held.solution, urls) } : {}),
            }
          : held,
      ]),
    ),
    options: question.options.map((option) => ({
      ...option,
      text: signLocalizedRich(option.text, urls),
    })),
  };
}

const TREND_SELECT = {
  id: true,
  attemptNo: true,
  testId: true,
  submittedAt: true,
  score: true,
  correctCount: true,
  wrongCount: true,
  lastRank: true,
  lastPercentile: true,
  test: { select: { title: true, evaluationMode: true } },
  // The PAPER's own marks, so one sitting cannot read one percentage here and another on its card.
  questions: { select: { paperItem: { select: { marks: true } } } },
} as const satisfies Prisma.AttemptSelect;

type TrendRow = Prisma.AttemptGetPayload<{ select: typeof TREND_SELECT }>;

function toPerformancePoint(row: TrendRow): PerformancePoint {
  const score = Number(row.score ?? 0);
  const maxMarks = round(
    row.questions.reduce((sum, question) => sum + Number(question.paperItem?.marks ?? 0), 0),
  );
  const attempted = (row.correctCount ?? 0) + (row.wrongCount ?? 0);
  return {
    attemptId: row.id,
    attemptNo: row.attemptNo,
    testId: row.testId,
    testTitle: row.test.title,
    evaluationMode: row.test.evaluationMode,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    score,
    maxMarks,
    percentage: percentageOf(score, maxMarks),
    accuracy: attempted === 0 ? 0 : round(((row.correctCount ?? 0) / attempted) * 100),
    rank: row.lastRank,
    percentile: numberOrNull(row.lastPercentile),
  };
}

function toAnalysed(row: AnalyticsRow['questions'][number]): AnalysedQuestion {
  return {
    baseConfigSectionId: row.baseConfigSectionId,
    subjectId: row.question.subject.id,
    subjectName: row.question.subject.name,
    difficulty: row.question.difficulty,
    state: row.state,
    answered: row.selectedOptionId !== null || (row.typedAnswer?.trim() ?? '') !== '',
    isCorrect: row.isCorrect,
    marksAwarded: Number(row.marksAwarded ?? 0),
    timeSpentSec: row.timeSpentSec,
  };
}

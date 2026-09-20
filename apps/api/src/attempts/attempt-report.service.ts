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
  type AnswerKey,
  type LanguageCode,
  type LocalizedContent,
  type QuestionOption,
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
import { servedSheet, type ServedAnswer } from './answer-sheet';
import { imageUrlsIn } from './exam-images';
import { htmlOfQuestion, narrowTo, signedQuestion } from './exam-content';
import { seededRandom, shuffle } from '../common/seeded-shuffle';
import { SHEET_ROW_SELECT } from './paper-sheet.service';
import { sectionScoresIn } from './score-paper';
import { LeaderboardService, type Standing } from './leaderboard.service';
import {
  elapsedSeconds,
  marksBySection,
  roundHundredths as round,
  percentageOf,
  sectionsWithScores,
} from './attempt-report';

const NOT_YOURS = 'No such sitting';

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
  shuffleSeed: true,
  sheet: { select: { answers: true, verdicts: true } },
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

/** The paper's own terms per row; every sitting of a test was served the whole of it. */
const PRICED_ROW_SELECT = {
  ...SHEET_ROW_SELECT,
  marks: true,
  negativeMarks: true,
  status: true,
} as const satisfies Prisma.PaperQuestionSelect;

type PricedRow = Prisma.PaperQuestionGetPayload<{ select: typeof PRICED_ROW_SELECT }> &
  ServedAnswer;

/** What the GATE needs, and nothing else — this read happens before anybody has been let in. */
const GATE_SELECT = {
  id: true,
  testId: true,
  status: true,
  test: { select: { baseConfig: { select: { durationSec: true } } } },
} as const satisfies Prisma.AttemptSelect;

/** The KEY. Reached only past `solutionsAreOpen`, which is why it is a second read and not a join. */
const SOLUTION_SELECT = {
  id: true,
  testId: true,
  languages: true,
  startedAt: true,
  shuffleSeed: true,
  sheet: { select: { answers: true, verdicts: true } },
  test: {
    select: {
      title: true,
      baseConfig: {
        select: {
          shuffleOptions: true,
          shuffleQuestions: true,
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
} as const satisfies Prisma.AttemptSelect;

const SOLUTION_ROW_SELECT = {
  ...PRICED_ROW_SELECT,
  question: { select: { type: true } },
  questionVersion: { select: { content: true, options: true, answerKey: true } },
} as const satisfies Prisma.PaperQuestionSelect;

type SolutionRow = Prisma.PaperQuestionGetPayload<{ select: typeof SOLUTION_ROW_SELECT }> &
  ServedAnswer;

type ScoreCardRow = Prisma.AttemptGetPayload<{ select: typeof SCORE_CARD_SELECT }>;

@Injectable()
export class AttemptReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
    private readonly storage: StorageService,
  ) {}

  async scoreCard(studentId: string, attemptId: string): Promise<ScoreCard> {
    // A whole hall polls this until marking lands, so the refusal is answered before the wide read.
    await this.requireMarked(studentId, attemptId);

    const attempt = await this.require(studentId, attemptId);
    if (attempt.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_MARKED);
    }

    const config = attempt.test.baseConfig;
    const paper = await this.prisma.paperQuestion.findMany({
      where: { testId: attempt.testId },
      orderBy: { order: 'asc' },
      select: PRICED_ROW_SELECT,
    });
    const questions = servedSheet(paper, attempt, config.shuffleQuestions).map(toScoreCardQuestion);
    const perSection = marksBySection(questions);

    const standing = await this.leaderboard.standing(attempt.testId, attempt.id);
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
      rank: standing?.rank ?? null,
      percentile: standing?.percentile ?? null,
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

  /** Every test this student has sat, oldest first — the line a trend chart draws. */
  async performance(studentId: string): Promise<PerformanceTrend> {
    const [sat, tests, standings] = await Promise.all([
      this.prisma.attempt.findMany({
        where: { studentId, status: ATTEMPT_STATUS.EVALUATED },
        orderBy: { submittedAt: 'desc' },
        take: TREND_LENGTH,
        select: TREND_SELECT,
      }),
      this.prisma.attempt.findMany({
        where: { studentId, status: ATTEMPT_STATUS.EVALUATED },
        distinct: ['testId'],
        select: { testId: true },
      }),
      this.leaderboard.standingsOfStudent(studentId),
    ]);

    return {
      testsSat: tests.length,
      points: [...sat].reverse().map((row) => toPerformancePoint(row, standings.get(row.id))),
    };
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
    const paper = await this.prisma.paperQuestion.findMany({
      where: { testId: attempt.testId },
      orderBy: { order: 'asc' },
      select: SOLUTION_ROW_SELECT,
    });
    const questions = servedSheet(paper, attempt, attempt.test.baseConfig.shuffleQuestions).map(
      (row) => toSolutionQuestion(row, attempt.languages, shuffleOptions, random),
    );
    const urls = await imageUrlsIn(this.storage, questions.flatMap(htmlOfQuestion));

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
      questions: questions.map((row) => signedQuestion(row, urls)),
    };
  }

  /** The poll's whole cost: the status off the primary key, with no sheet and no paper behind it. */
  private async requireMarked(studentId: string, attemptId: string): Promise<void> {
    const attempt = await this.prisma.attempt.findFirst({
      where: { id: attemptId, studentId },
      select: { status: true },
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    if (attempt.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_MARKED);
    }
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

function toScoreCardQuestion(row: PricedRow): ScoreCardQuestion {
  return {
    questionId: row.questionId,
    order: row.order,
    baseConfigSectionId: row.baseConfigSectionId,
    state: row.state,
    selectedOptionId: row.selectedOptionId,
    typedAnswer: row.typedAnswer,
    isCorrect: row.isCorrect,
    marksAwarded: row.marksAwarded,
    marks: Number(row.marks),
    negativeMarks: Number(row.negativeMarks),
    disposition: row.status,
    timeSpentSec: row.timeSpentSec,
  };
}

function toSolutionQuestion(
  row: SolutionRow,
  languages: readonly LanguageCode[],
  shuffleOptions: boolean,
  random: () => number,
): SolutionQuestion {
  const stored = (row.questionVersion.options as QuestionOption[] | null) ?? [];
  const options = stored.map((option) => ({ ...option, text: narrowTo(option.text, languages) }));
  return {
    ...toScoreCardQuestion(row),
    type: row.question.type,
    // Stem AND solution, unlike the exam paper — explaining the answer is the whole point here.
    content: narrowTo(row.questionVersion.content as LocalizedContent | null, languages),
    options: shuffleOptions ? shuffle(options, random) : options,
    answerKey: (row.questionVersion.answerKey as AnswerKey | null) ?? null,
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
  // The PAPER's own marks, so one sitting cannot read one percentage here and another on its card.
  test: { select: { title: true, paperQuestions: { select: { marks: true } } } },
} as const satisfies Prisma.AttemptSelect;

type TrendRow = Prisma.AttemptGetPayload<{ select: typeof TREND_SELECT }>;

/** A retake is outside the cohort, so it has no standing and plots no rank or percentile. */
function toPerformancePoint(row: TrendRow, standing: Standing | undefined): PerformancePoint {
  const score = Number(row.score ?? 0);
  const maxMarks = round(
    row.test.paperQuestions.reduce((sum, question) => sum + Number(question.marks), 0),
  );
  const attempted = (row.correctCount ?? 0) + (row.wrongCount ?? 0);
  return {
    attemptId: row.id,
    attemptNo: row.attemptNo,
    testId: row.testId,
    testTitle: row.test.title,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    score,
    maxMarks,
    percentage: percentageOf(score, maxMarks),
    accuracy: attempted === 0 ? 0 : round(((row.correctCount ?? 0) / attempted) * 100),
    rank: standing?.rank ?? null,
    percentile: standing?.percentile ?? null,
  };
}

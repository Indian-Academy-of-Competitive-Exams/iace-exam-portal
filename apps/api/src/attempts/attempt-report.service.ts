/**
 * What a student is shown about a sitting they have finished. The SELECT is the security boundary:
 * it never loads `questionVersion`, so no answer key exists in this file to leak. What the right
 * answer was rides only on the gated Solution Report.
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  PAPER_QUESTION_STATUS,
  type ScoreCard,
  type ScoreCardQuestion,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService } from '../access';
import { sectionScoresIn } from './score-paper';
import { LeaderboardService } from './leaderboard.service';
import {
  elapsedSeconds,
  isProvisional,
  lastSittingEndsAt,
  marksBySection,
  percentageOf,
  sectionsWithScores,
} from './attempt-report';

const NOT_YOURS = 'No such sitting';
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
      baseConfig: {
        select: {
          durationSec: true,
          totalQuestions: true,
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

type ScoreCardRow = Prisma.AttemptGetPayload<{ select: typeof SCORE_CARD_SELECT }>;

@Injectable()
export class AttemptReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessResolverService,
    private readonly leaderboard: LeaderboardService,
  ) {}

  async scoreCard(
    studentId: string,
    attemptId: string,
    now: Date = new Date(),
  ): Promise<ScoreCard> {
    const attempt = await this.require(studentId, attemptId);
    if (attempt.status !== ATTEMPT_STATUS.EVALUATED) {
      throw new AppException(ErrorCodes.CONFLICT, NOT_MARKED);
    }

    const config = attempt.test.baseConfig;
    const questions = attempt.questions.map(toScoreCardQuestion);
    const perSection = marksBySection(questions);

    // Finality is not one branch's business: while ANY branch can still let somebody in, it moves.
    const closing = await this.access.entryClosesAt(attempt.testId);
    const endsAt = lastSittingEndsAt(
      closing?.closesAt ?? null,
      config.durationSec,
      closing?.extraTimeSec ?? null,
    );
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
      totalQuestions: config.totalQuestions,
      timeTakenSec:
        attempt.submittedAt === null ? 0 : elapsedSeconds(attempt.startedAt, attempt.submittedAt),
      durationSec: config.durationSec,
      // The snapshot only where the live board could not answer, so a screen is never blank.
      rank: standing?.rank ?? attempt.lastRank,
      percentile: standing?.percentile ?? numberOrNull(attempt.lastPercentile),
      cohortSize: standing?.cohortSize ?? null,
      provisional: isProvisional(endsAt, now),
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

const numberOrNull = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

const round = (value: number) => Math.round(value * 100) / 100;

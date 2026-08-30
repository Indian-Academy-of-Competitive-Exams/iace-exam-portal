/** Evaluation, off every request path, and repeatable: scoring twice writes the same rows. */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  PAPER_QUESTION_STATUS,
  QUESTION_TYPE,
  type AnswerKey,
  type AttemptStatus,
  type QuestionOption,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, type ScoringJobData } from '../queue/queues';
import { LeaderboardService } from './leaderboard.service';
import { scorePaper, type PaperScore, type ScorableQuestion } from './score-paper';

const SCORING_SELECT = {
  id: true,
  testId: true,
  status: true,
  isGraded: true,
  startedAt: true,
  submittedAt: true,
  questions: {
    select: {
      questionId: true,
      baseConfigSectionId: true,
      selectedOptionId: true,
      typedAnswer: true,
      timeSpentSec: true,
      question: { select: { type: true } },
      questionVersion: { select: { options: true, answerKey: true } },
      paperItem: { select: { marks: true, negativeMarks: true, status: true } },
    },
    orderBy: { order: 'asc' },
  },
} as const satisfies Prisma.AttemptSelect;

type ScoringRow = Prisma.AttemptGetPayload<{ select: typeof SCORING_SELECT }>;
type ServedRow = ScoringRow['questions'][number];

/** Ended, however it ended. Re-scoring an EVALUATED sitting is how a dropped question is applied. */
const SCORABLE: readonly AttemptStatus[] = [ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.EVALUATED];

@Processor(QUEUE_NAMES.SCORING)
export class ScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoringProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
  ) {
    super();
  }

  async process(job: Job<ScoringJobData>): Promise<void> {
    await this.score(job.data.attemptId);
  }

  /** Null when there was nothing to score — a missing sitting, or one still being sat. */
  async score(attemptId: string): Promise<PaperScore | null> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: SCORING_SELECT,
    });
    if (!attempt) {
      this.logger.warn(`Scoring asked for attempt ${attemptId}, which does not exist`);
      return null;
    }
    if (!SCORABLE.includes(attempt.status)) return null;

    const unpriced = attempt.questions.filter((row) => row.paperItem === null).length;
    if (unpriced > 0) {
      this.logger.error(`Attempt ${attemptId} has ${unpriced} questions the paper never priced`);
    }

    const scored = scorePaper(attempt.questions.map(toScorable));
    await this.persist(attemptId, scored);
    await this.leaderboard.rank({
      id: attempt.id,
      testId: attempt.testId,
      isGraded: attempt.isGraded,
      score: scored.score,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
    });
    return scored;
  }

  /** One transaction: a sitting whose totals and per-question marks disagree is worse than neither. */
  private async persist(attemptId: string, scored: PaperScore): Promise<void> {
    await this.prisma.$transaction([
      ...this.markQuestions(attemptId, scored),
      // Claimed, never rewritten: two racing workers must not disagree about when this was scored.
      this.prisma.attempt.updateMany({
        where: { id: attemptId, evaluatedAt: null },
        data: { evaluatedAt: new Date() },
      }),
      this.prisma.attempt.update({
        where: { id: attemptId },
        data: {
          status: ATTEMPT_STATUS.EVALUATED,
          score: scored.score,
          correctCount: scored.correctCount,
          wrongCount: scored.wrongCount,
          unattemptedCount: scored.unattemptedCount,
          sectionScores: scored.sections,
        },
      }),
    ]);
  }

  /** One statement per distinct outcome, not per question: a 100-mark paper has a handful. */
  private markQuestions(attemptId: string, scored: PaperScore) {
    const buckets = new Map<string, { row: (typeof scored.questions)[number]; ids: string[] }>();
    for (const question of scored.questions) {
      const outcome = `${String(question.isCorrect)}:${question.marksAwarded}`;
      const held = buckets.get(outcome) ?? { row: question, ids: [] };
      held.ids.push(question.questionId);
      buckets.set(outcome, held);
    }

    return [...buckets.values()].map((bucket) =>
      this.prisma.attemptQuestion.updateMany({
        where: { attemptId, questionId: { in: bucket.ids } },
        data: { isCorrect: bucket.row.isCorrect, marksAwarded: bucket.row.marksAwarded },
      }),
    );
  }
}

/** A row with no paper item is worth nothing, which is what a question nobody priced is worth. */
function toScorable(row: ServedRow): ScorableQuestion {
  return {
    questionId: row.questionId,
    baseConfigSectionId: row.baseConfigSectionId,
    type: row.question.type,
    marks: Number(row.paperItem?.marks ?? 0),
    negativeMarks: Number(row.paperItem?.negativeMarks ?? 0),
    status: row.paperItem?.status ?? PAPER_QUESTION_STATUS.ACTIVE,
    correctOptionIds: correctOptionIdsIn(row.questionVersion.options),
    answerKey: row.question.type === QUESTION_TYPE.TEXT_FIELD ? answerKeyIn(row) : null,
    selectedOptionId: row.selectedOptionId,
    typedAnswer: row.typedAnswer,
    timeSpentSec: row.timeSpentSec,
  };
}

function correctOptionIdsIn(options: Prisma.JsonValue): string[] {
  if (!Array.isArray(options)) return [];
  return (options as unknown as QuestionOption[])
    .filter((option) => option?.isCorrect === true && typeof option.id === 'string')
    .map((option) => option.id);
}

function answerKeyIn(row: ServedRow): AnswerKey | null {
  const key = row.questionVersion.answerKey;
  if (typeof key !== 'object' || key === null || Array.isArray(key)) return null;
  return key as unknown as AnswerKey;
}

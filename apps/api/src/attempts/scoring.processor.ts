/** Evaluation, off every request path, and repeatable: scoring twice writes the same rows. */
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  NOTIFICATION_TYPE,
  PAPER_QUESTION_STATUS,
  QUESTION_TYPE,
  type AnswerKey,
  type AttemptStatus,
  type QuestionOption,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, QUEUE_POLICY, type ScoringJobData } from '../queue/queues';
import { LeaderboardService } from './leaderboard.service';
import { LEADERBOARD_MAX_TIME_SEC, timeTakenSec } from './leaderboard-score';
import { ROLLUP_REQUEST, RollupOutbox } from './rollup-outbox';
import { NotificationOutbox } from '../notifications';
import { DOMAIN_EVENTS, DomainEventBus } from '../common/events';
import { scorePaper, type PaperScore, type ScorableQuestion } from './score-paper';

const SCORING_SELECT = {
  id: true,
  testId: true,
  studentId: true,
  status: true,
  // What they were shown last. A re-score that lands on the same number is not news.
  score: true,
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

/** What the write did: whether the marks landed at all, and the event a FIRST evaluation raised. */
interface Written {
  applied: boolean;
  evaluation: string | null;
}

/** Ended, however it ended. Re-scoring an EVALUATED sitting is how a dropped question is applied. */
const SCORABLE = new Set<AttemptStatus>([ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.EVALUATED]);

@Processor(QUEUE_NAMES.SCORING, { concurrency: QUEUE_POLICY[QUEUE_NAMES.SCORING].concurrency })
export class ScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoringProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leaderboard: LeaderboardService,
    private readonly rollup: RollupOutbox,
    private readonly events: DomainEventBus,
    private readonly notifications: NotificationOutbox,
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
    if (!SCORABLE.has(attempt.status)) return null;

    const unpriced = attempt.questions.filter((row) => row.paperItem === null).length;
    if (unpriced > 0) {
      this.logger.error(`Attempt ${attemptId} has ${unpriced} questions the paper never priced`);
    }

    const scored = scorePaper(attempt.questions.map(toScorable));
    const written = await this.persist(attempt, scored);
    // Stood down while this ran: ranking it now would put a void sitting back on the board.
    if (!written.applied) return null;

    const evaluation = written.evaluation;
    await this.leaderboard.rank({
      id: attempt.id,
      testId: attempt.testId,
      isGraded: attempt.isGraded,
      score: scored.score,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
    });
    await this.count(attempt.testId, evaluation);
    // Only a FIRST evaluation: a dropped question re-scores every sitting, and nobody wants that twice.
    if (evaluation !== null) {
      this.events.emit(DOMAIN_EVENTS.SCORING_COMPLETED, {
        attemptId: attempt.id,
        testId: attempt.testId,
        studentId: attempt.studentId,
        isGraded: attempt.isGraded,
      });
    }
    return scored;
  }

  /** A first evaluation is folded in; a re-score moved marks already counted, so it asks for a rebuild. */
  private async count(testId: string, evaluation: string | null): Promise<void> {
    const asked = evaluation === null ? this.rollup.rebuild(testId) : this.rollup.relay(evaluation);
    // A queue nobody can reach must not fail a score that committed — the sweeper hands it on.
    await asked.catch((error: unknown) => {
      this.logger.error(`Attempt on test ${testId} was scored but not counted`, error);
    });
  }

  /** One transaction: a sitting whose totals and per-question marks disagree is worse than neither. */
  private async persist(attempt: ScoringRow, scored: PaperScore): Promise<Written> {
    return this.prisma.$transaction(async (tx) => {
      await this.markQuestions(tx, attempt.id, scored);
      // Claimed, never rewritten: two racing workers must not disagree about when this was scored.
      const claimed = await tx.attempt.updateMany({
        where: { id: attempt.id, evaluatedAt: null, status: { in: [...SCORABLE] } },
        data: { evaluatedAt: new Date() },
      });
      // Guarded on the status this run READ: a void landing mid-score must not be written back.
      const marked = await tx.attempt.updateMany({
        where: { id: attempt.id, status: { in: [...SCORABLE] } },
        data: {
          status: ATTEMPT_STATUS.EVALUATED,
          score: scored.score,
          correctCount: scored.correctCount,
          wrongCount: scored.wrongCount,
          unattemptedCount: scored.unattemptedCount,
          sectionScores: scored.sections,
          timeTakenSec: Math.min(
            timeTakenSec(attempt.startedAt, attempt.submittedAt),
            LEADERBOARD_MAX_TIME_SEC,
          ),
        },
      });
      if (marked.count === 0) return { applied: false, evaluation: null };
      // The claim's row count IS the signal: one row means nothing had evaluated this before.
      if (claimed.count === 1) {
        return { applied: true, evaluation: await this.announce(tx, attempt) };
      }

      await this.announceCorrection(tx, attempt, scored.score);
      return { applied: true, evaluation: null };
    });
  }

  /** Written with the score's own transaction: an evaluated sitting always carries one of these. */
  private async announce(tx: Prisma.TransactionClient, attempt: ScoringRow): Promise<string> {
    const row = await tx.outboxEvent.create({
      data: {
        aggregateType: ROLLUP_REQUEST.AGGREGATE_TYPE,
        aggregateId: attempt.id,
        eventType: ROLLUP_REQUEST.EVENT_TYPE,
        payload: {
          testId: attempt.testId,
          studentId: attempt.studentId,
          isGraded: attempt.isGraded,
        },
      },
      select: { id: true },
    });

    // Same transaction as the marks: a student whose result committed is always one we owe a word to.
    await this.notifications.request(tx, {
      studentId: attempt.studentId,
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your result is ready',
      body: 'Open the test to see your score, rank and answers.',
      dedupeKey: `result:${attempt.id}`,
      testId: attempt.testId,
    });

    return row.id;
  }

  /** A re-score, which only a drop or a bonus causes. Silent where the marks did not actually move. */
  private async announceCorrection(
    tx: Prisma.TransactionClient,
    attempt: ScoringRow,
    score: number,
  ): Promise<void> {
    if (Number(attempt.score ?? 0) === score) return;

    await this.notifications.request(tx, {
      studentId: attempt.studentId,
      type: NOTIFICATION_TYPE.RESULT_UPDATED,
      title: 'Your result has been updated',
      body: 'A question on this paper was reviewed, so your marks and rank have been worked out again.',
      // Keyed on the NEW total: a second correction that moves them again is its own news.
      dedupeKey: `result-updated:${attempt.id}:${score}`,
      testId: attempt.testId,
    });
  }

  /** One statement per distinct outcome, not per question: a 100-mark paper has a handful. */
  private async markQuestions(
    tx: Prisma.TransactionClient,
    attemptId: string,
    scored: PaperScore,
  ): Promise<void> {
    const buckets = new Map<string, { row: (typeof scored.questions)[number]; ids: string[] }>();
    for (const question of scored.questions) {
      const outcome = `${String(question.isCorrect)}:${question.marksAwarded}`;
      const held = buckets.get(outcome) ?? { row: question, ids: [] };
      held.ids.push(question.questionId);
      buckets.set(outcome, held);
    }

    for (const bucket of buckets.values()) {
      await tx.attemptQuestion.updateMany({
        where: { attemptId, questionId: { in: bucket.ids } },
        data: { isCorrect: bucket.row.isCorrect, marksAwarded: bucket.row.marksAwarded },
      });
    }
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

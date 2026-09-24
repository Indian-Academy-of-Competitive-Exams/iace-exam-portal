/** Evaluation, off every request path, and repeatable: scoring twice writes the same rows. */
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { type Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  NOTIFICATION_TYPE,
  QUESTION_TYPE,
  type AttemptStatus,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NAMES, QUEUE_POLICY, type ScoringJobData } from '../queue/queues';
import { timeTakenSec } from './leaderboard-score';
import { ROLLUP_REQUEST, RollupOutbox } from './rollup-outbox';
import { NotificationOutbox } from '../notifications';
import { packedSections, scorePaper, type PaperScore, type ScorableQuestion } from './score-paper';
import { QueueFailures } from '../common/metrics/queue-failures';
import { decodeAnswer, sheetIn, verdictsOf } from './answer-sheet';
import { PaperSheetService, type PaperTerm } from './paper-sheet.service';

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
  // The scoring terms' cache key: a disposition bumps it, so a warm copy cannot hide a drop.
  test: { select: { paperRevision: true } },
  sheet: { select: { answers: true } },
} as const satisfies Prisma.AttemptSelect;

type ScoringRow = Prisma.AttemptGetPayload<{ select: typeof SCORING_SELECT }>;

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
    private readonly rollup: RollupOutbox,
    private readonly notifications: NotificationOutbox,
    private readonly failures: QueueFailures,
    private readonly papers: PaperSheetService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.failures.record(QUEUE_NAMES.SCORING, job, error);
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

    const terms = await this.papers.termsOf(attempt.testId, attempt.test.paperRevision);
    const scored = scorePaper(scorableOf(attempt, terms));
    const written = await this.persist(attempt, scored, terms);
    // Stood down while this ran: counting it now would fold a void sitting back in.
    if (!written.applied) return null;

    await this.count(attempt.testId, written.evaluation);
    return scored;
  }

  /** A first evaluation is folded in; a re-score moved marks already counted, so it asks for a rebuild. */
  private async count(testId: string, evaluation: string | null): Promise<void> {
    const asked = evaluation === null ? this.rollup.rebuild(testId) : this.rollup.relay();
    // A queue nobody can reach must not fail a score that committed — the sweeper asks again.
    await asked.catch((error: unknown) => {
      this.logger.error(`Attempt on test ${testId} was scored but not counted`, error);
    });
  }

  /** One transaction: a sitting whose totals and per-question verdicts disagree is worse than neither. */
  private async persist(
    attempt: ScoringRow,
    scored: PaperScore,
    terms: readonly PaperTerm[],
  ): Promise<Written> {
    return this.prisma.$transaction(async (tx) => {
      const first = await this.mark(tx, attempt, scored);
      if (first === null) return { applied: false, evaluation: null };

      await tx.attemptSheet.update({
        where: { attemptId: attempt.id },
        data: { verdicts: verdictsOf(scored.questions, terms) },
      });
      if (first) return { applied: true, evaluation: await this.announce(tx, attempt) };

      await this.announceCorrection(tx, attempt, scored.score);
      return { applied: true, evaluation: null };
    });
  }

  /** Marks and claim in ONE write: true on a first evaluation, false on a re-score, null when the status moved. */
  private async mark(
    tx: Prisma.TransactionClient,
    attempt: ScoringRow,
    scored: PaperScore,
  ): Promise<boolean | null> {
    const now = new Date();
    // Locked by the CTE, so the status this statement checks cannot move under it.
    const rows = await tx.$queryRaw<{ first: boolean }[]>`
      WITH held AS (
        SELECT "id", "evaluatedAt" IS NULL AS first FROM "Attempt" WHERE "id" = ${attempt.id}::uuid FOR UPDATE
      )
      UPDATE "Attempt" a SET
        "status" = ${ATTEMPT_STATUS.EVALUATED}::"AttemptStatus",
        "evaluatedAt" = COALESCE(a."evaluatedAt", ${now}),
        "score" = ${scored.score},
        "correctCount" = ${scored.correctCount},
        "wrongCount" = ${scored.wrongCount},
        "unattemptedCount" = ${scored.unattemptedCount},
        "sectionScores" = ${JSON.stringify(packedSections(scored.sections))}::jsonb,
        "timeTakenSec" = ${timeTakenSec(attempt.startedAt, attempt.submittedAt)},
        "updatedAt" = ${now}
      FROM held h
      WHERE a."id" = h."id" AND a."status" = ANY(${[...SCORABLE]}::"AttemptStatus"[])
      RETURNING h.first`;
    return rows[0]?.first ?? null;
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
}

/** The sheet's answers against the paper's terms, which are the one paper in paper order. */
function scorableOf(attempt: ScoringRow, terms: readonly PaperTerm[]): ScorableQuestion[] {
  const sheet = sheetIn(attempt.sheet?.answers);
  return terms.map((term, slot) => {
    const answer = decodeAnswer(sheet[slot], term.optionIds, attempt.startedAt);
    return {
      questionId: term.questionId,
      baseConfigSectionId: term.baseConfigSectionId,
      type: term.type,
      marks: term.marks,
      negativeMarks: term.negativeMarks,
      status: term.status,
      correctOptionIds: term.correctOptionIds,
      answerKey: term.type === QUESTION_TYPE.TEXT_FIELD ? term.answerKey : null,
      selectedOptionId: answer?.selectedOptionId ?? null,
      typedAnswer: answer?.typedAnswer ?? null,
      timeSpentSec: answer?.timeSpentSec ?? 0,
    };
  });
}

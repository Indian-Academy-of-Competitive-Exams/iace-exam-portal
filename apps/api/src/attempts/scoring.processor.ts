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
import { RollupQueue } from './rollup-queue';
import { NotificationOutbox } from '../notifications';
import { packedSections, scorePaper, type PaperScore, type ScorableQuestion } from './score-paper';
import { QueueFailures } from '../common/metrics/queue-failures';
import { decodeAnswer, sheetIn, verdictsOf } from './answer-sheet';
import { PaperSheetService, type PaperTerm } from './paper-sheet.service';
import { RollupService } from './rollup.service';
import { type FoldableAttempt } from './rollup-fold';

const SCORING_SELECT = {
  id: true,
  testId: true,
  studentId: true,
  attemptNo: true,
  status: true,
  // What they were shown last. A re-score that lands on the same number is not news.
  score: true,
  isGraded: true,
  startedAt: true,
  submittedAt: true,
  // The scoring terms' cache key: a disposition bumps it, so a warm copy cannot hide a drop.
  test: { select: { paperRevision: true, scope: true } },
  sheet: { select: { answers: true } },
} as const satisfies Prisma.AttemptSelect;

type ScoringRow = Prisma.AttemptGetPayload<{ select: typeof SCORING_SELECT }>;

/** What the write did: whether the marks landed at all, and whether this was the first evaluation. */
interface Written {
  applied: boolean;
  first: boolean;
}

/** Ended, however it ended. Re-scoring an EVALUATED sitting is how a dropped question is applied. */
const SCORABLE = new Set<AttemptStatus>([ATTEMPT_STATUS.SUBMITTED, ATTEMPT_STATUS.EVALUATED]);

@Processor(QUEUE_NAMES.SCORING, { concurrency: QUEUE_POLICY[QUEUE_NAMES.SCORING].concurrency })
export class ScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoringProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rollup: RollupQueue,
    private readonly notifications: NotificationOutbox,
    private readonly failures: QueueFailures,
    private readonly papers: PaperSheetService,
    private readonly rollups: RollupService,
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
    const served = scorableOf(attempt, terms);
    const scored = scorePaper(served);
    const written = await this.persist(attempt, scored, terms, served);
    // Stood down while this ran: counting it now would fold a void sitting back in.
    if (!written.applied) return null;

    if (!written.first) await this.recount(attempt);
    return scored;
  }

  /** Only a re-score gets here, and it moved marks already counted on both sides: both go again. */
  private async recount(attempt: ScoringRow): Promise<void> {
    await Promise.all([
      this.rollup.rebuild(attempt.testId),
      this.rollup.rebuildStudent(attempt.studentId),
      // A queue nobody can reach must not fail a score that committed — the sweeper asks again.
    ]).catch((error: unknown) => {
      this.logger.error(`Attempt on test ${attempt.testId} was re-scored but not counted`, error);
    });
  }

  /** One transaction: a sitting whose totals and per-question verdicts disagree is worse than neither. */
  private async persist(
    attempt: ScoringRow,
    scored: PaperScore,
    terms: readonly PaperTerm[],
    served: readonly ScorableQuestion[],
  ): Promise<Written> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const first = await this.mark(tx, attempt, scored, now);
      if (first === null) return { applied: false, first: false };

      await tx.attemptSheet.update({
        where: { attemptId: attempt.id },
        data: { verdicts: verdictsOf(scored.questions, terms) },
      });
      if (first) {
        await this.rollups.foldStudentSitting(
          tx,
          foldableOf(attempt, scored, terms, served, now),
          now,
        );
        await this.announce(tx, attempt);
        return { applied: true, first: true };
      }

      await this.announceCorrection(tx, attempt, scored.score);
      return { applied: true, first: false };
    });
  }

  /** Marks and claim in ONE write: true on a first evaluation, false on a re-score, null when the status moved. */
  private async mark(
    tx: Prisma.TransactionClient,
    attempt: ScoringRow,
    scored: PaperScore,
    now: Date,
  ): Promise<boolean | null> {
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

  private async announce(tx: Prisma.TransactionClient, attempt: ScoringRow): Promise<void> {
    // Same transaction as the marks: a student whose result committed is always one we owe a word to.
    await this.notifications.request(tx, {
      studentId: attempt.studentId,
      type: NOTIFICATION_TYPE.RESULT_READY,
      title: 'Your result is ready',
      body: 'Open the test to see your score, rank and answers.',
      dedupeKey: `result:${attempt.id}`,
      testId: attempt.testId,
    });
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

/** The student's own two tables read this sitting, and the scorer already holds every field they need. */
function foldableOf(
  attempt: ScoringRow,
  scored: PaperScore,
  terms: readonly PaperTerm[],
  served: readonly ScorableQuestion[],
  now: Date,
): FoldableAttempt {
  return {
    id: attempt.id,
    testId: attempt.testId,
    studentId: attempt.studentId,
    attemptNo: attempt.attemptNo,
    isGraded: attempt.isGraded,
    score: scored.score,
    correctCount: scored.correctCount,
    wrongCount: scored.wrongCount,
    unattemptedCount: scored.unattemptedCount,
    submittedAt: attempt.submittedAt,
    evaluatedAt: now,
    scope: attempt.test.scope,
    sections: scored.sections,
    // `scorePaper` pushes one verdict per row it was handed, so all three lists are the paper's order.
    questions: terms.map((term, slot) => ({
      paperQuestionId: term.id,
      questionId: term.questionId,
      subjectId: term.subjectId,
      isCorrect: scored.questions[slot]?.isCorrect ?? null,
      timeSpentSec: served[slot]?.timeSpentSec ?? 0,
      selectedOptionId: served[slot]?.selectedOptionId ?? null,
    })),
  };
}

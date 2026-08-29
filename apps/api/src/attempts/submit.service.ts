/**
 * Ending a sitting, exactly once, whoever ends it — the student or the sweeper.
 * The ORDER is the whole design: the answers are written BEFORE the claim, so a write that
 * throws leaves the sitting open with its state intact; the claim and the scoring request
 * then commit together; and the state is taken last, so nothing scores a half-written paper.
 */
import { Injectable, Logger } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import {
  ANSWER_STATE,
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  type AttemptStatus,
  type SubmittedAttempt,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService } from '../access';
import { AttemptStateService } from './attempt-state.service';
import { rowsToFlush, type FlushRow } from './attempt-flush';
import { ScoringOutbox } from './scoring-outbox';

const NOT_YOURS = 'No such attempt';

/** What counts as answered on the way out — a marked answer is still an answer. */
const ANSWERED_STATES = [ANSWER_STATE.ANSWERED, ANSWER_STATE.ANSWERED_MARKED];

/** Ahead of the claim, so a call that lost the race cannot write over the winner's answers. */
const STILL_LIVE = { attempt: { status: ATTEMPT_STATUS.IN_PROGRESS } } as const;

@Injectable()
export class SubmitService {
  private readonly logger = new Logger(SubmitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
    private readonly access: AccessResolverService,
    private readonly outbox: ScoringOutbox,
  ) {}

  /** The student's own. Another student's id reads as missing, never as refused. */
  async submit(studentId: string, attemptId: string): Promise<SubmittedAttempt> {
    const attempt = await this.require(attemptId);
    if (attempt.studentId !== studentId) {
      throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    }
    return this.end(attempt);
  }

  /** The sweeper's. A closed tab must not leave a sitting open forever. */
  async expire(attemptId: string): Promise<SubmittedAttempt> {
    return this.end(await this.require(attemptId));
  }

  private async end(attempt: AttemptRow, now: Date = new Date()): Promise<SubmittedAttempt> {
    if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) return this.closeOff(attempt.id);

    // READ, never taken: the live state has to outlive a write that throws.
    const held = await this.state.read(attempt.id);
    await this.flush(attempt.id, held ? rowsToFlush(held) : [], STILL_LIVE);

    const requested = await this.claim(attempt, now);
    if (requested === null) return this.alreadySubmitted(attempt.id);

    // Taken only behind the claim, so a save arriving after this is refused rather than swallowed.
    const last = await this.state.take(attempt.id);
    // A save that beat the claim: written before the request is handed to a scorer.
    if (last && last.revision !== held?.revision) await this.flush(attempt.id, rowsToFlush(last));

    await this.hand(requested);
    // The catalog caches where this student has got to; ending a sitting is what moves it last.
    await this.access.invalidateStudent(attempt.studentId);

    return {
      attemptId: attempt.id,
      status: ATTEMPT_STATUS.SUBMITTED,
      submittedAt: now.toISOString(),
      submittedByThisCall: true,
      answeredCount: await this.countAnswered(attempt.id),
    };
  }

  /** The scoring request's id, or null when another call had already ended this sitting. */
  private async claim(attempt: AttemptRow, now: Date): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      // The one gate. The request whose UPDATE still matches IN_PROGRESS wins; the other reports it.
      const claimed = await tx.attempt.updateMany({
        where: { id: attempt.id, status: ATTEMPT_STATUS.IN_PROGRESS },
        data: { status: ATTEMPT_STATUS.SUBMITTED, submittedAt: now },
      });
      if (claimed.count === 0) return null;
      // The same transaction as the flip, so submitted and scoring-requested never land apart.
      return this.outbox.request(tx, attempt);
    });
  }

  /** Idempotent: every value comes off the held state, so writing it twice writes the same row. */
  private async flush(
    attemptId: string,
    rows: readonly FlushRow[],
    gate: Prisma.AttemptQuestionWhereInput = {},
  ): Promise<void> {
    if (rows.length === 0) return;
    // The batched form: one round trip for the whole paper, on the path 5K students converge on.
    await this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.attemptQuestion.updateMany({
          where: { attemptId, questionId: row.questionId, ...gate },
          data: row.data,
        }),
      ),
    );
  }

  /** A queue nobody can reach must not fail a submit that committed — the sweeper hands it on. */
  private async hand(requestId: string): Promise<void> {
    await this.outbox.relay(requestId).catch((error: unknown) => {
      this.logger.error(`Scoring request ${requestId} was not handed on; the sweeper will`, error);
    });
  }

  private async countAnswered(attemptId: string): Promise<number> {
    return this.prisma.attemptQuestion.count({
      where: { attemptId, state: { in: ANSWERED_STATES } },
    });
  }

  /** Found already ended: whoever ended it may have died before clearing its live state. */
  private async closeOff(attemptId: string): Promise<SubmittedAttempt> {
    await this.state.take(attemptId);
    return this.alreadySubmitted(attemptId);
  }

  private async alreadySubmitted(attemptId: string): Promise<SubmittedAttempt> {
    const attempt = await this.require(attemptId);
    if (!attempt.submittedAt) {
      // Neither IN_PROGRESS nor submitted: an expired row nobody ended, which the sweeper owns.
      this.logger.warn(`Attempt ${attemptId} is ${attempt.status} with no submittedAt`);
    }

    return {
      attemptId,
      status: attempt.status,
      submittedAt: (attempt.submittedAt ?? new Date()).toISOString(),
      submittedByThisCall: false,
      answeredCount: await this.countAnswered(attemptId),
    };
  }

  private async require(attemptId: string): Promise<AttemptRow> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: { id: true, studentId: true, testId: true, status: true, submittedAt: true },
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    return attempt;
  }
}

interface AttemptRow {
  id: string;
  studentId: string;
  testId: string;
  status: AttemptStatus;
  submittedAt: Date | null;
}

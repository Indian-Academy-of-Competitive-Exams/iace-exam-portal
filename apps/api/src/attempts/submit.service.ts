/**
 * Ending a sitting, exactly once, whoever ends it — the student or the sweeper.
 * The ORDER is the whole design: claim the status first, then TAKE the live state
 * in one command. A save racing this either lands before the take and is written,
 * or finds no key after it and is refused. There is no in-between to lose.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { type Queue } from 'bullmq';
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
import { QUEUE_NAMES, type ScoringJobData } from '../queue/queues';
import { AttemptStateService } from './attempt-state.service';
import { rowsToFlush } from './attempt-flush';

const NOT_YOURS = 'No such attempt';

/** What counts as answered on the way out — a marked answer is still an answer. */
const ANSWERED_STATES = [ANSWER_STATE.ANSWERED, ANSWER_STATE.ANSWERED_MARKED];

@Injectable()
export class SubmitService {
  private readonly logger = new Logger(SubmitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
    private readonly access: AccessResolverService,
    @InjectQueue(QUEUE_NAMES.SCORING) private readonly scoring: Queue<ScoringJobData>,
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
    // The one gate. The request whose UPDATE still matches IN_PROGRESS wins; the other reports it.
    const claimed = await this.prisma.attempt.updateMany({
      where: { id: attempt.id, status: ATTEMPT_STATUS.IN_PROGRESS },
      data: { status: ATTEMPT_STATUS.SUBMITTED, submittedAt: now },
    });
    if (claimed.count === 0) return this.alreadySubmitted(attempt.id);

    const answeredCount = await this.flushFinalState(attempt.id);
    await this.scoring.add(QUEUE_NAMES.SCORING, { attemptId: attempt.id, testId: attempt.testId });
    // The catalog caches where this student has got to; ending a sitting is what moves it last.
    await this.access.invalidateStudent(attempt.studentId);

    return {
      attemptId: attempt.id,
      status: ATTEMPT_STATUS.SUBMITTED,
      submittedAt: now.toISOString(),
      submittedByThisCall: true,
      answeredCount,
    };
  }

  /** Behind the gate: read AFTER the claim, so a save that landed while claiming is still written. */
  private async flushFinalState(attemptId: string): Promise<number> {
    const held = await this.state.take(attemptId);
    if (!held) return this.countAnswered(attemptId);

    const rows = rowsToFlush(held);
    if (rows.length > 0) {
      await this.prisma.$transaction(
        rows.map((row) =>
          this.prisma.attemptQuestion.updateMany({
            where: { attemptId, questionId: row.questionId },
            data: row.data,
          }),
        ),
      );
    }
    return this.countAnswered(attemptId);
  }

  private async countAnswered(attemptId: string): Promise<number> {
    return this.prisma.attemptQuestion.count({
      where: { attemptId, state: { in: ANSWERED_STATES } },
    });
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

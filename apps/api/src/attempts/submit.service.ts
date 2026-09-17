/**
 * Ending a sitting, exactly once, whoever ends it — the student or the sweeper.
 * The ORDER is the whole design: the answers are written BEFORE the claim, so a write that
 * throws leaves the sitting open with its state intact; the claim and the scoring request
 * then commit together; and the state is taken last, so nothing scores a half-written paper.
 */
import { Injectable, Logger } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import { AppException, ATTEMPT_STATUS, ErrorCodes, type SubmittedAttempt } from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AccessResolverService } from '../access';
import { AttemptStateService } from './attempt-state.service';
import { AttemptSheetService } from './attempt-sheet.service';
import { answeredIn, type AnswerSheet } from './answer-sheet';
import { holdsSitting } from './attempt-state';
import { ScoringOutbox } from './scoring-outbox';
import { MetricsService } from '../common/metrics';

const NOT_YOURS = 'No such attempt';
const CONTINUED_ELSEWHERE = 'This test was continued in another tab or on another device.';

const ATTEMPT_SELECT = {
  id: true,
  studentId: true,
  testId: true,
  status: true,
  submittedAt: true,
} as const satisfies Prisma.AttemptSelect;

type AttemptRow = Prisma.AttemptGetPayload<{ select: typeof ATTEMPT_SELECT }>;

@Injectable()
export class SubmitService {
  private readonly logger = new Logger(SubmitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
    private readonly access: AccessResolverService,
    private readonly outbox: ScoringOutbox,
    private readonly metrics: MetricsService,
    private readonly sheets: AttemptSheetService,
  ) {}

  /** The student's own. Another student's id reads as missing, never as refused. */
  async submit(studentId: string, attemptId: string, tab?: string): Promise<SubmittedAttempt> {
    const attempt = await this.require(attemptId);
    if (attempt.studentId !== studentId) {
      this.metrics.countSubmit('refused');
      throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    }

    // A tab stood down elsewhere must not end a sitting the student is answering somewhere else.
    const held = await this.state.read(attemptId);
    if (held && !holdsSitting(held, tab)) {
      this.metrics.countSubmit('refused');
      throw new AppException(ErrorCodes.SITTING_TAKEN_OVER, CONTINUED_ELSEWHERE);
    }

    const ended = await this.end(attempt);
    // The spike everything downstream is sized for, counted where it actually lands.
    this.metrics.countSubmit('accepted');
    return ended;
  }

  /** The sweeper's. A closed tab must not leave a sitting open forever. */
  async expire(attemptId: string): Promise<SubmittedAttempt> {
    return this.end(await this.require(attemptId));
  }

  private async end(attempt: AttemptRow, now: Date = new Date()): Promise<SubmittedAttempt> {
    if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) return this.closeOff(attempt.id);

    // READ, never taken: the live state has to outlive a write that throws.
    const held = await this.state.read(attempt.id);
    let sheet = held ? await this.sheets.write(held, true) : null;

    const requested = await this.claim(attempt, now);
    if (requested === null) return this.alreadySubmitted(attempt.id);

    // Taken only behind the claim, so a save arriving after this is refused rather than swallowed.
    const last = await this.state.take(attempt.id);
    // Always, even unchanged: a stale flush may have landed since, and the claim shuts out every later one.
    if (last) {
      sheet = await this.sheets.write(last, false);
    }

    await this.hand(requested);
    // The catalog caches where this student has got to; ending a sitting is what moves it last.
    await this.access.invalidateStudent(attempt.studentId);

    return {
      attemptId: attempt.id,
      status: ATTEMPT_STATUS.SUBMITTED,
      submittedAt: now.toISOString(),
      submittedByThisCall: true,
      answeredCount: await this.answeredOn(attempt.id, sheet),
    };
  }

  /** Off the sheet just written when there is one, so a submit reads nothing back to count. */
  private async answeredOn(attemptId: string, written: AnswerSheet | null): Promise<number> {
    if (written) return answeredIn(written);
    const stored = await this.prisma.attemptSheet.findUnique({
      where: { attemptId },
      select: { answers: true },
    });
    return answeredIn(stored?.answers);
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

  /** A queue nobody can reach must not fail a submit that committed — the sweeper hands it on. */
  private async hand(requestId: string): Promise<void> {
    await this.outbox.relay(requestId).catch((error: unknown) => {
      this.logger.error(`Scoring request ${requestId} was not handed on; the sweeper will`, error);
    });
  }

  /** Found already ended. Taking the state makes this the only caller that can still write it. */
  private async closeOff(attemptId: string): Promise<SubmittedAttempt> {
    const stray = await this.state.take(attemptId);
    if (stray) {
      await this.sheets.write(stray, false);
    }
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
      answeredCount: await this.answeredOn(attemptId, null),
    };
  }

  private async require(attemptId: string): Promise<AttemptRow> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: ATTEMPT_SELECT,
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    return attempt;
  }
}

/**
 * Ending a sitting, exactly once, whoever ends it — the student or the sweeper.
 * The ORDER is the whole design: answers are written BEFORE the claim, so a write that throws
 * leaves the sitting open; the state is taken behind the claim and written last; and only then
 * is the sitting queued, under its own id, so nothing scores a half-written paper.
 */
import { Injectable, Logger } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import {
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  type SubmitAttemptBody,
  type SubmittedAttempt,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AttemptStateService } from './attempt-state.service';
import { AttemptSheetService } from './attempt-sheet.service';
import { answeredIn, type AnswerSheet } from './answer-sheet';
import { holdsSitting, isInTime, type HeldState } from './attempt-state';
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
  endsAt: true,
} as const satisfies Prisma.AttemptSelect;

type AttemptRow = Prisma.AttemptGetPayload<{ select: typeof ATTEMPT_SELECT }>;

@Injectable()
export class SubmitService {
  private readonly logger = new Logger(SubmitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
    private readonly outbox: ScoringOutbox,
    private readonly metrics: MetricsService,
    private readonly sheets: AttemptSheetService,
  ) {}

  /** The student's own. Another student's id reads as missing, never as refused. */
  async submit(
    studentId: string,
    attemptId: string,
    body: SubmitAttemptBody = {},
  ): Promise<SubmittedAttempt> {
    const attempt = await this.require(attemptId);
    if (attempt.studentId !== studentId) {
      this.metrics.countSubmit('refused');
      throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    }

    // A tab stood down elsewhere must not end a sitting the student is answering somewhere else.
    const held = await this.state.read(attemptId);
    if (held && !holdsSitting(held, body.tab)) {
      this.metrics.countSubmit('refused');
      throw new AppException(ErrorCodes.SITTING_TAKEN_OVER, CONTINUED_ELSEWHERE);
    }

    try {
      await this.lastAnswers(studentId, attempt, held, body);
    } catch (error) {
      if (AppException.is(error) && error.code === ErrorCodes.SITTING_TAKEN_OVER) {
        this.metrics.countSubmit('refused');
      }
      throw error;
    }
    const ended = await this.end(attempt);
    // The spike everything downstream is sized for, counted where it actually lands.
    this.metrics.countSubmit('accepted');
    return ended;
  }

  /** The screen's last batch, saved as the newest; past the deadline's grace, by the key or the row, it is dropped as late. */
  private async lastAnswers(
    studentId: string,
    attempt: AttemptRow,
    held: HeldState | null,
    { last, tab }: SubmitAttemptBody,
    now: Date = new Date(),
  ): Promise<void> {
    if (!last || attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) return;
    if (!isInTime(held ?? { endsAt: attempt.endsAt.toISOString() }, now)) return;
    try {
      await this.state.save(studentId, attempt.id, { ...last, tab }, now, { last: true });
    } catch (error) {
      // Another call ended it meanwhile: end() reports that outcome rather than refusing the retry.
      if ((await this.require(attempt.id)).status === ATTEMPT_STATUS.IN_PROGRESS) throw error;
    }
  }

  /** The sweeper's. A closed tab must not leave a sitting open forever. */
  async expire(attemptId: string): Promise<SubmittedAttempt> {
    return this.end(await this.require(attemptId));
  }

  private async end(attempt: AttemptRow): Promise<SubmittedAttempt> {
    if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) return this.closeOff(attempt.id);

    // READ, never taken: the live state has to outlive a write that throws.
    const held = await this.state.read(attempt.id);
    let sheet = held ? await this.sheets.write(held, true) : null;

    const submittedAt = await this.claim(attempt);
    if (!submittedAt) return this.alreadySubmitted(attempt.id);

    // Taken only behind the claim, so a save arriving after this is refused rather than swallowed.
    const last = await this.state.take(attempt.id);
    // Always, even unchanged: a stale flush may have landed since, and the claim shuts out every later one.
    if (last) {
      sheet = await this.sheets.write(last, false);
    }

    // After the last write, so the scorer reads the sheet as it will stay.
    await this.queue(attempt);

    return {
      attemptId: attempt.id,
      status: ATTEMPT_STATUS.SUBMITTED,
      submittedAt: submittedAt.toISOString(),
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

  /** Stamped at the claim itself, where the sweeper's re-queue grace counts from; null when another call ended it. */
  private async claim(attempt: AttemptRow): Promise<Date | null> {
    const submittedAt = new Date();
    // The one gate. The request whose UPDATE still matches IN_PROGRESS wins; the other reports it.
    const claimed = await this.prisma.attempt.updateMany({
      where: { id: attempt.id, status: ATTEMPT_STATUS.IN_PROGRESS },
      data: { status: ATTEMPT_STATUS.SUBMITTED, submittedAt },
    });
    return claimed.count > 0 ? submittedAt : null;
  }

  /** A queue nobody can reach must not fail a submit that committed — the sweeper queues it again. */
  private async queue(attempt: AttemptRow): Promise<void> {
    await this.outbox.queue([attempt]).catch((error: unknown) => {
      this.logger.error(
        `Attempt ${attempt.id} was not queued for scoring; the sweeper will`,
        error,
      );
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

/**
 * The support console: the four things an admin may do to one student's sitting. Each goes through
 * the engine's own gates rather than around them — force-submit is the sweeper's `expire()`, and a
 * void archives rather than deletes, then asks for every aggregate it was counted in to be recounted.
 */
import { Injectable, Logger } from '@nestjs/common';
import { type Prisma } from '@prisma/client';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  type ExtendAttemptBody,
  type FieldDiff,
  type ForceSubmitAttemptBody,
  type ResetAttemptBody,
  type ResolvedAttempt,
  type VoidAttemptBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import { AttemptSheetService } from './attempt-sheet.service';
import { AttemptStateService } from './attempt-state.service';
import { RollupQueue } from './rollup-queue';
import { SubmitService } from './submit.service';
import {
  REFUSALS,
  SUPPORT_ACTIONS,
  resolutionBlocker,
  supportDiff,
  type SupportAction,
} from './attempt-resolution';

const NO_SITTING = 'No such sitting';

const RESOLVABLE_SELECT = {
  id: true,
  studentId: true,
  testId: true,
  status: true,
  endsAt: true,
  isGraded: true,
  voidedAt: true,
  voidReason: true,
} as const satisfies Prisma.AttemptSelect;

type ResolvableAttempt = Prisma.AttemptGetPayload<{ select: typeof RESOLVABLE_SELECT }>;

@Injectable()
export class AttemptResolutionService {
  private readonly logger = new Logger(AttemptResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
    private readonly sheets: AttemptSheetService,
    private readonly submit: SubmitService,
    private readonly rollup: RollupQueue,
    private readonly audit: AuditContext,
  ) {}

  /** The same path the sweeper takes, so scoring and the fold happen exactly as on a real submit. */
  async forceSubmit(attemptId: string, body: ForceSubmitAttemptBody): Promise<ResolvedAttempt> {
    const attempt = await this.require(attemptId, SUPPORT_ACTIONS.FORCE_SUBMIT);
    const ended = await this.submit.expire(attemptId);
    // Another call ended it first: this one did nothing, so it answers and files nothing.
    if (!ended.submittedByThisCall) throw overtaken(SUPPORT_ACTIONS.FORCE_SUBMIT);

    this.record(SUPPORT_ACTIONS.FORCE_SUBMIT, body.reason, attempt, {
      status: { from: attempt.status, to: ended.status },
    });
    return resolved({ ...attempt, status: ended.status }, false);
  }

  /** The row is the record and moves by the minutes; Redis, which the screen reads, follows it. */
  async extend(
    attemptId: string,
    body: ExtendAttemptBody,
    now: Date = new Date(),
  ): Promise<ResolvedAttempt> {
    const attempt = await this.require(attemptId, SUPPORT_ACTIONS.EXTEND);
    // Counted from now once the deadline has gone, or extending a stuck sitting buys nothing.
    const [moved] = await this.prisma.$queryRaw<{ from: Date; to: Date }[]>`
      WITH held AS (
        SELECT "id", "endsAt" FROM "Attempt"
        WHERE "id" = ${attemptId}::uuid AND "status" = ${ATTEMPT_STATUS.IN_PROGRESS}::"AttemptStatus"
        FOR UPDATE
      )
      UPDATE "Attempt" a SET
        "endsAt" = GREATEST(h."endsAt", ${now}::timestamptz) + ${body.minutes}::int * interval '1 minute',
        "updatedAt" = now()
      FROM held h
      WHERE a."id" = h."id"
      RETURNING h."endsAt" AS "from", a."endsAt" AS "to"`;
    if (!moved) throw overtaken(SUPPORT_ACTIONS.EXTEND);

    await this.state.pushDeadline(attemptId, moved.to).catch((error: unknown) => {
      // Refusing here would be retried into double the minutes: the key follows the row on its next open.
      this.logger.error(`Attempt ${attemptId} was extended but its live key did not follow`, error);
    });

    this.record(SUPPORT_ACTIONS.EXTEND, body.reason, attempt, {
      endsAt: { from: moved.from.toISOString(), to: moved.to.toISOString() },
      minutes: { from: null, to: body.minutes },
    });
    return resolved({ ...attempt, endsAt: moved.to }, false);
  }

  /** A lost live key, put back from the sheet — never a marked sitting put back in progress. */
  async reset(attemptId: string, body: ResetAttemptBody): Promise<ResolvedAttempt> {
    const attempt = await this.require(attemptId, SUPPORT_ACTIONS.RESET);
    const held = await this.state.reestablish(attempt.studentId, attemptId);

    this.record(SUPPORT_ACTIONS.RESET, body.reason, attempt, {
      answersRestored: { from: null, to: Object.keys(held.answers).length },
    });
    return resolved(attempt, false);
  }

  /** Archived, never deleted, and taken out of every aggregate it had already been counted in. */
  async void(
    attemptId: string,
    body: VoidAttemptBody,
    adminId: string,
    now: Date = new Date(),
  ): Promise<ResolvedAttempt> {
    const attempt = await this.require(attemptId, SUPPORT_ACTIONS.VOID);
    // The ranked slot is spent by default; only a fault earns it back.
    const regranted = attempt.isGraded && body.regrantRanked;

    const voided = await this.prisma.attempt.updateMany({
      where: { id: attemptId, status: { not: ATTEMPT_STATUS.VOIDED } },
      data: {
        status: ATTEMPT_STATUS.VOIDED,
        voidedAt: now,
        voidReason: body.reason,
        voidedById: adminId,
        // Clearing it IS the regrant: the next sitting ranks because no sitting holds the slot.
        ...(regranted ? { isGraded: false } : {}),
      },
    });
    if (voided.count === 0) throw overtaken(SUPPORT_ACTIONS.VOID);
    // Nothing more may be saved to it, and the fallback in Postgres now refuses this sitting too.
    const stray = await this.state.take(attemptId);
    // Archived off a sitting still being answered; behind an ended one it would unpick a marked sheet.
    if (stray && attempt.status === ATTEMPT_STATUS.IN_PROGRESS) {
      await this.sheets.write(stray, false);
    }
    await this.reverse(attempt);

    this.record(SUPPORT_ACTIONS.VOID, body.reason, attempt, {
      status: { from: attempt.status, to: ATTEMPT_STATUS.VOIDED },
      ...(regranted ? { isGraded: { from: true, to: false } } : {}),
    });

    return resolved(
      {
        ...attempt,
        status: ATTEMPT_STATUS.VOIDED,
        isGraded: attempt.isGraded && !regranted,
        voidedAt: now,
        voidReason: body.reason,
      },
      regranted,
    );
  }

  /** Unconditional: `attempt` was read before the update, so its status cannot be trusted to skip this. */
  private async reverse(attempt: ResolvableAttempt): Promise<void> {
    await Promise.all([
      this.rollup.rebuild(attempt.testId),
      this.rollup.rebuildStudent(attempt.studentId),
    ]).catch((error: unknown) => {
      // The void committed. A queue nobody can reach must not hand the sitting back.
      this.logger.error(`Attempt ${attempt.id} was voided but not recounted`, error);
    });
  }

  /** Filed against the STUDENT whose sitting moved, with what was done and why in the diff. */
  private record(
    action: SupportAction,
    reason: string,
    attempt: ResolvableAttempt,
    moved: FieldDiff,
  ): void {
    this.audit.setEntityId(attempt.studentId);
    this.audit.setChanged(supportDiff(action, reason, attempt.id, moved));
  }

  private async require(attemptId: string, action: SupportAction): Promise<ResolvableAttempt> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: RESOLVABLE_SELECT,
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NO_SITTING);

    const blocker = resolutionBlocker(action, attempt.status);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);
    return attempt;
  }
}

/** What an action answers when its own write found the sitting had left the state it read. */
function overtaken(action: SupportAction): AppException {
  return new AppException(ErrorCodes.CONFLICT, REFUSALS[action]);
}

function resolved(attempt: ResolvableAttempt, rankedRegranted: boolean): ResolvedAttempt {
  return {
    attemptId: attempt.id,
    studentId: attempt.studentId,
    testId: attempt.testId,
    status: attempt.status,
    endsAt: attempt.endsAt.toISOString(),
    isGraded: attempt.isGraded,
    voidedAt: attempt.voidedAt?.toISOString() ?? null,
    voidReason: attempt.voidReason,
    rankedRegranted,
  };
}

/**
 * The support console: the four things an admin may do to one student's sitting. Each goes through
 * the engine's own gates rather than around them — force-submit is the sweeper's `expire()`, and a
 * void archives rather than deletes, then asks for every aggregate it was counted in to be recounted.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  ATTEMPT_STATUS,
  AppException,
  ErrorCodes,
  type AttemptStatus,
  type ExtendAttemptBody,
  type FieldDiff,
  type ForceSubmitAttemptBody,
  type ResetAttemptBody,
  type ResolvedAttempt,
  type VoidAttemptBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { AuditContext } from '../audit';
import { AccessResolverService } from '../access';
import { AttemptStateService } from './attempt-state.service';
import { LeaderboardService } from './leaderboard.service';
import { RollupOutbox } from './rollup-outbox';
import { SubmitService } from './submit.service';
import {
  SUPPORT_ACTIONS,
  extendedEndsAt,
  regrantsRankedSlot,
  resolutionBlocker,
  supportDiff,
  type SupportAction,
} from './attempt-resolution';

const NO_SITTING = 'No such sitting';

interface ResolvableAttempt {
  id: string;
  studentId: string;
  testId: string;
  status: AttemptStatus;
  endsAt: Date;
  isGraded: boolean;
  voidedAt: Date | null;
  voidReason: string | null;
}

@Injectable()
export class AttemptResolutionService {
  private readonly logger = new Logger(AttemptResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: AttemptStateService,
    private readonly submit: SubmitService,
    private readonly leaderboard: LeaderboardService,
    private readonly rollup: RollupOutbox,
    private readonly access: AccessResolverService,
    private readonly audit: AuditContext,
  ) {}

  /** The same path the sweeper takes, so scoring and the fold happen exactly as on a real submit. */
  async forceSubmit(attemptId: string, body: ForceSubmitAttemptBody): Promise<ResolvedAttempt> {
    const attempt = await this.require(attemptId, SUPPORT_ACTIONS.FORCE_SUBMIT);
    await this.submit.expire(attemptId);

    const ended = await this.require(attemptId, null);
    this.record(SUPPORT_ACTIONS.FORCE_SUBMIT, body.reason, attempt, {
      status: { from: attempt.status, to: ended.status },
    });
    return resolved(ended, false);
  }

  /** The clock moves in both places at once: the row is durable, and Redis is what the screen reads. */
  async extend(
    attemptId: string,
    body: ExtendAttemptBody,
    now: Date = new Date(),
  ): Promise<ResolvedAttempt> {
    const attempt = await this.require(attemptId, SUPPORT_ACTIONS.EXTEND);
    const endsAt = extendedEndsAt(attempt.endsAt, body.minutes, now);

    await this.prisma.attempt.update({ where: { id: attemptId }, data: { endsAt } });
    await this.state.pushDeadline(attemptId, endsAt);

    this.record(SUPPORT_ACTIONS.EXTEND, body.reason, attempt, {
      endsAt: { from: attempt.endsAt.toISOString(), to: endsAt.toISOString() },
      minutes: { from: null, to: body.minutes },
    });
    return resolved({ ...attempt, endsAt }, false);
  }

  /** A lost live key, put back from the durable rows — never a marked sitting put back in progress. */
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
    const regranted = regrantsRankedSlot(attempt.isGraded, body.regrantRanked);

    await this.prisma.attempt.update({
      where: { id: attemptId },
      data: {
        status: ATTEMPT_STATUS.VOIDED,
        voidedAt: now,
        voidReason: body.reason,
        voidedById: adminId,
        // Clearing it IS the regrant: the next sitting ranks because no sitting holds the slot.
        ...(regranted ? { isGraded: false } : {}),
      },
    });
    // Nothing more may be saved to it, and the fallback in Postgres now refuses this sitting too.
    await this.state.take(attemptId);
    await this.access.invalidateStudent(attempt.studentId);
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

  /** What a counted sitting leaves behind: the board at once, and one recount per bounded scope. */
  private async reverse(attempt: ResolvableAttempt): Promise<void> {
    if (attempt.status !== ATTEMPT_STATUS.EVALUATED) return;

    await Promise.all([
      this.leaderboard.forget(attempt.testId, attempt.id),
      this.leaderboard.askForRebuild(attempt.testId),
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

  private async require(
    attemptId: string,
    action: SupportAction | null,
  ): Promise<ResolvableAttempt> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        studentId: true,
        testId: true,
        status: true,
        endsAt: true,
        isGraded: true,
        voidedAt: true,
        voidReason: true,
      },
    });
    if (!attempt) throw new AppException(ErrorCodes.NOT_FOUND, NO_SITTING);

    const blocker = action === null ? null : resolutionBlocker(action, attempt.status);
    if (blocker) throw new AppException(ErrorCodes.CONFLICT, blocker);
    return attempt;
  }
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

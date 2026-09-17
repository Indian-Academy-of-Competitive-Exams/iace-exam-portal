/**
 * The live sitting, in Redis. The answering path reads and writes nothing else.
 * The KEY EXISTING is what "this sitting is open" means: `open` writes it, `take` removes
 * it at submit, and a save that finds no key falls back to Postgres, which refuses anything
 * not IN_PROGRESS. Every write is a compare-and-swap, so none lands on a state it did not read.
 */

import { Injectable } from '@nestjs/common';
import {
  ANSWER_STATE,
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  type AttemptSaveAck,
  type LiveAnswer,
  type LiveAttemptState,
  type SaveAttemptStateBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { answersOf } from './answer-sheet';
import { applyBatch, holdsSitting, isInTime, pendingAfter, type HeldState } from './attempt-state';

/** Outlives the longest sitting by a wide margin: the flusher must still find a finished one. */
const STATE_TTL_SEC = 12 * 60 * 60;

/** How many times a patch of the live key gives way before it refuses rather than writes over. */
const PATCH_TRIES = 5;

const NOT_YOURS = 'No such attempt';
const BEING_ANSWERED = 'This sitting is being written to right now. Try again in a moment.';
const ALREADY_ENDED = 'This sitting has ended, so nothing more can be saved to it.';
const CONTINUED_ELSEWHERE = 'This test was continued in another tab or on another device.';

@Injectable()
export class AttemptStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Seeded when the sitting starts, so no later save has to ask Postgres whose attempt this is. */
  async open(
    attempt: { id: string; studentId: string; testId: string; startedAt: Date; endsAt: Date },
    tab?: string,
  ): Promise<void> {
    await this.patch(
      attempt.id,
      (held) => ({
        ...held,
        testId: attempt.testId,
        startedAt: attempt.startedAt.toISOString(),
        tab: tab ?? held.tab,
      }),
      () => ({
        attemptId: attempt.id,
        studentId: attempt.studentId,
        testId: attempt.testId,
        startedAt: attempt.startedAt.toISOString(),
        endsAt: attempt.endsAt.toISOString(),
        revision: 0,
        answers: {},
        pending: [],
        sections: {},
        tab,
      }),
    );

    if (tab !== undefined) await this.takeClaim(attempt.studentId, attempt.id);
  }

  /** A resume after the key was lost puts back what Postgres holds, never an empty sheet over it. */
  async resume(
    attempt: { id: string; studentId: string; testId: string; startedAt: Date; endsAt: Date },
    tab?: string,
  ): Promise<void> {
    await this.require(attempt.studentId, attempt.id);
    await this.open(attempt, tab);
  }

  /** One sitting at a time per student: opening this one stands down whatever tab held the last. */
  private async takeClaim(studentId: string, attemptId: string): Promise<void> {
    const key = redisKeys.sittingClaim(studentId);
    const previous = await this.redis.client.get(key);
    if (previous !== null && previous !== attemptId) {
      await this.patch(previous, (stood) => ({ ...stood, tab: null }));
    }
    await this.redis.client.set(key, attemptId, 'EX', STATE_TTL_SEC);
  }

  /** Answers with the ack, never the sheet: the screen already holds what it just sent. */
  async save(
    studentId: string,
    attemptId: string,
    batch: SaveAttemptStateBody,
    now: Date = new Date(),
  ): Promise<AttemptSaveAck> {
    const next = await this.patch(
      attemptId,
      (held) => answered(held, studentId, batch, now),
      () => this.durableState(studentId, attemptId),
    );
    // Marked AFTER the write: a mark whose state never landed would flush yesterday's answers.
    await this.redis.client.sadd(redisKeys.attemptsDirty, attemptId);

    return acked(next, now);
  }

  /** What a reloaded screen needs. `require` already refuses another student and rebuilds a lost key. */
  async current(
    studentId: string,
    attemptId: string,
    now: Date = new Date(),
  ): Promise<LiveAttemptState> {
    return shown(await this.require(studentId, attemptId), now);
  }

  /** The last read, which also shuts the door — one command, so a race has no in-between to lose. */
  async take(attemptId: string): Promise<HeldState | null> {
    const held = await this.redis.takeJson<HeldState>(redisKeys.attemptState(attemptId));
    await this.clearDirty(attemptId);
    return held;
  }

  async read(attemptId: string): Promise<HeldState | null> {
    return this.redis.getJson<HeldState>(redisKeys.attemptState(attemptId));
  }

  /** Several at once, for a screen watching a hall. A GET, never a take: this must evict nothing. */
  async readMany(attemptIds: readonly string[]): Promise<Map<string, HeldState>> {
    const held = await this.redis.mgetJson<HeldState>(
      attemptIds.map((id) => redisKeys.attemptState(id)),
    );
    return new Map(
      held.flatMap((state, index) => {
        const attemptId = attemptIds[index];
        return state === null || attemptId === undefined ? [] : [[attemptId, state] as const];
      }),
    );
  }

  /** The support console's reset: the key rebuilt from the sheet, losing nothing. */
  async reestablish(studentId: string, attemptId: string): Promise<HeldState> {
    const durable = await this.durableState(studentId, attemptId);
    // Anything the key still holds landed AFTER the last flush, so it wins over the durable copy.
    return this.patch(
      attemptId,
      (held) => mergedOver(durable, held),
      () => durable,
    );
  }

  /** The clock the student is watching. Moved here too, or the screen would count to the old one. */
  async pushDeadline(attemptId: string, endsAt: Date): Promise<void> {
    await this.patch(attemptId, (held) => ({ ...held, endsAt: endsAt.toISOString() }));
  }

  /** Every write of the key, giving way to one that beat it. Null when gone and nothing seeds it. */
  private patch(
    attemptId: string,
    change: (held: HeldState) => HeldState,
    seed: () => HeldState | Promise<HeldState>,
  ): Promise<HeldState>;
  private patch(
    attemptId: string,
    change: (held: HeldState) => HeldState,
  ): Promise<HeldState | null>;
  private async patch(
    attemptId: string,
    change: (held: HeldState) => HeldState,
    seed?: () => HeldState | Promise<HeldState>,
  ): Promise<HeldState | null> {
    const key = redisKeys.attemptState(attemptId);
    for (let tries = 0; tries < PATCH_TRIES; tries += 1) {
      const raw = await this.redis.getRaw(key);
      const held = (raw === null ? null : parsedHeld(raw)) ?? (await seed?.());
      if (!held) return null;

      // A change may refuse by throwing; a lost swap judges it again against the fresh read.
      const next = change(held);
      if (await this.redis.replaceJson(key, raw, next, STATE_TTL_SEC)) return next;
    }
    throw new AppException(ErrorCodes.CONFLICT, BEING_ANSWERED);
  }

  /** What the flusher drains. Read as a whole: a save landing mid-drain re-marks its own attempt. */
  async dirtyIds(): Promise<string[]> {
    return this.redis.client.smembers(redisKeys.attemptsDirty);
  }

  async clearDirty(...attemptIds: string[]): Promise<void> {
    if (attemptIds.length === 0) return;
    await this.redis.client.srem(redisKeys.attemptsDirty, ...attemptIds);
  }

  /** Only answers still as this pass wrote them: a save landing mid-flush keeps its mark. */
  async clearPending(
    attemptId: string,
    written: Readonly<Record<string, LiveAnswer>>,
  ): Promise<void> {
    if (Object.keys(written).length === 0) return;
    await this.patch(attemptId, (held) => ({ ...held, pending: pendingAfter(held, written) }));
  }

  /** Redis first, Postgres only if the key has gone — paying on a rare resume, not on every read. */
  private async require(studentId: string, attemptId: string): Promise<HeldState> {
    const held =
      (await this.read(attemptId)) ??
      (await this.patch(
        attemptId,
        (found) => found,
        () => this.durableState(studentId, attemptId),
      ));
    return yours(held, studentId);
  }

  /** The sitting as Postgres holds it, whether or not anything is going to be written back. */
  private async durableState(studentId: string, attemptId: string): Promise<HeldState> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: {
        id: true,
        studentId: true,
        testId: true,
        startedAt: true,
        endsAt: true,
        status: true,
        sheet: { select: { answers: true } },
      },
    });
    // Another student's id reads as missing: an id is not a thing to confirm the existence of.
    if (attempt?.studentId !== studentId) {
      throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    }
    if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
      throw new AppException(ErrorCodes.CONFLICT, ALREADY_ENDED);
    }

    const paper = await this.prisma.paperQuestion.findMany({
      where: { testId: attempt.testId },
      orderBy: { order: 'asc' },
      select: { questionId: true, optionIds: true },
    });
    // TOUCHED answers only: an untouched slot is not an answer to put back.
    const answers = Object.fromEntries(
      Object.entries(answersOf(attempt.sheet?.answers, paper, attempt.startedAt)).filter(
        ([, answer]) => answer.state !== ANSWER_STATE.NOT_VISITED,
      ),
    );

    return {
      attemptId: attempt.id,
      studentId: attempt.studentId,
      testId: attempt.testId,
      startedAt: attempt.startedAt.toISOString(),
      endsAt: attempt.endsAt.toISOString(),
      revision: 0,
      answers,
      pending: [],
      sections: {},
    };
  }
}

/** A corrupt value reads as no key at all, which is what both callers of `patch` already repair. */
function parsedHeld(raw: string): HeldState | null {
  try {
    return JSON.parse(raw) as HeldState;
  } catch {
    return null;
  }
}

/** Another student's id reads as missing, as it does on the Postgres side. */
function yours(held: HeldState, studentId: string): HeldState {
  if (held.studentId !== studentId) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
  return held;
}

/** The batch on top of what was held, or the refusal that stands against it. */
function answered(
  held: HeldState,
  studentId: string,
  batch: SaveAttemptStateBody,
  now: Date,
): HeldState {
  yours(held, studentId);
  if (!isInTime(held, now)) throw new AppException(ErrorCodes.CONFLICT, ALREADY_ENDED);
  if (!holdsSitting(held, batch.tab)) {
    throw new AppException(ErrorCodes.SITTING_TAKEN_OVER, CONTINUED_ELSEWHERE);
  }
  return { ...applyBatch(held, batch, now), tab: batch.tab ?? held.tab };
}

/** The row's own deadline stands, because an extension moves it there first. */
function mergedOver(durable: HeldState, held: HeldState): HeldState {
  return {
    ...durable,
    revision: held.revision,
    answers: { ...durable.answers, ...held.answers },
    pending: held.pending,
    sections: held.sections,
  };
}

/** A save carries the clock back with the counter, so answering is also how the timer stays honest. */
function acked(state: HeldState, now: Date): AttemptSaveAck {
  return { revision: state.revision, endsAt: state.endsAt, serverNow: now.toISOString() };
}

/** The student never sees whose attempt it is — they know — and never the raw held shape. */
function shown(state: HeldState, now: Date): LiveAttemptState {
  return {
    attemptId: state.attemptId,
    revision: state.revision,
    answers: state.answers,
    sections: state.sections,
    endsAt: state.endsAt,
    serverNow: now.toISOString(),
  };
}

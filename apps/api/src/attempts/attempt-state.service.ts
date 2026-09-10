/**
 * The live sitting, in Redis. The answering path reads and writes nothing else.
 * The KEY EXISTING is what "this sitting is open" means: `open` writes it, `close`
 * removes it at submit, and a save that finds no key falls back to Postgres, which
 * refuses anything not IN_PROGRESS. So a save after a submit cannot be accepted.
 */

import { Injectable } from '@nestjs/common';
import {
  ANSWER_STATE,
  AppException,
  ATTEMPT_STATUS,
  ErrorCodes,
  type LiveAttemptState,
  type SaveAttemptStateBody,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { applyBatch, isInTime, type HeldState } from './attempt-state';
import { answersFromRows } from './attempt-flush';

/** Outlives the longest sitting by a wide margin: the flusher must still find a finished one. */
const STATE_TTL_SEC = 12 * 60 * 60;

/** How many times a patch of the live key gives way before it refuses rather than writes over. */
const PATCH_TRIES = 5;

const NOT_YOURS = 'No such attempt';
const BEING_ANSWERED = 'This sitting is being written to right now. Try again in a moment.';
const ALREADY_ENDED = 'This sitting has ended, so nothing more can be saved to it.';

@Injectable()
export class AttemptStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Seeded when the sitting starts, so no later save has to ask Postgres whose attempt this is. */
  async open(attempt: { id: string; studentId: string; endsAt: Date }): Promise<void> {
    const held = await this.read(attempt.id);
    if (held) return;

    await this.write({
      attemptId: attempt.id,
      studentId: attempt.studentId,
      endsAt: attempt.endsAt.toISOString(),
      revision: 0,
      answers: {},
      sections: {},
    });
  }

  async save(
    studentId: string,
    attemptId: string,
    batch: SaveAttemptStateBody,
    now: Date = new Date(),
  ): Promise<LiveAttemptState> {
    const held = await this.require(studentId, attemptId);
    if (!isInTime(held, now)) throw new AppException(ErrorCodes.CONFLICT, ALREADY_ENDED);

    const next = applyBatch(held, batch, now);
    await this.write(next);
    // Marked AFTER the write: a mark whose state never landed would flush yesterday's answers.
    await this.redis.client.sadd(redisKeys.attemptsDirty, attemptId);

    return shown(next, now);
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

  /** The support console's reset: the key written again from the durable rows, losing nothing. */
  async reestablish(studentId: string, attemptId: string): Promise<HeldState> {
    const durable = await this.durableState(studentId, attemptId);
    // Anything the key still holds landed AFTER the last flush, so it wins over the durable copy.
    const merged = await this.patch(attemptId, (held) => mergedOver(durable, held));
    if (merged) return merged;

    await this.write(durable);
    return durable;
  }

  /** The clock the student is watching. Moved here too, or the screen would count to the old one. */
  async pushDeadline(attemptId: string, endsAt: Date): Promise<void> {
    await this.patch(attemptId, (held) => ({ ...held, endsAt: endsAt.toISOString() }));
  }

  /** Gives way to a save that beat it rather than writing over one. Null when the key has gone. */
  private async patch(
    attemptId: string,
    change: (held: HeldState) => HeldState,
  ): Promise<HeldState | null> {
    const key = redisKeys.attemptState(attemptId);
    for (let tries = 0; tries < PATCH_TRIES; tries += 1) {
      const raw = await this.redis.getRaw(key);
      if (raw === null) return null;

      const held = parsedHeld(raw);
      if (held === null) return null;

      const next = change(held);
      if (await this.redis.replaceJson(key, raw, next, STATE_TTL_SEC)) return next;
    }
    throw new AppException(ErrorCodes.CONFLICT, BEING_ANSWERED);
  }

  /** What the flusher drains. Read as a whole: a save landing mid-drain re-marks its own attempt. */
  async dirtyIds(): Promise<string[]> {
    return this.redis.client.smembers(redisKeys.attemptsDirty);
  }

  async clearDirty(attemptId: string): Promise<void> {
    await this.redis.client.srem(redisKeys.attemptsDirty, attemptId);
  }

  private async write(state: HeldState): Promise<void> {
    await this.redis.setJson(redisKeys.attemptState(state.attemptId), state, STATE_TTL_SEC);
  }

  /** Redis first, Postgres only if the key has gone — paying on a rare resume, not on every save. */
  private async require(studentId: string, attemptId: string): Promise<HeldState> {
    const held = await this.read(attemptId);
    if (held) {
      if (held.studentId !== studentId) throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
      return held;
    }
    return this.rebuild(studentId, attemptId);
  }

  private async rebuild(studentId: string, attemptId: string): Promise<HeldState> {
    const rebuilt = await this.durableState(studentId, attemptId);
    await this.write(rebuilt);
    return rebuilt;
  }

  /** The sitting as Postgres holds it, whether or not anything is going to be written back. */
  private async durableState(studentId: string, attemptId: string): Promise<HeldState> {
    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: { id: true, studentId: true, endsAt: true, status: true },
    });
    // Another student's id reads as missing: an id is not a thing to confirm the existence of.
    if (attempt?.studentId !== studentId) {
      throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    }
    if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
      throw new AppException(ErrorCodes.CONFLICT, ALREADY_ENDED);
    }

    // TOUCHED rows only: the whole paper is seeded at start, and a flush writes a row per entry.
    const durable = await this.prisma.attemptQuestion.findMany({
      where: { attemptId, state: { not: ANSWER_STATE.NOT_VISITED } },
      select: {
        questionId: true,
        state: true,
        selectedOptionId: true,
        typedAnswer: true,
        timeSpentSec: true,
        answeredAt: true,
        firstActionAt: true,
      },
    });

    return {
      attemptId: attempt.id,
      studentId: attempt.studentId,
      endsAt: attempt.endsAt.toISOString(),
      revision: 0,
      answers: answersFromRows(durable),
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

/** The row's own deadline stands, because an extension moves it there first. */
function mergedOver(durable: HeldState, held: HeldState): HeldState {
  return {
    ...durable,
    revision: held.revision,
    answers: { ...durable.answers, ...held.answers },
    sections: held.sections,
  };
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

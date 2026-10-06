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
  type LiveAttemptState,
  type SaveAttemptStateBody,
  displayOrder,
} from '@iace/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { sectionsIn } from '../common/prisma-json';
import { parseJsonOrNull, RedisService } from '../redis/redis.service';
import { redisKeys } from '../redis/redis.keys';
import { answersOf } from './answer-sheet';
import { PaperSheetService } from './paper-sheet.service';
import {
  applyBatch,
  forwardOrderOf,
  heldElsewhere,
  heldIn,
  isHeartbeat,
  sittingRefusal,
  isStale,
  creditedEndsAt,
  creditedSections,
  creditMs,
  isAbandoned,
  isInTime,
  PAUSE_LIMIT_SEC,
  packHeld,
  withinReach,
  type ForwardOrder,
  type HeldState,
} from './attempt-state';

/** The key IS the pause: while it lives a sitting can be come back to, and past it there is nothing to read. */
const STATE_TTL_SEC = PAUSE_LIMIT_SEC;

/** How many times a patch of the live key gives way before it refuses rather than writes over. */
const PATCH_TRIES = 5;

const NOT_YOURS = 'No such attempt';
const BEING_ANSWERED = 'This sitting is being written to right now. Try again in a moment.';
const ALREADY_ENDED = 'This sitting has ended, so nothing more can be saved to it.';
/** One sitting as a flush pass read it: the bytes, and what they say (null when the key has gone). */
export interface FlushRead {
  attemptId: string;
  was: string | null;
  held: HeldState | null;
}

/** A sitting as it is opened or resumed: its row, and how a forward-only one orders its seats. */
export interface SittingOpened {
  id: string;
  studentId: string;
  testId: string;
  startedAt: Date;
  endsAt: Date;
  forwardOnly?: ForwardOrder;
  /** The sign-in opening it. Absent, nothing is held against another one. */
  session?: string;
}

@Injectable()
export class AttemptStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly paperSheet: PaperSheetService,
  ) {}

  /** Seeded when the sitting starts, so no later save has to ask Postgres whose attempt this is. */
  async open(attempt: SittingOpened, tab?: string, now: Date = new Date()): Promise<void> {
    // The tab and its sign-in are taken together; a caller naming no tab takes neither.
    const holder = tab === undefined ? {} : { tab, session: attempt.session };
    await this.patch(
      attempt.id,
      (held) => {
        // Judged inside the swap: of two sign-ins opening at once, the first to land holds it.
        const refused = heldElsewhere(held, attempt.session, now);
        if (refused) throw refused;
        return {
          ...held,
          testId: attempt.testId,
          startedAt: attempt.startedAt.toISOString(),
          // Postgres is the deadline of record, so a resume's credit reaches the key that admits saves.
          endsAt: attempt.endsAt.toISOString(),
          // Picked up again: the clock starts counting from here, not from where it was put down.
          lastSeenAt: now.toISOString(),
          forwardOnly: attempt.forwardOnly,
          ...holder,
        };
      },
      () => ({
        attemptId: attempt.id,
        studentId: attempt.studentId,
        testId: attempt.testId,
        startedAt: attempt.startedAt.toISOString(),
        endsAt: attempt.endsAt.toISOString(),
        revision: 0,
        lastSeenAt: now.toISOString(),
        answers: {},
        sections: {},
        forwardOnly: attempt.forwardOnly,
        ...holder,
      }),
    );

    if (tab !== undefined) await this.takeClaim(attempt.studentId, attempt.id);
  }

  /** Puts back what Postgres holds, and gives back the time the paper was not on screen. */
  async resume(attempt: SittingOpened, tab?: string, now: Date = new Date()): Promise<Date> {
    const held = await this.require(attempt.studentId, attempt.id);
    if (isAbandoned(held, now)) return attempt.endsAt;

    const endsAt = creditedEndsAt({ ...held, endsAt: attempt.endsAt.toISOString() }, now);
    const sections = creditedSections(held, now);
    const granted = creditMs(held, now);
    await this.open({ ...attempt, endsAt }, tab, now);
    // Banked cumulatively: however many times this sitting reloads, it cannot out-earn the cap.
    await this.patch(attempt.id, (put) => ({
      ...put,
      sections,
      creditedMs: (put.creditedMs ?? 0) + granted,
    }));
    // The row is the caller's to move: this file never writes Postgres on the answer path.
    return endsAt;
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
    { last = false }: { last?: boolean } = {},
  ): Promise<AttemptSaveAck> {
    // Judged inside the swap, against the same read the batch was applied to — the last try wins.
    let applied = false;
    const next = await this.patch(
      attemptId,
      async (held) => {
        // The batch that ends a sitting is its newest by definition, whatever counter a reloaded screen sent.
        const sent = last
          ? { ...batch, revision: Math.max(batch.revision, held.revision + 1) }
          : batch;
        applied = !isStale(held, sent);
        return answered(held, studentId, await this.inReach(held, sent), now);
      },
      () => this.durableState(studentId, attemptId),
    );
    // Marked AFTER the write: a flush that unmarks this sitting has seen this state or a later one.
    if (!isHeartbeat(batch)) await this.markDirty(attemptId);

    return { ...acked(next, now), applied };
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
    const held = await this.redis.takeJson<unknown>(redisKeys.attemptState(attemptId));
    await this.redis.client.srem(redisKeys.attemptsDirty, attemptId);
    return heldIn(held);
  }

  async read(attemptId: string): Promise<HeldState | null> {
    return heldIn(await this.redis.getJson<unknown>(redisKeys.attemptState(attemptId)));
  }

  /** Several at once, for a screen watching a hall. A GET, never a take: this must evict nothing. */
  async readMany(attemptIds: readonly string[]): Promise<Map<string, HeldState>> {
    const held = await this.redis.mgetJson<unknown>(
      attemptIds.map((id) => redisKeys.attemptState(id)),
    );
    return new Map(
      held.flatMap((stored, index) => {
        const attemptId = attemptIds[index];
        const state = heldIn(stored);
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

  /** The seats come from the per-process paper cache, so a forward-only save still reads no Postgres once warm. */
  private async inReach(
    held: HeldState,
    batch: SaveAttemptStateBody,
  ): Promise<SaveAttemptStateBody> {
    if (!held.forwardOnly) return batch;
    const { shuffleSeed, shuffleQuestions } = held.forwardOnly;
    const seats = displayOrder(
      await this.paperSheet.rowsOf(held.testId),
      shuffleSeed,
      shuffleQuestions,
    );
    return withinReach(held, batch, seats);
  }

  /** Every write of the key, giving way to one that beat it. Null when gone and nothing seeds it. */
  private patch(
    attemptId: string,
    change: (held: HeldState) => HeldState | Promise<HeldState>,
    seed: () => HeldState | Promise<HeldState>,
  ): Promise<HeldState>;
  private patch(
    attemptId: string,
    change: (held: HeldState) => HeldState,
  ): Promise<HeldState | null>;
  private async patch(
    attemptId: string,
    change: (held: HeldState) => HeldState | Promise<HeldState>,
    seed?: () => HeldState | Promise<HeldState>,
  ): Promise<HeldState | null> {
    const key = redisKeys.attemptState(attemptId);
    for (let tries = 0; tries < PATCH_TRIES; tries += 1) {
      const raw = await this.redis.getRaw(key);
      const held = (raw === null ? null : parsedHeld(raw)) ?? (await seed?.());
      if (!held) return null;

      // A change may refuse by throwing; a lost swap judges it again against the fresh read.
      const next = await change(held);
      if (await this.redis.replaceJson(key, raw, packHeld(next), STATE_TTL_SEC)) return next;
    }
    throw new AppException(ErrorCodes.CONFLICT, BEING_ANSWERED);
  }

  /** What the flusher drains. Read, not taken: a mark goes only once its sitting is written. */
  async dirtyIds(): Promise<string[]> {
    return this.redis.client.smembers(redisKeys.attemptsDirty);
  }

  /** Each sitting as its key holds it now, with the bytes read — what `settle` compares against. */
  async snapshot(attemptIds: readonly string[]): Promise<FlushRead[]> {
    if (attemptIds.length === 0) return [];
    const raw = await this.redis.client.mget(...attemptIds.map((id) => redisKeys.attemptState(id)));
    return attemptIds.map((attemptId, at) => {
      const was = raw[at] ?? null;
      return { attemptId, was, held: was === null ? null : parsedHeld(was) };
    });
  }

  /** Unmarks only a sitting whose key still holds what was written: a save since keeps its own mark. */
  async settle(written: readonly FlushRead[]): Promise<void> {
    await this.redis.removeIfUnchanged(
      redisKeys.attemptsDirty,
      written.map(({ attemptId, was }) => ({
        member: attemptId,
        key: redisKeys.attemptState(attemptId),
        was,
      })),
    );
  }

  async markDirty(...attemptIds: string[]): Promise<void> {
    if (attemptIds.length === 0) return;
    await this.redis.client.sadd(redisKeys.attemptsDirty, ...attemptIds);
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
        shuffleSeed: true,
        sectionState: true,
        test: { select: { baseConfig: { select: { navigation: true, shuffleQuestions: true } } } },
        sheet: { select: { answers: true, updatedAt: true } },
      },
    });
    // Another student's id reads as missing: an id is not a thing to confirm the existence of.
    if (attempt?.studentId !== studentId) {
      throw new AppException(ErrorCodes.NOT_FOUND, NOT_YOURS);
    }
    if (attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) {
      throw new AppException(ErrorCodes.CONFLICT, ALREADY_ENDED);
    }

    // A sat paper is frozen, so the rows PaperSheetService already holds for it are safe to reuse.
    const paper = await this.paperSheet.rowsOf(attempt.testId);
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
      // The last flush, not the start: a rebuild must credit only what it lost, not the whole sitting.
      lastSeenAt: (attempt.sheet?.updatedAt ?? attempt.startedAt).toISOString(),
      revision: 0,
      answers,
      // Without these a lost key would hand a sectional candidate every section's clock back in full.
      sections: sectionsIn(attempt.sectionState),
      forwardOnly: forwardOrderOf(
        attempt.test.baseConfig.navigation,
        attempt.shuffleSeed,
        attempt.test.baseConfig.shuffleQuestions,
      ),
    };
  }
}

/** A corrupt value reads as no key at all, which is what both callers of `patch` already repair. */
const parsedHeld = (raw: string): HeldState | null => heldIn(parseJsonOrNull(raw));

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
  const refused = sittingRefusal(held, batch.tab);
  if (refused) throw refused;
  // Stale or not, a batch from the tab holding it is that tab being here.
  const seen = { lastSeenAt: now.toISOString(), tab: batch.tab ?? held.tab };
  return { ...applyBatch(held, batch, now), ...seen };
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

/** A save carries the clock back with the counter, so answering is also how the timer stays honest. */
function acked(state: HeldState, now: Date): Omit<AttemptSaveAck, 'applied'> {
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

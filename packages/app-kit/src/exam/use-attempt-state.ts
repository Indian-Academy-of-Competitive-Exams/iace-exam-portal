/**
 * The screen's own answers, saved in batches. LOCAL state is what the screen draws:
 * a save that fails must never take an answer off the screen, so nothing here waits
 * on the server, and what a save could not deliver stays queued for the next one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ANSWER_STATE,
  AppException,
  ErrorCodes,
  isReviewState,
  SAVE_BATCH_MAX,
  type AnswerChange,
  type AnswerState,
  type ExamClock,
  type LiveAnswer,
  type SectionProgress,
} from '@iace/contracts';
import { type AppApiClient } from '../api-client';
import {
  autosaveDelayMs,
  FINISH_WAIT_MS,
  SAVE_TIMEOUT_MS,
  seedRevision,
  shouldFlushNow,
  shouldHeartbeat,
} from '../autosave-policy';
import { isWorthAskingAgain } from '../query-client';
import { type KeyValueStorage } from '../token-store';
import { createPendingAnswers, type PendingAnswers } from './pending-answers';

/** Where unsent answers wait: a synchronous store, so the last answer before the app dies is kept. */
export interface AnswerQueue {
  storage: KeyValueStorage;
  /** The app's own namespace; the attempt id is appended. */
  keyPrefix: string;
}

/** What the autosave cannot know: whose API, which tab or device is answering, and where answers wait. */
export interface AttemptStateDeps {
  api: AppApiClient;
  tab: string;
  answerQueue: AnswerQueue;
}

/** A refusal because another tab or device holds the sitting now. */
export const isTakenOver = (error: unknown): boolean =>
  AppException.is(error) && error.code === ErrorCodes.SITTING_TAKEN_OVER;

/** A refusal because the student opened another test; this sitting is theirs to continue. */
const isSetAside = (error: unknown): boolean =>
  AppException.is(error) && error.code === ErrorCodes.SITTING_SET_ASIDE;

const queueKeyFor = ({ keyPrefix }: AnswerQueue, attemptId: string) => `${keyPrefix}.${attemptId}`;

const answersFrom = (queued: readonly AnswerChange[]): Record<string, LiveAnswer> =>
  queued.reduce<Record<string, LiveAnswer>>(
    (held, change) => ({ ...held, [change.questionId]: answerOf(change, held[change.questionId]) }),
    {},
  );

export interface AttemptStateHandle {
  answers: Readonly<Record<string, LiveAnswer>>;
  sections: Readonly<Record<string, SectionProgress>>;
  /** True once the section state is settled — the server answered, or never will. Before it, "never opened" is unknowable. */
  sectionsSettled: boolean;
  /** The clock as the last save left it, so an extension reaches the screen without a reload. */
  clock: ExamClock | null;
  /** True while a save is in flight; the screen says "Saving…" and never blocks on it. */
  isSaving: boolean;
  /** True once a save has failed and not yet succeeded — the one thing a student must see. */
  hasUnsaved: boolean;
  /** True once this tab stopped holding the sitting: it was opened somewhere else, or another test was. */
  takenOver: boolean;
  /** It stopped because another of the student's tests was opened, not because this one went elsewhere. */
  setAside: boolean;
  /** Stops saving and says why; what is unsent stays on this device, and goes up if the student continues here. */
  standDown: () => void;
  /** What happened, in the screen's words. Time on the question is this hook's bookkeeping. */
  answer: (questionId: string, next: AnswerIntent) => void;
  /** Which question is on screen now, so the time on the last one can be banked. The same one again is a no-op. */
  open: (questionId: string | null) => void;
  /** Banks the open question's seconds without moving off it — before a flush that must be whole. */
  bankOpen: () => void;
  /** Entering a section tells the server, which stamps when its clock started. */
  enterSection: (sectionId: string, remainingSec: number) => void;
  closeSection: (sectionId: string, remainingSec: number) => void;
  /** Pushes whatever is pending now — on a section change. True means every answer held at the call reached the server. */
  flush: () => Promise<boolean>;
  /** The paper going in: the unsent batch rides the call that ends the sitting, and nothing is saved after it. */
  finish: <T>(send: (batch: LastBatch | null) => Promise<T>) => Promise<T>;
  /** The paper could not go in, retries spent: saving starts again, unless this tab was stood down. */
  resume: () => void;
  /** Whether anything the student did has not reached the server yet, read at the moment of asking. */
  hasUnsent: () => boolean;
  /** The page is closing or the app backgrounding: sends everything unsent now, keeping the local copy. */
  leave: () => void;
}

const answerOf = (change: AnswerChange, held: LiveAnswer | undefined): LiveAnswer => ({
  state: change.state,
  selectedOptionId: change.selectedOptionId ?? null,
  typedAnswer: change.typedAnswer ?? null,
  timeSpentSec: Math.max(held?.timeSpentSec ?? 0, change.timeSpentSec),
  answeredAt: held?.answeredAt ?? null,
  // Earliest wins: a later touch is not a first one, however many times this is recomputed.
  firstActionAt: held?.firstActionAt ?? change.firstActionAt ?? null,
});

/** What a save would have carried, handed to the call that ends the sitting instead. */
export interface LastBatch {
  revision: number;
  answers: AnswerChange[];
  sections: Record<string, SectionProgress>;
}

/** What the bottom bar can say. Absent means "leave that half as it was". */
export interface AnswerIntent {
  selectedOptionId?: string | null;
  marked?: boolean;
}

export function useAttemptState(
  attemptId: string,
  deps: Readonly<AttemptStateDeps>,
  startedByThisCall = false,
): AttemptStateHandle {
  // As of mount, in a ref: callers pass an inline object, and depending on it would restart autosave every render.
  const mounted = useRef(deps);
  const kept = useRef<PendingAnswers>(undefined);
  // Built once, from the store: what a save could not deliver before a reload is queued and drawn again.
  const queue = (kept.current ??= createPendingAnswers(
    deps.answerQueue.storage,
    queueKeyFor(deps.answerQueue, attemptId),
  ));
  const [answers, setAnswers] = useState<Record<string, LiveAnswer>>(() =>
    answersFrom(queue.changes()),
  );
  const [sections, setSections] = useState<Record<string, SectionProgress>>({});
  // False until the GET below settles: before it, a screen cannot tell "never opened" from "not yet known".
  const [sectionsSettled, setSectionsSettled] = useState(false);
  const [clock, setClock] = useState<ExamClock | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [takenOver, setTakenOver] = useState(false);
  const [setAside, setSetAside] = useState(false);
  const stopped = useRef(false);
  const heldElsewhere = useRef(false);

  // What the screen draws, current mid-handler: a state updater may not have run when the next write reads it.
  const answersNow = useRef<Record<string, LiveAnswer>>(answers);
  const openedAt = useRef(0);
  const openQuestion = useRef<string | null>(null);
  const revision = useRef(0);
  const fresh = useRef(startedByThisCall);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const seeded = useRef(false);
  const giveUp = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastSaveFailed = useRef(false);
  // When the server last answered this screen: the start that mounted it, then every save since.
  const heardAt = useRef(0);

  const commit = useCallback((next: Record<string, LiveAnswer>) => {
    answersNow.current = next;
    setAnswers(next);
  }, []);

  // Seeded from the server until it lands: a reloaded tab has answers it cannot otherwise see.
  useEffect(() => {
    // A sitting this screen just started holds no answers and no open section, so there is nothing to ask for.
    if (fresh.current) {
      setSectionsSettled(true);
      seeded.current = true;
      return;
    }

    let live = true;
    let again: ReturnType<typeof setTimeout> | undefined;
    const seed = () =>
      mounted.current.api.me.attemptState(attemptId).then(
        (held) => {
          if (!live) return;
          // Merged under, never over: an answer given while this flew is the newer one.
          commit({ ...held.answers, ...answersNow.current });
          setSections((mine) => ({ ...held.sections, ...mine }));
          setSectionsSettled(true);
          seeded.current = true;
          // Never backwards: a flush racing this GET may already have moved the counter on.
          revision.current = seedRevision(revision.current, held.revision);
        },
        (error: unknown) => {
          if (!live) return;
          // Never a dead paper: the sitting goes on with what this device holds, and a save is still the server's to refuse.
          setSectionsSettled(true);
          if (isWorthAskingAgain(error)) again = setTimeout(seed, autosaveDelayMs());
        },
      );
    void seed();
    return () => {
      live = false;
      clearTimeout(again);
    };
  }, [attemptId, commit]);

  // Either refusal keeps the queue: continued here, it is resent as it stands.
  const standDown = useCallback((forAnotherTest = false) => {
    stopped.current = true;
    heldElsewhere.current = true;
    setSetAside(forAnotherTest);
    setTakenOver(true);
  }, []);

  const unsaved = useCallback((value: boolean) => {
    lastSaveFailed.current = value;
    setHasUnsaved(value);
  }, []);

  // Answering moved to another tab or device: this one stops rather than fighting it.
  const refused = useCallback(
    (error: unknown) => {
      if (isTakenOver(error)) standDown();
      else if (isSetAside(error)) standDown(true);
    },
    [standDown],
  );

  const failed = useCallback(
    (error: unknown) => {
      unsaved(true);
      refused(error);
    },
    [refused, unsaved],
  );

  const hasUnsent = useCallback(() => queue.anyUnsent(), [queue]);

  const unsentBatch = useCallback(
    (): LastBatch => ({ revision: revision.current, ...queue.batch() }),
    [queue],
  );

  // In the air until it settles, so whatever comes next waits behind it and the last call really is last.
  const inAir = useCallback((run: Promise<boolean>): Promise<boolean> => {
    const marked = run.finally(() => {
      if (inFlight.current === marked) inFlight.current = null;
    });
    inFlight.current = marked;
    return marked;
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    // Nothing to send is the idle tick saying this device is here: not a save the screen reports.
    const heartbeat = !queue.anyUnsent();
    revision.current += 1;
    const batch = unsentBatch();
    if (!heartbeat) setIsSaving(true);
    const abandon = new AbortController();
    giveUp.current = setTimeout(() => abandon.abort(), SAVE_TIMEOUT_MS);
    try {
      const { api, tab } = mounted.current;
      const saved = await api.me.saveAttemptState(
        attemptId,
        { ...batch, tab },
        { signal: abandon.signal },
      );
      revision.current = seedRevision(revision.current, saved.revision);
      heardAt.current = Date.now();
      // Answering is also a clock check: the deadline it answers with is the one that counts.
      setClock({ endsAt: saved.endsAt, serverNow: saved.serverNow, arrivedAt: Date.now() });
      // A batch behind the one the server holds answers 200 too; only `applied` says it landed.
      const applied = saved.applied !== false;
      if (applied) queue.acknowledge(batch);
      if (!heartbeat) unsaved(!applied);
      return applied;
    } catch (error: unknown) {
      if (heartbeat) refused(error);
      else failed(error);
      return false;
    } finally {
      clearTimeout(giveUp.current);
      setIsSaving(false);
    }
  }, [attemptId, failed, queue, refused, unsaved, unsentBatch]);

  const flush = useCallback(async (): Promise<boolean> => {
    // Nothing awaited between the last check and the send, so two saves never fly side by side.
    while (inFlight.current) await inFlight.current;
    const idle = !hasUnsent();
    if (stopped.current || idle) return idle;
    // A backlog past one batch goes up in consecutive saves; one oversized batch would be refused forever.
    let over = queue.size() - SAVE_BATCH_MAX;
    let sent = await inAir(save());
    while (sent && over > 0 && !stopped.current) {
      over -= SAVE_BATCH_MAX;
      sent = await inAir(save());
    }
    return sent;
  }, [hasUnsent, inAir, queue, save]);

  const finish = useCallback(
    async <T>(send: (batch: LastBatch | null) => Promise<T>): Promise<T> => {
      // Behind a save in the air, but not for long: the last batch carries its answers too.
      const giveUpAt = Date.now() + FINISH_WAIT_MS;
      while (inFlight.current && Date.now() < giveUpAt) {
        await settledWithin(inFlight.current, giveUpAt - Date.now());
      }
      // Nothing is saved beside the paper going in, nor between its retries, nor after it went.
      stopped.current = true;
      // Only one batch may ride the paper, so a backlog past it goes up as saves while it still can.
      let over = queue.size() - SAVE_BATCH_MAX;
      while (over > 0 && (await save())) over -= SAVE_BATCH_MAX;
      const idle = !hasUnsent();
      if (!idle) revision.current += 1;
      const going = (async () => {
        try {
          const done = await send(idle ? null : unsentBatch());
          queue.clear();
          return done;
        } catch (error: unknown) {
          failed(error);
          throw error;
        }
      })();
      void inAir(
        going.then(
          () => true,
          () => false,
        ),
      );
      return going;
    },
    [failed, hasUnsent, inAir, queue, save, unsentBatch],
  );

  const resume = useCallback(() => {
    stopped.current = heldElsewhere.current;
  }, []);

  // Rescheduled each time, so the jitter is redrawn rather than fixed at mount.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const idle = !hasUnsent() && !stopped.current && !inFlight.current;
      // Idle and in touch, the tick still sends: only this device's silence hands the sitting on.
      if (idle && shouldHeartbeat(heardAt.current, Date.now())) void inAir(save());
      else void flush();
      timer = setTimeout(tick, autosaveDelayMs());
    };
    timer = setTimeout(tick, autosaveDelayMs());
    return () => clearTimeout(timer);
  }, [flush, hasUnsent, inAir, save]);

  // The first question is open from the moment the paper is on screen, not from the first click.
  useEffect(() => {
    openedAt.current = Date.now();
    heardAt.current = Date.now();
    queue.attach();
    // Unmounted, a save still in the air is left to land; only its give-up timer goes.
    return () => {
      queue.detach();
      clearTimeout(giveUp.current);
    };
  }, [queue]);

  const record = useCallback(
    (change: AnswerChange) => {
      if (heldElsewhere.current) return;
      queue.put(change);
      const drawn = answersNow.current;
      commit({ ...drawn, [change.questionId]: answerOf(change, drawn[change.questionId]) });
    },
    [commit, queue],
  );

  /** Banks the seconds the open question has cost so far, and starts its clock again from now. */
  const bankOpen = useCallback(() => {
    const questionId = openQuestion.current;
    if (questionId === null) return;

    const now = Date.now();
    const held = answersNow.current[questionId];
    // Unseeded, a bare visit reads as "no answer" and would clear one the server holds.
    if (!seeded.current && held === undefined) {
      openedAt.current = now;
      return;
    }
    const spent = Math.max(0, Math.round((now - openedAt.current) / 1000));
    // The instant it came on screen, not the instant it left: that is what "first" means.
    const change = visitFor(questionId, held, spent, seenAtOf(openedAt));
    openedAt.current = now;
    record(change);
  }, [record]);

  const open = useCallback(
    (questionId: string | null) => {
      if (questionId === openQuestion.current) return;
      bankOpen();
      openQuestion.current = questionId;
      openedAt.current = Date.now();
    },
    [bankOpen],
  );

  const answer = useCallback(
    (questionId: string, next: AnswerIntent) => {
      const spent = Math.max(0, Math.round((Date.now() - openedAt.current) / 1000));
      const seenAt = seenAtOf(openedAt);
      openedAt.current = Date.now();
      record(changeFor(questionId, answersNow.current[questionId], next, spent, seenAt));
      // Between saves only, and not after one failed: the timer retries, rather than every tap.
      if (!inFlight.current && !lastSaveFailed.current && shouldFlushNow(queue.size())) {
        void flush();
      }
    },
    [flush, queue, record],
  );

  const markSection = useCallback(
    (sectionId: string, progress: SectionProgress) => {
      setSections((held) => ({ ...held, [sectionId]: { ...held[sectionId], ...progress } }));
      queue.putSection(sectionId, progress);
    },
    [queue],
  );

  const enterSection = useCallback(
    (sectionId: string, remainingSec: number) =>
      markSection(sectionId, { remainingSec, closed: false }),
    [markSection],
  );

  const closeSection = useCallback(
    (sectionId: string, remainingSec: number) =>
      markSection(sectionId, { remainingSec, closed: true }),
    [markSection],
  );

  // Fire and forget, on keepalive: the page is gone before any answer could be read.
  const leave = useCallback(() => {
    // The paper going in carries everything unsent itself; a keepalive save beside it is one more write.
    if (stopped.current) return;
    bankOpen();
    if (!hasUnsent()) return;
    revision.current += 1;
    const { api, tab } = mounted.current;
    void api.me
      .saveAttemptState(attemptId, { ...unsentBatch(), tab }, { keepalive: true })
      .catch(() => undefined);
  }, [attemptId, bankOpen, hasUnsent, unsentBatch]);

  return {
    answers,
    sections,
    sectionsSettled,
    clock,
    isSaving,
    hasUnsaved,
    takenOver,
    setAside,
    standDown,
    answer,
    open,
    bankOpen,
    enterSection,
    closeSection,
    flush,
    finish,
    resume,
    hasUnsent,
    leave,
  };
}

/** What the bottom bar produces, before the server decides what it really means. */
function changeFor(
  questionId: string,
  held: LiveAnswer | undefined,
  next: AnswerIntent,
  spentSec: number,
  seenAt: string,
): AnswerChange {
  const option =
    next.selectedOptionId === undefined ? held?.selectedOptionId : next.selectedOptionId;
  const marked = next.marked ?? isReviewState(held?.state);

  return {
    questionId,
    state: stateFor(option ?? null, marked),
    selectedOptionId: option ?? null,
    typedAnswer: null,
    timeSpentSec: (held?.timeSpentSec ?? 0) + spentSec,
    firstActionAt: held?.firstActionAt ?? seenAt,
  };
}

/** Leaving a question banks what it cost. It never touches the answer — only the clock and the visit. */
function visitFor(
  questionId: string,
  held: LiveAnswer | undefined,
  spentSec: number,
  seenAt: string,
): AnswerChange {
  return {
    questionId,
    // Seen and left blank is a real state; every other state already outranks it.
    state:
      held?.state === undefined || held.state === ANSWER_STATE.NOT_VISITED
        ? ANSWER_STATE.NOT_ANSWERED
        : held.state,
    selectedOptionId: held?.selectedOptionId ?? null,
    typedAnswer: held?.typedAnswer ?? null,
    timeSpentSec: (held?.timeSpentSec ?? 0) + spentSec,
    firstActionAt: held?.firstActionAt ?? seenAt,
  };
}

/** The screen's guess. The server derives the truth from the same two facts and wins. */
function stateFor(option: string | null, marked: boolean): AnswerState {
  if (option !== null) return marked ? ANSWER_STATE.ANSWERED_MARKED : ANSWER_STATE.ANSWERED;
  return marked ? ANSWER_STATE.MARKED_REVIEW : ANSWER_STATE.NOT_ANSWERED;
}

/** Settles when `run` does or after `ms`, whichever comes first. */
function settledWithin(run: Promise<unknown>, ms: number): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([run, late]).finally(() => clearTimeout(timer));
}

/** An epoch ref as an instant. Zero means the clock never started, which is not a time to record. */
const seenAtOf = (at: { current: number }): string =>
  new Date(at.current === 0 ? Date.now() : at.current).toISOString();

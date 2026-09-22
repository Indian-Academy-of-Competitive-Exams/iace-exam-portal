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
  type AnswerChange,
  type AnswerState,
  type ExamClock,
  type LiveAnswer,
  type SectionProgress,
} from '@iace/contracts';
import { type AppApiClient } from '../api-client';
import { autosaveDelayMs, seedRevision, shouldFlushNow } from '../autosave-policy';
import { type KeyValueStorage } from '../token-store';

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

const queueKeyFor = ({ keyPrefix }: AnswerQueue, attemptId: string) => `${keyPrefix}.${attemptId}`;

/** Undelivered answers outlive a reload here, because the queue they sit in does not. */
function queuedIn(queue: AnswerQueue, attemptId: string): AnswerChange[] {
  try {
    const held = queue.storage.getItem(queueKeyFor(queue, attemptId));
    return held === null ? [] : (JSON.parse(held) as AnswerChange[]);
  } catch {
    return [];
  }
}

const answersFrom = (queued: readonly AnswerChange[]): Record<string, LiveAnswer> =>
  queued.reduce<Record<string, LiveAnswer>>(
    (held, change) => ({ ...held, [change.questionId]: answerOf(change, held[change.questionId]) }),
    {},
  );

export interface AttemptStateHandle {
  answers: Readonly<Record<string, LiveAnswer>>;
  sections: Readonly<Record<string, SectionProgress>>;
  /** The clock as the last save left it, so an extension reaches the screen without a reload. */
  clock: ExamClock | null;
  /** True while a save is in flight; the screen says "Saving…" and never blocks on it. */
  isSaving: boolean;
  /** True once a save has failed and not yet succeeded — the one thing a student must see. */
  hasUnsaved: boolean;
  /** True once this tab stopped holding the sitting, because it was opened somewhere else. */
  takenOver: boolean;
  /** Stops saving and says why: another tab or device holds the sitting now. */
  standDown: () => void;
  /** What happened, in the screen's words. Time on the question is this hook's bookkeeping. */
  answer: (questionId: string, next: AnswerIntent) => void;
  /** Which question is on screen now, so the time on the last one can be banked. */
  open: (questionId: string | null) => void;
  /** Banks the open question's seconds without moving off it — before a flush that must be whole. */
  bankOpen: () => void;
  closeSection: (sectionId: string, remainingSec: number) => void;
  /** Pushes whatever is pending now — on a section change, and before submitting. */
  flush: () => Promise<void>;
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

/** What the bottom bar can say. Absent means "leave that half as it was". */
export interface AnswerIntent {
  selectedOptionId?: string | null;
  marked?: boolean;
}

export function useAttemptState(
  attemptId: string,
  deps: Readonly<AttemptStateDeps>,
): AttemptStateHandle {
  // As of mount, in a ref: callers pass an inline object, and depending on it would restart autosave every render.
  const mounted = useRef(deps);
  // Read once, at mount: what a save could not deliver before a reload is queued and drawn again.
  const [queued] = useState(() => queuedIn(deps.answerQueue, attemptId));
  const [answers, setAnswers] = useState<Record<string, LiveAnswer>>(() => answersFrom(queued));
  const [sections, setSections] = useState<Record<string, SectionProgress>>({});
  const [clock, setClock] = useState<ExamClock | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);
  const [takenOver, setTakenOver] = useState(false);
  const stopped = useRef(false);

  // Refs, not state: the timer closes over them once and must still see the latest edit.
  const pending = useRef(new Map<string, AnswerChange>(queued.map((c) => [c.questionId, c])));
  const pendingSections = useRef<Record<string, SectionProgress>>({});
  const openedAt = useRef(0);
  const openQuestion = useRef<string | null>(null);
  const revision = useRef(0);
  const inFlight = useRef(false);

  // Starts from the queue, then kept level with the state by every writer below, so banking never waits.
  const answersNow = useRef<Record<string, LiveAnswer>>(answers);
  const remember = (next: Record<string, LiveAnswer>): Record<string, LiveAnswer> => {
    answersNow.current = next;
    return next;
  };

  // Seeded once from the server: a reloaded tab has answers it cannot otherwise see.
  useEffect(() => {
    let live = true;
    void mounted.current.api.me.attemptState(attemptId).then((held) => {
      if (!live) return;
      // Merged under, never over: an answer given while this flew is the newer one.
      setAnswers((mine) => remember({ ...held.answers, ...mine }));
      setSections((mine) => ({ ...held.sections, ...mine }));
      // Never backwards: a flush racing this GET may already have moved the counter on.
      revision.current = seedRevision(revision.current, held.revision);
    });
    return () => {
      live = false;
    };
  }, [attemptId]);

  const standDown = useCallback(() => {
    stopped.current = true;
    setTakenOver(true);
  }, []);

  const keepQueue = useCallback(() => {
    const queued = [...pending.current.values()];
    const { answerQueue } = mounted.current;
    const key = queueKeyFor(answerQueue, attemptId);
    if (queued.length === 0) answerQueue.storage.removeItem(key);
    else answerQueue.storage.setItem(key, JSON.stringify(queued));
  }, [attemptId]);

  const flush = useCallback(async () => {
    if (inFlight.current || stopped.current) return;
    const changes = [...pending.current.values()];
    const movedSections = pendingSections.current;
    if (changes.length === 0 && Object.keys(movedSections).length === 0) return;

    // Cleared BEFORE the request, so an edit made while it flies belongs to the next batch.
    pending.current = new Map();
    pendingSections.current = {};
    inFlight.current = true;
    revision.current += 1;
    const sent = revision.current;
    setIsSaving(true);

    // Under whatever arrived while this flew, never over it: that copy is the newer one.
    const requeue = () => {
      for (const change of changes) {
        if (!pending.current.has(change.questionId)) pending.current.set(change.questionId, change);
      }
      pendingSections.current = { ...movedSections, ...pendingSections.current };
    };

    try {
      const { api, tab } = mounted.current;
      const saved = await api.me.saveAttemptState(attemptId, {
        revision: sent,
        answers: changes,
        sections: movedSections,
        tab,
      });
      // A server already past what we sent dropped this batch as stale and answered 200 anyway.
      const dropped = saved.revision > sent;
      revision.current = seedRevision(revision.current, saved.revision);
      // Answering is also a clock check: the deadline it answers with is the one that counts.
      setClock({ endsAt: saved.endsAt, serverNow: saved.serverNow, arrivedAt: Date.now() });
      if (dropped) requeue();
      setHasUnsaved(dropped);
    } catch (error: unknown) {
      requeue();
      setHasUnsaved(true);
      // Answering moved to another tab or device: this one stops rather than fighting it.
      if (isTakenOver(error)) standDown();
    } finally {
      keepQueue();
      inFlight.current = false;
      setIsSaving(false);
    }
  }, [attemptId, keepQueue, standDown]);

  // Rescheduled each time, so the jitter is redrawn rather than fixed at mount.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      void flush();
      timer = setTimeout(tick, autosaveDelayMs());
    };
    timer = setTimeout(tick, autosaveDelayMs());
    return () => clearTimeout(timer);
  }, [flush]);

  // The first question is open from the moment the paper is on screen, not from the first click.
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  /** Banks the seconds the open question has cost so far, and starts its clock again from now. */
  const bankOpen = useCallback(() => {
    const questionId = openQuestion.current;
    if (questionId === null) return;

    const now = Date.now();
    const spent = Math.max(0, Math.round((now - openedAt.current) / 1000));
    // The instant it came on screen, not the instant it left: that is what "first" means.
    const change = visitFor(questionId, answersNow.current[questionId], spent, seenAtOf(openedAt));
    openedAt.current = now;

    pending.current.set(questionId, change);
    setAnswers((held) => remember({ ...held, [questionId]: answerOf(change, held[questionId]) }));
  }, []);

  const open = useCallback(
    (questionId: string | null) => {
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

      setAnswers((held) => {
        const change = changeFor(questionId, held[questionId], next, spent, seenAt);
        pending.current.set(questionId, change);
        keepQueue();
        if (shouldFlushNow(pending.current.size)) void flush();
        return remember({ ...held, [questionId]: answerOf(change, held[questionId]) });
      });
    },
    [flush, keepQueue],
  );

  const closeSection = useCallback((sectionId: string, remainingSec: number) => {
    const progress: SectionProgress = { remainingSec, closed: true };
    setSections((held) => ({ ...held, [sectionId]: progress }));
    pendingSections.current = { ...pendingSections.current, [sectionId]: progress };
  }, []);

  return {
    answers,
    sections,
    clock,
    isSaving,
    hasUnsaved,
    takenOver,
    standDown,
    answer,
    open,
    bankOpen,
    closeSection,
    flush,
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
  const marked = next.marked ?? isMarked(held?.state);

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

const isMarked = (state: AnswerState | undefined): boolean =>
  state === ANSWER_STATE.MARKED_REVIEW || state === ANSWER_STATE.ANSWERED_MARKED;

/** The screen's guess. The server derives the truth from the same two facts and wins. */
function stateFor(option: string | null, marked: boolean): AnswerState {
  if (option !== null) return marked ? ANSWER_STATE.ANSWERED_MARKED : ANSWER_STATE.ANSWERED;
  return marked ? ANSWER_STATE.MARKED_REVIEW : ANSWER_STATE.NOT_ANSWERED;
}

/** An epoch ref as an instant. Zero means the clock never started, which is not a time to record. */
const seenAtOf = (at: { current: number }): string =>
  new Date(at.current === 0 ? Date.now() : at.current).toISOString();

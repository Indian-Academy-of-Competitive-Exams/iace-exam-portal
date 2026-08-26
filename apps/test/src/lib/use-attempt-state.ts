/**
 * The screen's own answers, saved in batches. LOCAL state is what the screen draws:
 * a save that fails must never take an answer off the screen, so nothing here waits
 * on the server, and what a save could not deliver stays queued for the next one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ANSWER_STATE,
  type AnswerChange,
  type AnswerState,
  type LiveAnswer,
  type SectionProgress,
} from '@iace/contracts';
import { api } from './api';

/** Often enough that a crash costs a question or two, rare enough to be nothing at 5,000 sittings. */
export const AUTOSAVE_EVERY_MS = 25_000;

export interface AttemptStateHandle {
  answers: Readonly<Record<string, LiveAnswer>>;
  sections: Readonly<Record<string, SectionProgress>>;
  /** True while a save is in flight; the screen says "Saving…" and never blocks on it. */
  isSaving: boolean;
  /** True once a save has failed and not yet succeeded — the one thing a student must see. */
  hasUnsaved: boolean;
  /** What happened, in the screen's words. Time on the question is this hook's bookkeeping. */
  answer: (questionId: string, next: AnswerIntent) => void;
  /** Which question is on screen now, so the time on the last one can be banked. */
  open: (questionId: string | null) => void;
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
});

/** What the bottom bar can say. Absent means "leave that half as it was". */
export interface AnswerIntent {
  selectedOptionId?: string | null;
  marked?: boolean;
}

export function useAttemptState(attemptId: string): AttemptStateHandle {
  const [answers, setAnswers] = useState<Record<string, LiveAnswer>>({});
  const [sections, setSections] = useState<Record<string, SectionProgress>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsaved, setHasUnsaved] = useState(false);

  // Refs, not state: the timer closes over them once and must still see the latest edit.
  const pending = useRef(new Map<string, AnswerChange>());
  const pendingSections = useRef<Record<string, SectionProgress>>({});
  const openedAt = useRef(0);
  const revision = useRef(0);
  const inFlight = useRef(false);

  const flush = useCallback(async () => {
    if (inFlight.current) return;
    const changes = [...pending.current.values()];
    const movedSections = pendingSections.current;
    if (changes.length === 0 && Object.keys(movedSections).length === 0) return;

    // Cleared BEFORE the request, so an edit made while it flies belongs to the next batch.
    pending.current = new Map();
    pendingSections.current = {};
    inFlight.current = true;
    revision.current += 1;
    setIsSaving(true);

    try {
      await api.me.saveAttemptState(attemptId, {
        revision: revision.current,
        answers: changes,
        sections: movedSections,
      });
      setHasUnsaved(false);
    } catch {
      for (const change of changes) {
        if (!pending.current.has(change.questionId)) pending.current.set(change.questionId, change);
      }
      pendingSections.current = { ...movedSections, ...pendingSections.current };
      setHasUnsaved(true);
    } finally {
      inFlight.current = false;
      setIsSaving(false);
    }
  }, [attemptId]);

  useEffect(() => {
    const timer = setInterval(() => void flush(), AUTOSAVE_EVERY_MS);
    return () => clearInterval(timer);
  }, [flush]);

  // The first question is open from the moment the paper is on screen, not from the first click.
  useEffect(() => {
    openedAt.current = Date.now();
  }, []);

  const open = useCallback((_questionId: string | null) => {
    openedAt.current = Date.now();
  }, []);

  const answer = useCallback((questionId: string, next: AnswerIntent) => {
    const spent = Math.max(0, Math.round((Date.now() - openedAt.current) / 1000));

    setAnswers((held) => {
      const change = changeFor(questionId, held[questionId], next, spent);
      pending.current.set(questionId, change);
      return { ...held, [questionId]: answerOf(change, held[questionId]) };
    });
  }, []);

  const closeSection = useCallback((sectionId: string, remainingSec: number) => {
    const progress: SectionProgress = { remainingSec, closed: true };
    setSections((held) => ({ ...held, [sectionId]: progress }));
    pendingSections.current = { ...pendingSections.current, [sectionId]: progress };
  }, []);

  return {
    answers,
    sections,
    isSaving,
    hasUnsaved,
    answer,
    open,
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
  };
}

const isMarked = (state: AnswerState | undefined): boolean =>
  state === ANSWER_STATE.MARKED_REVIEW || state === ANSWER_STATE.ANSWERED_MARKED;

/** The screen's guess. The server derives the truth from the same two facts and wins. */
function stateFor(option: string | null, marked: boolean): AnswerState {
  if (option !== null) return marked ? ANSWER_STATE.ANSWERED_MARKED : ANSWER_STATE.ANSWERED;
  return marked ? ANSWER_STATE.MARKED_REVIEW : ANSWER_STATE.NOT_ANSWERED;
}

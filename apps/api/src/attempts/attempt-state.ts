import {
  ANSWER_STATE,
  type AnswerChange,
  type AnswerState,
  type LiveAnswer,
  type SaveAttemptStateBody,
  type SectionProgress,
} from '@iace/contracts';
import { decodeAnswer, encodeAnswer, type AnswerSlot } from './answer-sheet';

/** The rules a live sitting merges by. Pure: handed the held state and a batch, it returns the next. */

/** A request in flight as the clock expires is not cheating, so a save is taken this long after. */
export const SAVE_GRACE_SEC = 30;

/** What Redis holds, plus the facts a save is judged against so judging one never reads Postgres. */
export interface HeldState {
  attemptId: string;
  studentId: string;
  /** The paper and the start a flush places and times answers against. */
  testId: string;
  /** ISO. */
  startedAt: string;
  /** ISO, the server's own deadline — the client's clock never decides whether a save is late. */
  endsAt: string;
  revision: number;
  answers: Record<string, LiveAnswer>;
  /** Questions changed since the last flush. Absent on a key written before this shipped. */
  pending?: string[];
  sections: Record<string, SectionProgress>;
  /** The tab answering: a string holds it, null was stood down, absent is a key put back cold. */
  tab?: string | null;
}

/** What the KEY holds: the sheet's own slot per answer, still keyed by question. */
export interface StoredState extends Omit<HeldState, 'answers'> {
  answers: Record<string, AnswerSlot>;
}

/** The option stays an id here: placing it in the paper's order would mean reading the paper. */
const KEPT_AS_AN_ID: readonly string[] = [];

/** By position: a save rewrites the whole key, and named cost 24.6 KB a sitting against 10.3. */
export function packHeld(held: HeldState): StoredState {
  const startedAt = new Date(held.startedAt);
  return {
    ...held,
    answers: Object.fromEntries(
      Object.entries(held.answers).map(([questionId, answer]) => [
        questionId,
        encodeAnswer(answer, KEPT_AS_AN_ID, startedAt),
      ]),
    ),
  };
}

/** Anything this cannot read is no key at all, so the sitting is rebuilt from Postgres instead. */
export function heldIn(stored: unknown): HeldState | null {
  if (!isStoredState(stored)) return null;
  const startedAt = new Date(stored.startedAt);
  const answers: Record<string, LiveAnswer> = {};
  for (const [questionId, slot] of Object.entries(stored.answers)) {
    const answer = decodeAnswer(slot, KEPT_AS_AN_ID, startedAt);
    if (answer) answers[questionId] = answer;
  }
  return { ...stored, answers };
}

/** A key written before this shipped holds objects where slots go, and is not half-read. */
function isStoredState(stored: unknown): stored is StoredState {
  if (typeof stored !== 'object' || stored === null) return false;
  const held = stored as Partial<StoredState>;
  if (typeof held.attemptId !== 'string' || typeof held.startedAt !== 'string') return false;
  if (typeof held.answers !== 'object' || held.answers === null) return false;
  return Object.values(held.answers).every((slot) => Array.isArray(slot));
}

const hasAnswer = (change: AnswerChange): boolean =>
  (change.selectedOptionId ?? null) !== null || (change.typedAnswer ?? '').trim() !== '';

const isMarked = (state: AnswerState): boolean =>
  state === ANSWER_STATE.MARKED_REVIEW || state === ANSWER_STATE.ANSWERED_MARKED;

/** The screen says what it believes; this decides, from whether an answer is there and marked. */
export function stateOf(change: AnswerChange): AnswerState {
  const marked = isMarked(change.state);

  if (hasAnswer(change)) return marked ? ANSWER_STATE.ANSWERED_MARKED : ANSWER_STATE.ANSWERED;
  if (marked) return ANSWER_STATE.MARKED_REVIEW;
  // Clearing a response returns it to seen-and-unanswered, never to never-seen.
  return change.state === ANSWER_STATE.NOT_VISITED
    ? ANSWER_STATE.NOT_VISITED
    : ANSWER_STATE.NOT_ANSWERED;
}

/** Time is a total, not a delta, and a screen that restarts must not shorten what was spent. */
function timeFor(held: LiveAnswer | undefined, change: AnswerChange): number {
  return Math.max(held?.timeSpentSec ?? 0, change.timeSpentSec);
}

function answerFor(held: LiveAnswer | undefined, change: AnswerChange, now: Date): LiveAnswer {
  const state = stateOf(change);
  const answered = state === ANSWER_STATE.ANSWERED || state === ANSWER_STATE.ANSWERED_MARKED;

  return {
    state,
    // Held nowhere but here: an unanswered row keeps no stale option to be scored later.
    selectedOptionId: answered ? (change.selectedOptionId ?? null) : null,
    typedAnswer: answered ? (change.typedAnswer ?? null) : null,
    timeSpentSec: timeFor(held, change),
    // The moment it was first given, kept across later saves so a flush is the same write twice.
    answeredAt: answered ? (held?.answeredAt ?? now.toISOString()) : null,
    // The EARLIEST wins, whichever side it came from: a first touch cannot happen twice.
    firstActionAt: earliest(held?.firstActionAt, change.firstActionAt) ?? now.toISOString(),
  };
}

/** A tab may answer while it holds the sitting, or while a key put back cold is held by nobody. */
export function holdsSitting(held: HeldState, tab: string | undefined): boolean {
  if (tab === undefined) return true;
  return held.tab === undefined || held.tab === tab;
}

/** At or below the held revision is a batch a newer save already carried, not one to replay. */
export function isStale(held: HeldState, batch: SaveAttemptStateBody): boolean {
  return batch.revision <= held.revision;
}

export function applyBatch(
  held: HeldState,
  batch: SaveAttemptStateBody,
  now: Date = new Date(),
): HeldState {
  if (isStale(held, batch)) return held;

  const answers = { ...held.answers };
  for (const change of batch.answers) {
    answers[change.questionId] = answerFor(answers[change.questionId], change, now);
  }

  return {
    ...held,
    revision: batch.revision,
    answers,
    pending: [...new Set([...(held.pending ?? []), ...batch.answers.map((c) => c.questionId)])],
    sections: batch.sections ? { ...held.sections, ...batch.sections } : held.sections,
  };
}

function sameAnswer(a: LiveAnswer | undefined, b: LiveAnswer | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return (
    a.state === b.state &&
    a.selectedOptionId === b.selectedOptionId &&
    a.typedAnswer === b.typedAnswer &&
    a.timeSpentSec === b.timeSpentSec &&
    a.answeredAt === b.answeredAt &&
    a.firstActionAt === b.firstActionAt
  );
}

/** What stays pending once a flush wrote `written`: an answer a save changed since then has not landed. */
export function pendingAfter(
  held: HeldState,
  written: Readonly<Record<string, LiveAnswer>>,
): string[] {
  return (held.pending ?? []).filter(
    (questionId) => !sameAnswer(held.answers[questionId], written[questionId]),
  );
}

/** Whether a save arriving now is still in time. Past the deadline and its grace, it is not. */
export function isInTime(held: HeldState, now: Date): boolean {
  return now.getTime() <= Date.parse(held.endsAt) + SAVE_GRACE_SEC * MILLISECONDS_PER_SECOND;
}

const MILLISECONDS_PER_SECOND = 1000;

/** The first of two instants, either of which may be absent. A missing one never wins. */
function earliest(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return a < b ? a : b;
}

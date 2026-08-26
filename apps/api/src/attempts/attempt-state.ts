import {
  ANSWER_STATE,
  type AnswerChange,
  type AnswerState,
  type LiveAnswer,
  type SaveAttemptStateBody,
  type SectionProgress,
} from '@iace/contracts';

/** The rules a live sitting merges by. Pure: handed the held state and a batch, it returns the next. */

/** A request in flight as the clock expires is not cheating, so a save is taken this long after. */
export const SAVE_GRACE_SEC = 30;

/** What Redis holds, plus the facts a save is judged against so judging one never reads Postgres. */
export interface HeldState {
  attemptId: string;
  studentId: string;
  /** ISO, the server's own deadline — the client's clock never decides whether a save is late. */
  endsAt: string;
  revision: number;
  answers: Record<string, LiveAnswer>;
  sections: Record<string, SectionProgress>;
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
  };
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
    sections: batch.sections ? { ...held.sections, ...batch.sections } : held.sections,
  };
}

/** Whether a save arriving now is still in time. Past the deadline and its grace, it is not. */
export function isInTime(held: HeldState, now: Date): boolean {
  return now.getTime() <= Date.parse(held.endsAt) + SAVE_GRACE_SEC * MILLISECONDS_PER_SECOND;
}

const MILLISECONDS_PER_SECOND = 1000;

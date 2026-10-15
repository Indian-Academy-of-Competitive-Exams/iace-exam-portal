/** What the exam hall shows, decided apart from the hall so every branch can be tested without a phone. */
import { AppException, ErrorCodes } from '@iace/contracts';
import { isHeldElsewhere, type ExamView } from '@iace/app-kit';

export const EXAM_ENTRY = {
  WAIT: 'WAIT',
  NEEDS_KEYBOARD: 'NEEDS_KEYBOARD',
  SIT: 'SIT',
} as const;
export type ExamEntry = (typeof EXAM_ENTRY)[keyof typeof EXAM_ENTRY];

/** A brief that did not load is no reason to keep a candidate from an ordinary paper. */
export function examEntry(brief: { isPending: boolean; needsKeyboard: boolean }): ExamEntry {
  if (brief.needsKeyboard) return EXAM_ENTRY.NEEDS_KEYBOARD;
  return brief.isPending ? EXAM_ENTRY.WAIT : EXAM_ENTRY.SIT;
}

export const SITTING_SCREEN = {
  HANDED_IN: 'HANDED_IN',
  HELD_ELSEWHERE: 'HELD_ELSEWHERE',
  START_REFUSED: 'START_REFUSED',
  PAPER_FAILED: 'PAPER_FAILED',
  LIVE: 'LIVE',
} as const;

export const SITTING_COVER = {
  NONE: 'NONE',
  TAKEN_OVER: 'TAKEN_OVER',
  ENDED: 'ENDED',
} as const;

export type SittingScreen =
  | { screen: typeof SITTING_SCREEN.HANDED_IN; attemptId: string }
  | { screen: typeof SITTING_SCREEN.HELD_ELSEWHERE }
  | { screen: typeof SITTING_SCREEN.START_REFUSED }
  | { screen: typeof SITTING_SCREEN.PAPER_FAILED }
  | {
      screen: typeof SITTING_SCREEN.LIVE;
      cover: typeof SITTING_COVER.NONE | typeof SITTING_COVER.TAKEN_OVER;
    }
  | { screen: typeof SITTING_SCREEN.LIVE; cover: typeof SITTING_COVER.ENDED; attemptId: string };

type StoodDown = Pick<ExamView, 'takenOver' | 'ended'>;

export interface SittingFacts {
  /** The start's error, or null while it has not failed. */
  startError: unknown;
  /** The sitting a Resume or Continue here names. */
  resume?: string;
  paperFailed: boolean;
  view: StoodDown | null;
  startedId?: string;
}

export function sittingScreen(facts: SittingFacts): SittingScreen {
  const { startError, resume, view, startedId } = facts;
  if (startError !== null) {
    const handedIn = AppException.is(startError) && startError.code === ErrorCodes.SITTING_ENDED;
    if (resume && handedIn) return { screen: SITTING_SCREEN.HANDED_IN, attemptId: resume };
    if (isHeldElsewhere(startError)) return { screen: SITTING_SCREEN.HELD_ELSEWHERE };
    return { screen: SITTING_SCREEN.START_REFUSED };
  }
  if (facts.paperFailed) return { screen: SITTING_SCREEN.PAPER_FAILED };
  if (view?.ended && startedId) {
    return { screen: SITTING_SCREEN.LIVE, cover: SITTING_COVER.ENDED, attemptId: startedId };
  }
  return {
    screen: SITTING_SCREEN.LIVE,
    cover: view?.takenOver ? SITTING_COVER.TAKEN_OVER : SITTING_COVER.NONE,
  };
}

/** Android's Back would drop a running paper; in a sitting the only way out is handing it in. */
export const backAsksToSubmit = (view: StoodDown | null): boolean =>
  view !== null && !view.takenOver && !view.ended;

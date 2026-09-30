/**
 * What a template is given. Everything a skin can draw and every move a
 * candidate can make is on this one object, so a skin holds no state, owns no
 * clock and reaches for no mutation — it renders what it is handed.
 */
import { ANSWER_STATE, type AnswerState } from '@iace/contracts';
import type {
  ExamClock,
  ExamQuestion,
  ExamSection,
  LanguageCode,
  LanguageMode,
  LiveAnswer,
  PaletteCounts,
  TestUi,
} from '@iace/contracts';

/** What each of the five states is called, so the two clients' palettes can never name one differently. */
export const ANSWER_STATE_LABELS: Readonly<Record<AnswerState, string>> = {
  [ANSWER_STATE.NOT_VISITED]: 'Not visited',
  [ANSWER_STATE.NOT_ANSWERED]: 'Not answered',
  [ANSWER_STATE.ANSWERED]: 'Answered',
  [ANSWER_STATE.MARKED_REVIEW]: 'Marked for review',
  [ANSWER_STATE.ANSWERED_MARKED]: 'Answered and marked',
};

/** Submitting, and what the candidate is told before it happens. */
export interface ExamSubmitView {
  asking: boolean;
  isPending: boolean;
  /** True once every retry is spent: the paper could not go in, and the skin must say so. */
  failed: boolean;
  unanswered: number;
  markedForReview: number;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
  retry: () => void;
}

function countOf(count: number, noun: string): string {
  const nouns = count === 1 ? noun : `${noun}s`;
  return `${count} ${nouns}`;
}

/** A forward-only paper marks nothing for review, so its confirm does not count what cannot exist. */
export function submittingSays({ submit, forwardOnly }: ExamView): string {
  const marked = forwardOnly ? '' : ` and ${submit.markedForReview} marked for review`;
  return `${countOf(submit.unanswered, 'question')} unanswered${marked}. Once submitted the paper closes and nothing more can be changed.`;
}

/** The stand-down screen's words: which kind of move stopped this tab, and where its unsent answers are. */
export function stoodDownSays({ setAside, hasUnsent }: Pick<ExamView, 'setAside' | 'hasUnsent'>): {
  title: string;
  hint: string;
} {
  const kept = hasUnsent()
    ? 'Answers not yet saved are kept on this device, and go up if you continue here.'
    : 'Your answers are saved.';
  return setAside
    ? {
        title: 'Another of your tests is open',
        hint: `${kept} Continuing here stops the other test.`,
      }
    : {
        title: 'This test is open on another tab or device',
        hint: `${kept} Continuing here stops the other one.`,
      };
}

export const TIMER_KIND = { SECTION: 'SECTION', PAPER: 'PAPER' } as const;

/** The one clock on screen, chosen by the engine: a skin draws the kind it is handed. */
export type ExamTimerView =
  | { kind: typeof TIMER_KIND.SECTION; key: string; allowedSec: number; onExpire: () => void }
  | { kind: typeof TIMER_KIND.PAPER; clock: ExamClock; onExpire: () => void };

/** Leaving full screen is asked about; a skin cannot decide not to. */
export interface ExamFullscreenView {
  nagging: boolean;
  /** So a skin can offer the way IN, not only be nagged once the paper has been left. */
  isFullscreen: boolean;
  isSupported: boolean;
  exits: number;
  enter: () => void;
  ignore: () => void;
}

export interface ExamView {
  title: string;
  /** The one thing on the paper that leads back to a person. Empty means no mark. */
  watermark: string;
  languages: readonly LanguageCode[];
  languageMode: LanguageMode;
  /** How the student answers. CBT picks an option; OMR fills a bubble. One engine under both. */
  testUi: TestUi;

  sections: readonly ExamSection[];
  sectionId: string;
  /** The sections a candidate may open now — under a sectional clock, exactly one. */
  reachable: readonly string[];
  /** A seat left is closed for good: no palette jump back, and nothing to mark for review. */
  forwardOnly: boolean;

  /** This section's questions in the candidate's own order, and the one on screen. */
  questions: readonly ExamQuestion[];
  question: ExamQuestion | undefined;
  questionIndex: number;
  selectedOptionId: string | null;
  marked: boolean;
  answers: Readonly<Record<string, LiveAnswer>>;
  /** The whole paper, which is what submit counts against. */
  counts: PaletteCounts;
  /** Per section, because a palette only ever draws the section it is standing in. */
  sectionCounts: (sectionId: string) => PaletteCounts;

  /** The section's clock under a sectional timer, else the server's deadline for the paper. */
  timer: ExamTimerView;

  isSaving: boolean;
  hasUnsaved: boolean;
  /** Whether anything done has not reached the server yet, read when asked — what a leave prompt checks. */
  hasUnsent: () => boolean;
  /** The page is closing or the app backgrounding: sends what is unsent on a request that outlives it. */
  leave: () => void;
  /** This tab no longer holds the sitting: it was opened in another tab or on another device. */
  takenOver: boolean;
  /** Stopped because another of the student's tests was opened, not because this one went elsewhere. */
  setAside: boolean;

  openQuestion: (questionId: string) => void;
  /** Whether that seat still opens — a screen draws the refusal rather than finding out by click. */
  canOpen: (questionId: string) => boolean;
  nextQuestion: () => void;
  chooseOption: (optionId: string) => void;
  /** OMR's one write: the option and the flag together, because two records are two saves. */
  bubbleAnswer: (optionId: string, fill: number) => void;
  markAndNext: () => void;
  clearResponse: () => void;
  openSection: (sectionId: string) => void;

  submit: ExamSubmitView;
  fullscreen: ExamFullscreenView;
}

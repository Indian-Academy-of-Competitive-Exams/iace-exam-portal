/**
 * What a template is given. Everything a skin can draw and every move a
 * candidate can make is on this one object, so a skin holds no state, owns no
 * clock and reaches for no mutation — it renders what it is handed.
 */
import type {
  ExamClock,
  ExamQuestion,
  ExamSection,
  LanguageCode,
  LanguageMode,
  LiveAnswer,
  PaletteCounts,
} from '@iace/contracts';

/** Submitting, and what the candidate is told before it happens. */
export interface ExamSubmitView {
  asking: boolean;
  isPending: boolean;
  unanswered: number;
  markedForReview: number;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
}

/** Leaving full screen is recorded and asked about; a skin cannot decide not to. */
export interface ExamFullscreenView {
  nagging: boolean;
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

  sections: readonly ExamSection[];
  sectionId: string;
  section: ExamSection | undefined;
  /** The sections a candidate may open now — under a sectional clock, exactly one. */
  reachable: readonly string[];
  sectional: boolean;

  /** This section's questions in the candidate's own order, and the one on screen. */
  questions: readonly ExamQuestion[];
  question: ExamQuestion | undefined;
  questionIndex: number;
  selectedOptionId: string | null;
  marked: boolean;
  answers: Readonly<Record<string, LiveAnswer>>;
  counts: PaletteCounts;

  /** The server's deadline. A skin counts down to it and never computes one. */
  clock: ExamClock;
  /** How long this section allows, or null when one clock covers the paper. */
  sectionSec: number | null;

  isSaving: boolean;
  hasUnsaved: boolean;

  openQuestion: (questionId: string) => void;
  nextQuestion: () => void;
  chooseOption: (optionId: string) => void;
  markAndNext: () => void;
  clearResponse: () => void;
  openSection: (sectionId: string) => void;
  /** The section's clock ran out: it shuts for good and the next open one takes over. */
  endSection: () => void;
  /** The paper's clock ran out. */
  outOfTime: () => void;

  submit: ExamSubmitView;
  fullscreen: ExamFullscreenView;
}

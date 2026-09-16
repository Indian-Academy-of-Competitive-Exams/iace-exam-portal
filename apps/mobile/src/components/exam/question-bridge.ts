/**
 * The vocabulary both sides of QuestionContent's WebView speak. It imports
 * nothing, because the page bundles it too and must not drag zod in with it.
 */

/** What the page may say. Native re-validates every one before acting on it. */
export const PAGE_MESSAGE = {
  READY: 'READY',
  CHOOSE: 'CHOOSE',
  BUBBLE: 'BUBBLE',
} as const;

/** The page's one entry point: native calls it with the whole screen, every time. */
export const SHOW_QUESTION = 'iaceShowQuestion' as const;

export type PageMessage =
  | { type: typeof PAGE_MESSAGE.READY }
  | { type: typeof PAGE_MESSAGE.CHOOSE; optionId: string }
  | { type: typeof PAGE_MESSAGE.BUBBLE; optionId: string; fill: number };

/** Authored markup in one language, still unsanitised: the page runs it through `richHtml`. */
export interface ScreenContent {
  lang: string;
  html: string;
}

export interface ScreenOption {
  id: string;
  /** How much of this option's bubble is inked, 0 to 1. Unread under CBT. */
  fill: number;
  content: ScreenContent[];
}

/** Everything the page draws. It holds nothing else, so native's copy is the only truth. */
export interface QuestionScreen {
  /** The `data-exam-template` value that picks the skin's tokens. */
  template: string;
  bubbling: boolean;
  locked: boolean;
  selectedOptionId: string | null;
  stem: ScreenContent[];
  options: ScreenOption[];
}

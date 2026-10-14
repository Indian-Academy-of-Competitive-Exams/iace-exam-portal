import { AppException } from '@iace/contracts';
import { QUESTION_CODE_FIELD } from '../../lib/constants';
import { toDraft } from './question-scaffold';
import { issuesOf } from './use-question-checks';
import { type Held } from './workspace-types';

/** The fields the bar shows an error on, so a refusal landing wholly on them is not also toasted. */
export const SAVE_FIELDS = [QUESTION_CODE_FIELD] as const;

/** The server's refusal of the code, when that is what a save was refused for. */
export const codeErrorOf = (error: unknown): string | undefined =>
  AppException.is(error) ? error.fieldErrors?.[QUESTION_CODE_FIELD]?.[0] : undefined;

export const sameHeld = (a: Held, b: Held): boolean => JSON.stringify(a) === JSON.stringify(b);

export const invalid = (held: Held): boolean =>
  issuesOf(toDraft(held.state, held.header), held.header).length > 0;

/** How far off a card's top the view may sit and still be at rest on it: layout rounds to whole pixels. */
export const REST_PX = 2;

export const restsOn = (view: HTMLElement, card: HTMLElement | undefined): boolean =>
  card !== undefined && Math.abs(card.offsetTop - view.scrollTop) <= REST_PX;

/** The card to time: the one in view, once it has stopped moving and been read. */
export const restingCard = (atRest: boolean, read: boolean, key: string): string | null =>
  atRest && read ? key : null;

/** With Alt held, the arrow that moves to the previous or the next question. */
const QUESTION_STEP_KEYS: Readonly<Record<string, number>> = { ArrowUp: -1, ArrowDown: 1 };

/** Alt with an arrow, anywhere but inside a dialog, is a move to the previous or next question. */
export function questionStepOf(event: KeyboardEvent): number | null {
  const by = QUESTION_STEP_KEYS[event.key];
  if (!event.altKey || by === undefined) return null;
  const inDialog = event.target instanceof Element && event.target.closest('[role="dialog"]');
  return inDialog ? null : by;
}

export function scrollToCard(card: HTMLElement | undefined) {
  if (!card) return;
  card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const typing = document.activeElement?.closest('[data-card]');
  if (!typing || typing === card) return;
  // Typing follows the card in view, never the one scrolled away.
  const box = card.querySelector<HTMLElement>('[contenteditable="true"]');
  if (box) box.focus({ preventScroll: true });
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

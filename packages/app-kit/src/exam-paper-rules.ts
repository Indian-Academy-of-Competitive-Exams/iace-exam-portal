/** The rules a candidate reads before the paper opens and again from inside it, in one voice on web and mobile. */
import { NAVIGATION_POLICY } from '@iace/contracts';
import { PALETTE_SAYS } from './exam/exam-view';

const CLOCK = {
  term: 'The clock',
  says: 'Set by the server, and it keeps running if you leave this screen. The paper ends by itself when it reaches zero.',
};
const CLEAR = { term: 'Clear response', says: 'Removes your answer entirely.' };
const SUBMIT = {
  term: 'Submit',
  says: 'Hands the paper in for good. It asks you to confirm first, and shows what you are leaving unanswered.',
};
const SECTIONAL = {
  term: 'Sectional timing',
  says: 'Each section has a clock of its own, and a section whose time ends locks — its questions cannot be opened again.',
};

const NEXT = { term: 'Next', says: 'Moves on and leaves the question as it stands.' };
const FREE_PALETTE = { term: 'The palette', says: PALETTE_SAYS[NAVIGATION_POLICY.FREE] };
const FORWARD_PALETTE = {
  term: 'The palette',
  says: PALETTE_SAYS[NAVIGATION_POLICY.FORWARD_ONLY],
};

export type PaperRule = { term: string; says: string };

const FREE_RULES: readonly PaperRule[] = [
  { term: 'Save & next', says: 'Keeps your answer and moves on.' },
  {
    term: 'Mark for review & next',
    says: 'Keeps your answer and flags the question. A flagged answer is still marked.',
  },
  CLEAR,
  FREE_PALETTE,
  SUBMIT,
];

const FORWARD_RULES: readonly PaperRule[] = [
  { term: 'Save & next', says: 'Keeps your answer and moves on. It is the only way forward.' },
  CLEAR,
  FORWARD_PALETTE,
  SUBMIT,
];

/** A bubble sheet has no Save, Mark or Clear to teach: the ink carries all three. */
const OMR_FREE_RULES: readonly PaperRule[] = [
  {
    term: 'The bubble',
    says: 'Hold a bubble to fill it. A full bubble is your answer for good and moves you on. A part-filled one keeps the answer and flags the question for review, and can still be changed.',
  },
  NEXT,
  FREE_PALETTE,
  SUBMIT,
];

const OMR_FORWARD_RULES: readonly PaperRule[] = [
  {
    term: 'The bubble',
    says: 'Hold a bubble to fill it. Once the ink takes that is your answer for good, and a full bubble moves you on.',
  },
  NEXT,
  FORWARD_PALETTE,
  SUBMIT,
];

export interface PaperTraits {
  forwardOnly: boolean;
  sectional: boolean;
  omr: boolean;
}

export function paperRulesFor({ forwardOnly, sectional, omr }: PaperTraits): readonly PaperRule[] {
  const cbt = forwardOnly ? FORWARD_RULES : FREE_RULES;
  const bubbled = forwardOnly ? OMR_FORWARD_RULES : OMR_FREE_RULES;
  return [CLOCK, ...(sectional ? [SECTIONAL] : []), ...(omr ? bubbled : cbt)];
}

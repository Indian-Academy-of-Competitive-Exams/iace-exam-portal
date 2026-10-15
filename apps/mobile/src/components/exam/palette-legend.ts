import { ANSWER_STATE, type AnswerState } from '@iace/contracts';

interface PaletteEntry {
  fill: string;
  ink: string;
}

/** The five states and their colours; app-kit names them, so the two clients cannot label one differently. */
export const PALETTE_LEGEND: Readonly<Record<AnswerState, PaletteEntry>> = {
  [ANSWER_STATE.NOT_VISITED]: { fill: 'bg-exam-notvisited', ink: 'text-exam-notvisited-ink' },
  [ANSWER_STATE.NOT_ANSWERED]: { fill: 'bg-exam-notanswered', ink: 'text-exam-notanswered-ink' },
  [ANSWER_STATE.ANSWERED]: { fill: 'bg-exam-answered', ink: 'text-exam-answered-ink' },
  [ANSWER_STATE.MARKED_REVIEW]: { fill: 'bg-exam-marked', ink: 'text-exam-marked-ink' },
  [ANSWER_STATE.ANSWERED_MARKED]: {
    fill: 'bg-exam-answered-marked',
    ink: 'text-exam-answered-marked-ink',
  },
};

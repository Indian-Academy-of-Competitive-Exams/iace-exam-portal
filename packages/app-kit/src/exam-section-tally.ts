import { ANSWER_STATES, type PaletteCounts } from '@iace/contracts';
import { ANSWER_STATE_LABELS } from './exam/exam-view';

/** What a section costs so far, without opening it; the same five states the palette draws. */
export function sectionTally(counts: PaletteCounts): string {
  return ANSWER_STATES.filter((state) => counts[state] > 0)
    .map((state) => `${counts[state]} ${ANSWER_STATE_LABELS[state].toLowerCase()}`)
    .join(' · ');
}

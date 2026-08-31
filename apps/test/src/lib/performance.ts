import { type SectionalStanding } from '@iace/contracts';

export interface PaperCounts {
  correct: number;
  wrong: number;
  unattempted: number;
}

/** The anchor's own denominator, summed off its sections so every figure shares one paper. */
export function paperCounts(sections: readonly SectionalStanding[]): PaperCounts {
  return sections.reduce<PaperCounts>(
    (total, section) => ({
      correct: total.correct + section.correctCount,
      wrong: total.wrong + section.wrongCount,
      unattempted: total.unattempted + section.unattemptedCount,
    }),
    { correct: 0, wrong: 0, unattempted: 0 },
  );
}

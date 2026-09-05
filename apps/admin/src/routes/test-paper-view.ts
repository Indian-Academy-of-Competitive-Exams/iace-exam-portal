import { MERIT_TYPE, PAPER_BINDING, type BaseConfigSection, type Test } from '@iace/contracts';
import { plural, type ComboboxItem } from '@iace/ui';

/** What the paper screen reads off a test: whether a paper exists at all, and which one is on it. */

export type PaperSource = Pick<Test, 'paperBinding' | 'isLocked' | 'variantCount'>;

/** A drawn test holds no paper until finalize draws one; a hand-picked one has had rows all along. */
export const hasPaper = (test: Pick<PaperSource, 'paperBinding' | 'isLocked'>): boolean =>
  test.paperBinding === PAPER_BINDING.FIXED || test.isLocked;

/** One paper is not a choice, and a hand-picked test has only ever had the one. */
export const canPickPaper = (test: PaperSource): boolean =>
  hasPaper(test) && test.paperBinding !== PAPER_BINDING.FIXED && test.variantCount > 1;

/** Numbered from one on screen against the 0-based variant on the wire: nobody sits paper zero. */
export const paperOptions = (variantCount: number): ComboboxItem[] =>
  Array.from({ length: variantCount }, (_unused, index) => ({
    value: String(index),
    label: `Paper ${index + 1}`,
  }));

/** How far a section is from the paper it owes. Null where no paper exists to judge it against. */
export const SECTION_FULLNESS = {
  EMPTY: 'EMPTY',
  SHORT: 'SHORT',
  FULL: 'FULL',
} as const;
export type SectionFullness = (typeof SECTION_FULLNESS)[keyof typeof SECTION_FULLNESS];

/** Untouched reads apart from part-built: five amber chips on a fresh test single nothing out. */
export function sectionFullness(
  section: Pick<BaseConfigSection, 'id' | 'questionCount'>,
  held: ReadonlyMap<string, number> | null,
): SectionFullness | null {
  if (held === null) return null;
  const count = held.get(section.id) ?? 0;
  if (count === 0) return SECTION_FULLNESS.EMPTY;
  return count < section.questionCount ? SECTION_FULLNESS.SHORT : SECTION_FULLNESS.FULL;
}

/** The chip's own text. A section with no paper to measure against carries no chip at all. */
export const sectionTally = (
  section: Pick<BaseConfigSection, 'id' | 'questionCount'>,
  held: ReadonlyMap<string, number> | null,
): string | null =>
  held === null ? null : `${held.get(section.id) ?? 0}/${section.questionCount}`;

/** What the configuration framed this section as — the numbers a paper is judged against. */
export function framingOf(section: BaseConfigSection): string {
  const parts = [`${plural(section.marksPerQuestion, 'mark')} each`];
  if (section.negativeMarks > 0) parts.push(`−${section.negativeMarks} per wrong answer`);
  if (section.durationSec !== null) parts.push(`${Math.round(section.durationSec / 60)} minutes`);
  if (section.meritOrQualifying === MERIT_TYPE.QUALIFYING) {
    const cutoff = section.qualifyingCutoff;
    parts.push(cutoff === null ? 'Qualifying' : `Qualifying at ${cutoff}`);
  }
  if (!section.mandatory) parts.push('Optional');
  return parts.join(' · ');
}

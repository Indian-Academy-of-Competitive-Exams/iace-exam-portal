import { PAPER_BINDING, type BaseConfigSection, type Test } from '@iace/contracts';
import type { ComboboxItem } from '@iace/ui';

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

/** A tab has to say which section it is and how far off it is, because only one pane is open. */
export const sectionTabLabel = (
  section: Pick<BaseConfigSection, 'id' | 'name' | 'questionCount'>,
  held: ReadonlyMap<string, number> | null,
): string =>
  held === null
    ? section.name
    : `${section.name} ${held.get(section.id) ?? 0}/${section.questionCount}`;

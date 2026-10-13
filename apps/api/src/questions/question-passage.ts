import { hasText, previewTextOf } from '@iace/contracts';

/** The blank line a typist leaves between a passage and its question, as a sheet cell arrives. */
const BLANK_PARAGRAPH = /<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/i;

/** How a passage typed into the question cell announces itself. */
const PASSAGE_OPENING = /^(?:directions?|passage|read the following|study the following)\b/i;

/** Whether a question cell reads as a passage typed above its question: a guess a person settles, never a split. */
export function opensWithPassage(html: string): boolean {
  const gap = BLANK_PARAGRAPH.exec(html);
  if (!gap) return false;

  const opening = html.slice(0, gap.index);
  return (
    hasText(html.slice(gap.index + gap[0].length)) && PASSAGE_OPENING.test(previewTextOf(opening))
  );
}

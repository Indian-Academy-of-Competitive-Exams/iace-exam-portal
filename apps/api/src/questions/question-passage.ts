import { hasText, previewTextOf } from '@iace/contracts';

/** The blank line a typist leaves between a passage and its question, as a sheet cell arrives. */
const BLANK_PARAGRAPH = /<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi;

/** How a passage typed into the question cell announces itself. */
const PASSAGE_OPENING = /^(?:directions?|passage|read the following|study the following)\b/i;

/** A passage typed above its question in one cell: split at the LAST blank line, or null when it is not one. */
export function splitLeadingPassage(html: string): { passage: string; stem: string } | null {
  const breaks = [...html.matchAll(BLANK_PARAGRAPH)];
  const last = breaks.at(-1);
  if (!last) return null;

  const passage = html.slice(0, last.index).replaceAll(BLANK_PARAGRAPH, '');
  const stem = html.slice(last.index + last[0].length);
  if (!hasText(stem) || !PASSAGE_OPENING.test(previewTextOf(passage))) return null;

  return { passage, stem };
}

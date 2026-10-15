import { previewTextOf } from './question-content';
import { WRITING_FORMAT, type WritingFormat, type WritingRubric } from './questions';

// ============================================================================
// Descriptive answers — an essay, a letter, a précis — marked by rule. Nobody
// reads the writing: four checks stand in for an examiner, and every result
// says so. One evaluator, run by the scorer and again by the screen.
// ============================================================================

/** What each check is worth. They add to one. */
export const WRITING_WEIGHTS = {
  keyPoints: 0.5,
  length: 0.25,
  format: 0.15,
  mechanics: 0.1,
} as const;
export type WritingCheck = keyof typeof WRITING_WEIGHTS;

/** With no limit given, the least that counts as having attempted the question at all. */
export const WRITING_ATTEMPT_WORDS = 50;

export interface WritingResult {
  words: number;
  /** Each key point its author named, and whether the answer covers it. */
  keyPoints: { text: string; found: boolean }[];
  /** Each check from 0 to 1, before its weight. */
  shares: Record<WritingCheck, number>;
  /** The whole answer from 0 to 1: what its marks are multiplied by. */
  score: number;
  /** No key points were named, so nothing could judge the content: an attempt of fair length takes full marks. */
  attemptOnly: boolean;
}

const BLOCK_END = /<\/(?:p|li|div|h[1-6])>|<br\s*\/?>|\n/gi;
const NOT_A_LETTER = /[^\p{L}\p{M}\p{N}\s]/gu;
/** Shorter words — a, an, of, to — are in every answer and prove nothing about a point. */
const TELLING_WORD_LENGTH = 3;

const wordsOf = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);
const folded = (text: string): string[] => wordsOf(text.toLowerCase().replace(NOT_A_LETTER, ' '));

/** The key points an author wrote, one a line, out of an editor's markup or a sheet's cell. */
export function keyPointsOf(written: string | undefined): string[] {
  return (written ?? '')
    .split(BLOCK_END)
    .map((line) => previewTextOf(line))
    .filter((line) => line !== '');
}

/** Covered when every telling word of the point is somewhere in the answer, in any order. */
function covers(answer: ReadonlySet<string>, point: string): boolean {
  const all = folded(point);
  const telling = all.filter((word) => word.length >= TELLING_WORD_LENGTH);
  const needed = telling.length > 0 ? telling : all;
  return needed.length > 0 && needed.every((word) => answer.has(word));
}

/** Full inside the limits, falling in a straight line to nothing at half the lower or twice the upper. */
function lengthShare(words: number, rubric: WritingRubric | undefined): number {
  const min = rubric?.minWords ?? null;
  const max = rubric?.maxWords ?? null;
  if (min !== null && words < min) return Math.max(0, (words - min / 2) / (min / 2));
  if (max !== null && words > max) return Math.max(0, (2 * max - words) / max);
  // With no lower limit named, a few words are still not an answer.
  return min === null ? Math.min(1, words / WRITING_ATTEMPT_WORDS) : 1;
}

/** Each read off one trimmed line, so no pattern has leading space to wander through. */
const LETTER_PARTS = [
  /^(dear|respected|sir|madam|to)\b/i,
  /^(subject|sub) ?[:\-\u2013]/i,
  /\b(yours (faithfully|sincerely|truly|obediently)|regards|thanking you)\b/i,
];
const ESSAY_PARAGRAPHS = 3;
const PRECIS_TITLE_WORDS = 12;

const paragraphsOf = (answer: string): string[] =>
  answer
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

const FORMAT_SHARE: Record<WritingFormat, (answer: string, rubric: WritingRubric) => number> = {
  OTHER: () => 1,
  ESSAY: (answer) => Math.min(1, paragraphsOf(answer).length / ESSAY_PARAGRAPHS),
  LETTER: (answer) => {
    const lines = paragraphsOf(answer).map((line) => line.replace(/\s+/g, ' '));
    const found = LETTER_PARTS.filter((part) => lines.some((line) => part.test(line)));
    return found.length / LETTER_PARTS.length;
  },
  PRECIS: (answer, rubric) => {
    const [title = '', ...body] = paragraphsOf(answer);
    const titled = body.length > 0 && wordsOf(title).length <= PRECIS_TITLE_WORDS;
    const within = rubric.maxWords == null || wordsOf(answer).length <= rubric.maxWords;
    return (Number(titled) + Number(within)) / 2;
  },
};

/** Sentences that open on a capital, an ending that is punctuated, and no word typed twice running. */
function mechanicsShare(answer: string): number {
  const sentences = answer
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length === 0) return 0;
  const opened = sentences.filter((sentence) => /^["'([]?[\p{Lu}\p{N}]/u.test(sentence)).length;
  const closed = /[.!?]["')\]]?\s*$/.test(answer);
  const all = folded(answer);
  const repeated = all.some((word, at) => at > 0 && word === all[at - 1]);
  return (opened / sentences.length + Number(closed) + Number(!repeated)) / 3;
}

const round = (value: number): number => Math.round(value * 100) / 100;

/** The same marks wherever it runs: what was written, the rubric it is held to, and the points it should make. */
export function scoreWriting(
  answer: string,
  rubric: WritingRubric | undefined,
  keyPoints: readonly string[],
): WritingResult {
  const words = wordsOf(answer).length;
  const said = new Set(folded(answer));
  const points = keyPoints.map((text) => ({ text, found: covers(said, text) }));
  const held = rubric ?? { format: WRITING_FORMAT.OTHER };

  if (points.length === 0) {
    const enough = rubric?.minWords ? Math.ceil(rubric.minWords / 2) : WRITING_ATTEMPT_WORDS;
    const share = Number(words >= enough);
    return {
      words,
      keyPoints: [],
      shares: { keyPoints: share, length: share, format: share, mechanics: share },
      score: share,
      attemptOnly: true,
    };
  }

  const shares: Record<WritingCheck, number> = {
    keyPoints: points.filter((point) => point.found).length / points.length,
    length: lengthShare(words, rubric),
    format: FORMAT_SHARE[held.format](answer, held),
    mechanics: mechanicsShare(answer),
  };
  const score = (Object.keys(WRITING_WEIGHTS) as WritingCheck[]).reduce(
    (total, check) => total + WRITING_WEIGHTS[check] * shares[check],
    0,
  );

  return {
    words,
    keyPoints: points,
    shares: {
      keyPoints: round(shares.keyPoints),
      length: round(shares.length),
      format: round(shares.format),
      mechanics: round(shares.mechanics),
    },
    // Form is paid for only beside content: an answer that makes none of its points earns nothing.
    score: shares.keyPoints === 0 ? 0 : round(score),
    attemptOnly: false,
  };
}

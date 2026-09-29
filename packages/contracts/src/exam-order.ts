/**
 * The order a candidate SEES, from the seed their sitting carries. Shared because the paper is
 * ordered wherever it is assembled — the server for a reload or a report, the browser for a
 * prefetched paper — and two implementations would be two answers to "same seed, same order".
 */
import { LANGUAGE_MODE, type LanguageMode } from './configs';
import { type LanguageCode } from './exams';

const PRNG_INCREMENT = 0x6d2b79f5;
const UINT32 = 4294967296;

/** mulberry32. Reproducible, not secret — nothing that uses it guards anything. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + PRNG_INCREMENT) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const held = out[i];
    const other = out[j];
    // Both are inside the array by the loop's own bounds; the guard is what makes that provable.
    if (held === undefined || other === undefined) continue;
    out[i] = other;
    out[j] = held;
  }
  return out;
}

/** Shuffled WITHIN each section and never across one, so a section's questions stay its own. */
export function displayOrder<T extends { baseConfigSectionId: string }>(
  paper: readonly T[],
  seed: number,
  shuffleQuestions: boolean,
): T[] {
  if (!shuffleQuestions) return [...paper];

  const random = seededRandom(seed);
  const bySection = new Map<string, T[]>();
  for (const row of paper) {
    const held = bySection.get(row.baseConfigSectionId);
    if (held) held.push(row);
    else bySection.set(row.baseConfigSectionId, [row]);
  }
  return [...bySection.values()].flatMap((rows) => shuffle(rows, random));
}

/** Options draw from their own generator, spent across the questions in DISPLAY order, not paper order. */
export function servedQuestions<
  Option,
  Question extends { baseConfigSectionId: string; order: number; options: readonly Option[] },
>(
  questions: readonly Question[],
  seed: number,
  shuffleQuestions: boolean,
  shuffleOptions: boolean,
): Question[] {
  const ordered = displayOrder(questions, seed, shuffleQuestions);
  const random = seededRandom(seed);

  return ordered.map((question, index) => ({
    ...question,
    order: index + 1,
    options: shuffleOptions ? shuffle(question.options, random) : question.options,
  }));
}

/** DUAL sits every language offered; SINGLE the one picked, narrowed to what actually exists. */
export function languagesFor(
  mode: LanguageMode,
  offered: readonly LanguageCode[],
  picked: readonly LanguageCode[] | undefined,
): LanguageCode[] {
  if (mode === LANGUAGE_MODE.DUAL) return [...offered];
  const first = (picked ?? []).find((language) => offered.includes(language));
  return first === undefined ? offered.slice(0, 1) : [first];
}

import { z } from 'zod';
import { previewTextOf } from './questions';

// ============================================================================
// Typing and data-entry skill tests: the standards, and the one evaluator the
// API and the browser both run.
// ============================================================================

export const TYPING_METRIC = {
  WPM: 'WPM',
  KEY_DEPRESSIONS: 'KEY_DEPRESSIONS',
  KEY_DEPRESSIONS_PER_HOUR: 'KEY_DEPRESSIONS_PER_HOUR',
} as const;
export type TypingMetric = (typeof TYPING_METRIC)[keyof typeof TYPING_METRIC];

export const TYPING_RULE = {
  ERROR_CEILING: 'ERROR_CEILING',
  ALLOWANCE_PENALTY: 'ALLOWANCE_PENALTY',
} as const;

export type TypingRule =
  | { shape: typeof TYPING_RULE.ERROR_CEILING; ceilingPct: number }
  | { shape: typeof TYPING_RULE.ALLOWANCE_PENALTY; allowancePct: number; penaltyWords: number };

export interface TypingPreset {
  label: string;
  durationSec: number;
  metric: TypingMetric;
  target: number;
  rule: TypingRule;
  backspace: boolean;
}

export const TYPING_PRESET_KEY = {
  SSC_CHSL_TYPING_EN: 'SSC_CHSL_TYPING_EN',
  SSC_CGL_DEST: 'SSC_CGL_DEST',
  SSC_CHSL_DEO_15000: 'SSC_CHSL_DEO_15000',
  SSC_CHSL_DEO_8000: 'SSC_CHSL_DEO_8000',
  RRB_NTPC_TYPING_EN: 'RRB_NTPC_TYPING_EN',
} as const;
export const typingPresetKeySchema = z.enum(TYPING_PRESET_KEY);
export type TypingPresetKey = z.infer<typeof typingPresetKeySchema>;
export const TYPING_PRESET_KEYS = typingPresetKeySchema.options;

const TEN_MINUTES_SEC = 600;
const FIFTEEN_MINUTES_SEC = 900;

/** Code-owned, like FEATURE_KEYS: a standard that moves is an edit here, never a screen. */
export const TYPING_PRESETS: Record<TypingPresetKey, TypingPreset> = {
  SSC_CHSL_TYPING_EN: {
    label: 'SSC CHSL typing (English)',
    durationSec: TEN_MINUTES_SEC,
    metric: TYPING_METRIC.WPM,
    target: 35,
    rule: { shape: TYPING_RULE.ERROR_CEILING, ceilingPct: 7 },
    backspace: true,
  },
  SSC_CGL_DEST: {
    label: 'SSC CGL data entry (DEST)',
    durationSec: FIFTEEN_MINUTES_SEC,
    metric: TYPING_METRIC.KEY_DEPRESSIONS,
    target: 2000,
    rule: { shape: TYPING_RULE.ERROR_CEILING, ceilingPct: 20 },
    backspace: true,
  },
  SSC_CHSL_DEO_15000: {
    label: 'SSC CHSL data entry (15,000 per hour)',
    durationSec: FIFTEEN_MINUTES_SEC,
    metric: TYPING_METRIC.KEY_DEPRESSIONS_PER_HOUR,
    target: 15000,
    rule: { shape: TYPING_RULE.ERROR_CEILING, ceilingPct: 7 },
    backspace: true,
  },
  SSC_CHSL_DEO_8000: {
    label: 'SSC CHSL data entry (8,000 per hour)',
    durationSec: FIFTEEN_MINUTES_SEC,
    metric: TYPING_METRIC.KEY_DEPRESSIONS_PER_HOUR,
    target: 8000,
    rule: { shape: TYPING_RULE.ERROR_CEILING, ceilingPct: 7 },
    backspace: true,
  },
  RRB_NTPC_TYPING_EN: {
    label: 'RRB NTPC typing (English)',
    durationSec: TEN_MINUTES_SEC,
    metric: TYPING_METRIC.WPM,
    target: 30,
    rule: { shape: TYPING_RULE.ALLOWANCE_PENALTY, allowancePct: 5, penaltyWords: 10 },
    backspace: true,
  },
};

/** Every board counts a word as five key depressions, whatever was actually typed. */
export const KEY_DEPRESSIONS_PER_WORD = 5;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** How many key depressions a passage must hold for a candidate at the target not to run out. */
export function typingPassageNeed(preset: TypingPreset): number {
  const minutes = preset.durationSec / SECONDS_PER_MINUTE;
  if (preset.metric === TYPING_METRIC.KEY_DEPRESSIONS) return preset.target;
  if (preset.metric === TYPING_METRIC.WPM) {
    return preset.target * KEY_DEPRESSIONS_PER_WORD * minutes;
  }
  return (preset.target * minutes) / MINUTES_PER_HOUR;
}

const UNTYPABLE: readonly (readonly [RegExp, string])[] = [
  [/[‘’‚′]/g, "'"],
  [/[“”„″]/g, '"'],
  [/[‐-―−]/g, '-'],
  [/…/g, '...'],
];

/** A passage as a keyboard can produce it: straight quotes, plain hyphens, single spaces. */
export function typablePassage(text: string): string {
  const plain = UNTYPABLE.reduce((held, [from, to]) => held.replace(from, to), text);
  return plain.split(/\s+/).filter(Boolean).join(' ');
}

/** The passage a TYPING question's stem holds, as the candidate is shown it and held to it. */
export function typingPassageText(stemHtml: string | undefined): string {
  return typablePassage(previewTextOf((stemHtml ?? '').replace(LINE_BREAK, ' ')));
}

/** `previewTextOf` drops a `<br>` outright, which would join the words either side of it. */
const LINE_BREAK = /<br\s*\/?>/gi;

const PASSAGE_NEEDS = TYPING_PRESET_KEYS.map((key) => typingPassageNeed(TYPING_PRESETS[key]));

/** The shortest any standard can use; a passage below it could be handed to nobody. */
export const TYPING_PASSAGE_MIN_KEY_DEPRESSIONS = Math.min(...PASSAGE_NEEDS);
/** Twice the longest standard: the comparison's cost grows with the passage, so it has a ceiling. */
export const TYPING_PASSAGE_MAX_KEY_DEPRESSIONS = Math.max(...PASSAGE_NEEDS) * 2;

export const TYPED_WORD = {
  RIGHT: 'RIGHT',
  HALF: 'HALF',
  WRONG: 'WRONG',
  EXTRA: 'EXTRA',
  MISSED: 'MISSED',
} as const;
export type TypedWordKind = (typeof TYPED_WORD)[keyof typeof TYPED_WORD];

/** One step of the comparison: what was typed against what the passage held there. */
export interface TypedWord {
  kind: TypedWordKind;
  typed: string | null;
  expected: string | null;
}

export interface TypingResult {
  keyDepressions: number;
  keyDepressionsPerHour: number;
  wordsTyped: number;
  fullMistakes: number;
  halfMistakes: number;
  errorPct: number;
  grossWpm: number;
  /** Gross under an error ceiling; gross less the penalty words under an allowance. */
  netWpm: number;
  targetMet: boolean;
  qualified: boolean;
  words: TypedWord[];
}

const HALF_COST = 1;
const FULL_COST = 2;
// Marks stay: a Devanagari vowel sign is the difference between two words, not punctuation.
const NOT_A_LETTER = /[^\p{L}\p{M}\p{N}]/gu;

const letters = (word: string) => word.toLowerCase().replace(NOT_A_LETTER, '');

function pairCost(typed: string, expected: string): number {
  if (typed === expected) return 0;
  return letters(typed) === letters(expected) ? HALF_COST : FULL_COST;
}

const PAIRED_KIND: Record<number, TypedWordKind> = {
  0: TYPED_WORD.RIGHT,
  [HALF_COST]: TYPED_WORD.HALF,
  [FULL_COST]: TYPED_WORD.WRONG,
};

/** Word-level edit distance, free past where they stopped: an unfinished passage is not an error. */
function compare(passage: readonly string[], typed: readonly string[]): TypedWord[] {
  const columns = passage.length + 1;
  const cost = new Uint16Array((typed.length + 1) * columns);
  const at = (i: number, j: number) => cost[i * columns + j] ?? 0;
  // The clock stops mid-word: the start of the right word, typed last, is not a wrong word.
  const paired = (i: number, j: number) =>
    i === typed.length && (passage[j - 1] ?? '').startsWith(typed[i - 1] ?? '')
      ? 0
      : pairCost(typed[i - 1] ?? '', passage[j - 1] ?? '');

  for (let j = 1; j < columns; j += 1) cost[j] = j * FULL_COST;
  for (let i = 1; i <= typed.length; i += 1) {
    cost[i * columns] = i * FULL_COST;
    for (let j = 1; j < columns; j += 1) {
      cost[i * columns + j] = Math.min(
        at(i - 1, j - 1) + paired(i, j),
        at(i - 1, j) + FULL_COST,
        at(i, j - 1) + FULL_COST,
      );
    }
  }

  let i = typed.length;
  let j = 0;
  for (let reached = 1; reached < columns; reached += 1) {
    if (at(i, reached) < at(i, j)) j = reached;
  }

  const words: TypedWord[] = [];
  while (i > 0 || j > 0) {
    const typedWord = typed[i - 1] ?? null;
    const expected = passage[j - 1] ?? null;
    if (i > 0 && j > 0 && at(i, j) === at(i - 1, j - 1) + paired(i, j)) {
      words.push({
        kind: PAIRED_KIND[paired(i, j)] ?? TYPED_WORD.WRONG,
        typed: typedWord,
        expected,
      });
      i -= 1;
      j -= 1;
    } else if (i > 0 && at(i, j) === at(i - 1, j) + FULL_COST) {
      words.push({ kind: TYPED_WORD.EXTRA, typed: typedWord, expected: null });
      i -= 1;
    } else {
      words.push({ kind: TYPED_WORD.MISSED, typed: null, expected });
      j -= 1;
    }
  }
  return words.reverse();
}

const HUNDREDTHS = 100;
const rounded = (value: number) => Math.round(value * HUNDREDTHS) / HUNDREDTHS;
const PERCENT = 100;
// ponytail: the comparison is O(typed × passage) words, so a pasted novel is cut at twice the passage.
const TYPED_WORDS_PER_PASSAGE_WORD = 2;

/** A word counts for no more than the passage's longest: holding one key down types nothing the passage asks for. */
function countedKeyDepressions(expected: readonly string[], given: readonly string[]): number {
  const longest = Math.max(0, ...expected.map((word) => word.length));
  const letters = given.reduce((total, word) => total + Math.min(word.length, longest), 0);
  return letters + Math.max(0, given.length - 1);
}

/** What a typing box shows as it fills: the count the evaluator will arrive at for the same text. */
export function typingKeyDepressions(passage: string, typed: string): number {
  return countedKeyDepressions(
    typablePassage(passage).split(' ').filter(Boolean),
    typablePassage(typed).split(' ').filter(Boolean),
  );
}

/** The same figures wherever it runs: the passage, what was typed, and the standard it is held to. */
export function scoreTyping(passage: string, typed: string, preset: TypingPreset): TypingResult {
  const expected = typablePassage(passage).split(' ').filter(Boolean);
  const given = typablePassage(typed)
    .split(' ')
    .filter(Boolean)
    .slice(0, expected.length * TYPED_WORDS_PER_PASSAGE_WORD);
  const words = compare(expected, given);

  const keyDepressions = countedKeyDepressions(expected, given);
  const minutes = preset.durationSec / SECONDS_PER_MINUTE;
  const fullMistakes = words.filter(
    (word) => word.kind !== TYPED_WORD.RIGHT && word.kind !== TYPED_WORD.HALF,
  ).length;
  const halfMistakes = words.filter((word) => word.kind === TYPED_WORD.HALF).length;
  const mistakes = fullMistakes + halfMistakes / 2;
  const errorPct = given.length === 0 ? 0 : (mistakes / given.length) * PERCENT;

  const grossWords = keyDepressions / KEY_DEPRESSIONS_PER_WORD;
  const grossWpm = grossWords / minutes;
  const netWpm = netWordsUnder(preset.rule, grossWords, given.length, mistakes) / minutes;
  const keyDepressionsPerHour = (keyDepressions / minutes) * MINUTES_PER_HOUR;

  const reached: Record<TypingMetric, number> = {
    WPM: netWpm,
    KEY_DEPRESSIONS: keyDepressions,
    KEY_DEPRESSIONS_PER_HOUR: keyDepressionsPerHour,
  };
  const targetMet = reached[preset.metric] >= preset.target;
  // Multiplied out, never divided: 28 mistakes in 400 words is 7.000000000000001 as a percentage.
  const withinCeiling =
    preset.rule.shape !== TYPING_RULE.ERROR_CEILING ||
    mistakes * PERCENT <= preset.rule.ceilingPct * given.length;

  return {
    keyDepressions,
    keyDepressionsPerHour: rounded(keyDepressionsPerHour),
    wordsTyped: given.length,
    fullMistakes,
    halfMistakes,
    errorPct: rounded(errorPct),
    grossWpm: rounded(grossWpm),
    netWpm: rounded(netWpm),
    targetMet,
    qualified: given.length > 0 && targetMet && withinCeiling,
    words,
  };
}

function netWordsUnder(
  rule: TypingRule,
  grossWords: number,
  wordsTyped: number,
  mistakes: number,
): number {
  if (rule.shape === TYPING_RULE.ERROR_CEILING) return grossWords;
  const ignored = (rule.allowancePct / PERCENT) * wordsTyped;
  return Math.max(0, grossWords - rule.penaltyWords * Math.max(0, mistakes - ignored));
}

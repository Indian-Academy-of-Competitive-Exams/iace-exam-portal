import { z } from 'zod';
import { paginationQuerySchema } from './envelope';
import { TYPING_PASSAGE_MAX_KEY_DEPRESSIONS, typingPresetKeySchema } from './typing';

// ============================================================================
// Typing practice: a student types a TYPING question from the bank against a
// standard they picked. Apart from any test — nothing here is ranked.
// ============================================================================

/** Twice the longest passage; past it nothing typed could still be compared. */
export const TYPED_TEXT_MAX = TYPING_PASSAGE_MAX_KEY_DEPRESSIONS * 2;

export const typingPracticePassageQuerySchema = z.object({ presetKey: typingPresetKeySchema });
export type TypingPracticePassageQuery = z.infer<typeof typingPracticePassageQuerySchema>;

/** What a session is handed to type. */
export const typingPracticePassageSchema = z.object({
  questionId: z.string(),
  text: z.string(),
});
export type TypingPracticePassage = z.infer<typeof typingPracticePassageSchema>;

/** The figures are not sent: the server computes its own from what was typed. */
export const finishTypingPracticeSchema = z.object({
  presetKey: typingPresetKeySchema,
  questionId: z.uuid(),
  typed: z.string().max(TYPED_TEXT_MAX),
});
export type FinishTypingPracticeInput = z.input<typeof finishTypingPracticeSchema>;
export type FinishTypingPracticeBody = z.infer<typeof finishTypingPracticeSchema>;

export const typingPracticeSchema = z.object({
  id: z.string(),
  presetKey: typingPresetKeySchema,
  keyDepressions: z.number().int(),
  wordsTyped: z.number().int(),
  fullMistakes: z.number().int(),
  halfMistakes: z.number().int(),
  errorPct: z.number(),
  grossWpm: z.number(),
  netWpm: z.number(),
  qualified: z.boolean(),
  createdAt: z.string(),
});
export type TypingPractice = z.infer<typeof typingPracticeSchema>;

export const typingPracticeListQuerySchema = paginationQuerySchema.extend({
  presetKey: typingPresetKeySchema.optional(),
});
export type TypingPracticeListQuery = z.infer<typeof typingPracticeListQuerySchema>;
export type TypingPracticeListQueryInput = z.input<typeof typingPracticeListQuerySchema>;

export const TYPING_ROUTES = {
  passage: '/me/typing/passage',
  practices: '/me/typing/practices',
} as const;

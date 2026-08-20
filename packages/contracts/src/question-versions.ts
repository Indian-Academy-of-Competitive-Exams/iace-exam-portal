import { z } from 'zod';
import { localizedRichSchema } from './questions';

// ============================================================================
// Question versions. A question is identity; every edit inserts a new version
// and repoints the question at it. A paper and an attempt both pin a version,
// so a later edit never changes what somebody already sat.
// ============================================================================

/**
 * Options live inside the version rather than in their own table, so one read is
 * the whole question on the exam path. The id is stable within the version, and
 * an attempt's `selectedOptionId` refers to it — validated by the service,
 * because a JSON key cannot be a foreign key.
 */
export const questionVersionOptionSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  isCorrect: z.boolean(),
  text: localizedRichSchema,
});
export type QuestionVersionOption = z.infer<typeof questionVersionOptionSchema>;

export const questionVersionSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  /** 1, 2, 3… within this question. */
  version: z.number().int(),
  /** Keyed by language: stem and solution, as content nodes. */
  content: z.unknown(),
  /** Present for a multiple-choice question, absent for a typed answer. */
  options: z.array(questionVersionOptionSchema).nullable(),
  /** Present for a typed answer: how it is matched, and against what. */
  answerKey: z.unknown().nullable(),
  createdAt: z.string(),
});
export type QuestionVersion = z.infer<typeof questionVersionSchema>;

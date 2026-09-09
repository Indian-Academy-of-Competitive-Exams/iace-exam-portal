import { z } from 'zod';
import { questionDetailSchema } from './questions';

// ============================================================================
// Proof-reading. Internal reviewers read authored questions as a document and
// flag the bad ones. An OPEN flag blocks the question from going ACTIVE, which
// is the whole point of the model: it is a quality gate, not a comment thread.
// ============================================================================

export const QUESTION_FLAG_CATEGORY = {
  AWKWARD: 'AWKWARD',
  INVALID: 'INVALID',
  TOO_DIFFICULT: 'TOO_DIFFICULT',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
  OTHER: 'OTHER',
} as const;
export const questionFlagCategorySchema = z.enum(QUESTION_FLAG_CATEGORY);
export type QuestionFlagCategory = z.infer<typeof questionFlagCategorySchema>;
export const QUESTION_FLAG_CATEGORIES = questionFlagCategorySchema.options;

export const QUESTION_FLAG_STATUS = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
  DISMISSED: 'DISMISSED',
} as const;
export const questionFlagStatusSchema = z.enum(QUESTION_FLAG_STATUS);
export type QuestionFlagStatus = z.infer<typeof questionFlagStatusSchema>;
export const QUESTION_FLAG_STATUSES = questionFlagStatusSchema.options;

/** An OPEN flag is the only one that gates; the other two are how it is closed. */
export const questionFlagSettlementSchema = z.enum([
  QUESTION_FLAG_STATUS.RESOLVED,
  QUESTION_FLAG_STATUS.DISMISSED,
]);
export type QuestionFlagSettlement = z.infer<typeof questionFlagSettlementSchema>;

export const FLAG_COMMENT_MAX = 1000;

/** The admin who raised or settled a flag. Name falls back to the email they sign in with. */
export const questionFlagActorSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type QuestionFlagActor = z.infer<typeof questionFlagActorSchema>;

export const questionFlagSchema = z.object({
  id: z.string(),
  questionId: z.string(),
  category: questionFlagCategorySchema,
  comment: z.string(),
  status: questionFlagStatusSchema,
  raisedBy: questionFlagActorSchema.nullable(),
  resolvedBy: questionFlagActorSchema.nullable(),
  resolvedAt: z.string().nullable(),
  /** False once the question has been edited since — the reviewer read an older version. */
  onCurrentVersion: z.boolean(),
  createdAt: z.string(),
});
export type QuestionFlag = z.infer<typeof questionFlagSchema>;

/** The version is the server's to record: it is the one the reader was served. */
export const createQuestionFlagSchema = z.object({
  category: questionFlagCategorySchema,
  comment: z.string().trim().min(1, 'Say what is wrong with it').max(FLAG_COMMENT_MAX),
});
export type CreateQuestionFlagInput = z.input<typeof createQuestionFlagSchema>;
export type CreateQuestionFlagBody = z.infer<typeof createQuestionFlagSchema>;

export const settleQuestionFlagSchema = z.object({
  status: questionFlagSettlementSchema,
});
export type SettleQuestionFlagInput = z.input<typeof settleQuestionFlagSchema>;
export type SettleQuestionFlagBody = z.infer<typeof settleQuestionFlagSchema>;

/** One question as a proof-reader reads it: every language, the answer, and its flags. */
export const proofreadQuestionSchema = questionDetailSchema.extend({
  flags: z.array(questionFlagSchema),
});
export type ProofreadQuestion = z.infer<typeof proofreadQuestionSchema>;

export const ADMIN_PROOFREADING_ROUTES = {
  /** The document itself: a page of questions in full, taking the question-bank filters. */
  document: '/admin/proofreading/questions',
  raise: (questionId: string) => `/admin/proofreading/questions/${questionId}/flags`,
  settle: (flagId: string) => `/admin/proofreading/flags/${flagId}`,
} as const;

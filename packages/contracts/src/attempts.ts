import { z } from 'zod';
import { languageCodeSchema } from './exams';

// ============================================================================
// Attempts. One row holds the live state and the scored result — there is no
// separate result. Live rank and percentile are read from Redis; what is here
// is the last persisted snapshot.
// ============================================================================

export const ATTEMPT_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  SUBMITTED: 'SUBMITTED',
  EVALUATED: 'EVALUATED',
  EXPIRED: 'EXPIRED',
} as const;
export const attemptStatusSchema = z.enum(ATTEMPT_STATUS);
export type AttemptStatus = z.infer<typeof attemptStatusSchema>;
export const ATTEMPT_STATUSES = attemptStatusSchema.options;

/** What the palette shows for a question, and what the engine writes back. */
export const ANSWER_STATE = {
  NOT_VISITED: 'NOT_VISITED',
  NOT_ANSWERED: 'NOT_ANSWERED',
  ANSWERED: 'ANSWERED',
  MARKED_REVIEW: 'MARKED_REVIEW',
  ANSWERED_MARKED: 'ANSWERED_MARKED',
} as const;
export const answerStateSchema = z.enum(ANSWER_STATE);
export type AnswerState = z.infer<typeof answerStateSchema>;
export const ANSWER_STATES = answerStateSchema.options;

export const attemptSchema = z.object({
  id: z.string(),
  testId: z.string(),
  studentId: z.string(),
  attemptNo: z.number().int(),
  /** True for the one ranked attempt. The cohort rollup fires on it alone. */
  isGraded: z.boolean(),
  status: attemptStatusSchema,
  startedAt: z.string(),
  /** Server-authoritative. The client clock only counts down to it. */
  endsAt: z.string(),
  submittedAt: z.string().nullable(),
  evaluatedAt: z.string().nullable(),
  shuffleSeed: z.number().int(),
  languages: z.array(languageCodeSchema),
  score: z.number().nullable(),
  correctCount: z.number().int().nullable(),
  wrongCount: z.number().int().nullable(),
  unattemptedCount: z.number().int().nullable(),
  /** Snapshots. The live values are always read from Redis. */
  lastRank: z.number().int().nullable(),
  lastPercentile: z.number().nullable(),
  createdAt: z.string(),
});
export type Attempt = z.infer<typeof attemptSchema>;

/**
 * One row per question served in an attempt, plus the response. A null
 * `paperQuestionId` is what marks the row as drawn per attempt rather than
 * taken from a frozen paper.
 */
export const attemptQuestionSchema = z.object({
  attemptId: z.string(),
  questionId: z.string(),
  paperQuestionId: z.string().nullable(),
  /** Always present, so the row reproduces without a join. */
  questionVersionId: z.string(),
  baseConfigSectionId: z.string(),
  /** This student's display order, not the paper's. */
  order: z.number().int(),
  /** An option id inside the version's options JSON — validated by the service, not a foreign key. */
  selectedOptionId: z.string().nullable(),
  typedAnswer: z.string().nullable(),
  state: answerStateSchema,
  timeSpentSec: z.number().int(),
  isCorrect: z.boolean().nullable(),
  marksAwarded: z.number().nullable(),
  answeredAt: z.string().nullable(),
});
export type AttemptQuestion = z.infer<typeof attemptQuestionSchema>;

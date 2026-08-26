import { z } from 'zod';
import { languageCodeSchema } from './exams';
import { languageModeSchema, navigationPolicySchema, timerTemplateSchema } from './configs';
import { localizedContentSchema, localizedRichSchema, questionTypeSchema } from './questions';

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

// ============================================================================
// Starting one. Nothing about TIMING comes off the request — the server sets
// `startedAt` and `endsAt` from the config, and the client only counts down.
// ============================================================================

/** Which languages this student sits in. Must be ones the config offers. */
export const startAttemptSchema = z.object({
  languages: z.array(languageCodeSchema).min(1).optional(),
});
export type StartAttemptInput = z.input<typeof startAttemptSchema>;
export type StartAttemptBody = z.infer<typeof startAttemptSchema>;

/** The attempt plus what the exam screen needs to draw its frame before the paper arrives. */
export const liveAttemptSchema = attemptSchema.extend({
  /** True when this call started it, false when it resumed one already running. */
  startedByThisCall: z.boolean(),
  testTitle: z.string().nullable(),
  durationSec: z.number().int(),
  totalQuestions: z.number().int(),
});
export type LiveAttempt = z.infer<typeof liveAttemptSchema>;

// ============================================================================
// The live sitting. Everything here lives in Redis until the flusher or submit
// moves it, so a student answering a hundred questions writes Postgres never.
// ============================================================================

/** One question's change since the last save. A batch is a DELTA, not the whole paper. */
export const answerChangeSchema = z.object({
  questionId: z.string().min(1),
  /** What the screen believes. The server derives the truth from the answer and the mark. */
  state: answerStateSchema,
  selectedOptionId: z.string().min(1).nullish(),
  typedAnswer: z.string().nullish(),
  /** Total seconds on this question so far, as the screen has counted them. */
  timeSpentSec: z.number().int().min(0),
});
export type AnswerChange = z.infer<typeof answerChangeSchema>;

/** Where a sectional clock has got to. Absent for a composite paper, which has one clock. */
export const sectionProgressSchema = z.object({
  remainingSec: z.number().int().min(0),
  closed: z.boolean(),
});
export type SectionProgress = z.infer<typeof sectionProgressSchema>;

/** A screenful of answers is one save; a paper is 100, so a batch never needs to be larger. */
export const SAVE_BATCH_MAX = 200;

export const saveAttemptStateSchema = z.object({
  /** The screen's own counter. A batch that arrives after a newer one is dropped, not applied. */
  revision: z.number().int().min(0),
  answers: z.array(answerChangeSchema).max(SAVE_BATCH_MAX),
  sections: z.record(z.string(), sectionProgressSchema).optional(),
});
export type SaveAttemptStateInput = z.input<typeof saveAttemptStateSchema>;
export type SaveAttemptStateBody = z.infer<typeof saveAttemptStateSchema>;

/** One question as the live state holds it — the palette is drawn from exactly this. */
export const liveAnswerSchema = z.object({
  state: answerStateSchema,
  selectedOptionId: z.string().nullable(),
  typedAnswer: z.string().nullable(),
  timeSpentSec: z.number().int(),
  /** When the answer was GIVEN. Held here so a flush writes the same row however often it runs. */
  answeredAt: z.string().nullable(),
});
export type LiveAnswer = z.infer<typeof liveAnswerSchema>;

/** What Redis holds for one sitting. Returned on every save, so the screen can reconcile. */
export const liveAttemptStateSchema = z.object({
  attemptId: z.string(),
  revision: z.number().int(),
  answers: z.record(z.string(), liveAnswerSchema),
  sections: z.record(z.string(), sectionProgressSchema),
  /** The server's deadline again, so a save is also a clock check. */
  endsAt: z.string(),
  serverNow: z.string(),
});
export type LiveAttemptState = z.infer<typeof liveAttemptStateSchema>;

export const ME_ATTEMPT_ROUTES = {
  start: (testId: string) => `/me/tests/${testId}/attempt`,
  paper: (attemptId: string) => `/me/attempts/${attemptId}/paper`,
  state: (attemptId: string) => `/me/attempts/${attemptId}/state`,
} as const;

// ============================================================================
// The paper a student sits. Everything here crosses to a browser, so nothing
// here may carry an answer: no `isCorrect`, no answer key, no marks awarded.
// ============================================================================

/** An option as a candidate sees it. `questionOptionSchema` carries `isCorrect`; this cannot. */
export const examOptionSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  text: localizedRichSchema,
});
export type ExamOption = z.infer<typeof examOptionSchema>;

export const examQuestionSchema = z.object({
  questionId: z.string(),
  /** This student's display order, stored at start — not the paper's. */
  order: z.number().int(),
  baseConfigSectionId: z.string(),
  type: questionTypeSchema,
  marks: z.number(),
  negativeMarks: z.number(),
  /** Only the languages this sitting is in, and only the ones the question actually has. */
  content: localizedContentSchema,
  options: z.array(examOptionSchema),
});
export type ExamQuestion = z.infer<typeof examQuestionSchema>;

/** A section tab, and the clock it carries when the paper is sectional. */
export const examSectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  order: z.number().int(),
  questionCount: z.number().int(),
  durationSec: z.number().int().nullable(),
});
export type ExamSection = z.infer<typeof examSectionSchema>;

export const examPaperSchema = z.object({
  attemptId: z.string(),
  /** The deadline the countdown counts to. The client never computes one. */
  endsAt: z.string(),
  /** What the server's clock read as it answered: a skewed device must not lengthen a sitting. */
  serverNow: z.string(),
  languages: z.array(languageCodeSchema),
  languageMode: languageModeSchema,
  timerTemplate: timerTemplateSchema,
  navigation: navigationPolicySchema,
  calculatorEnabled: z.boolean(),
  sections: z.array(examSectionSchema),
  questions: z.array(examQuestionSchema),
});
export type ExamPaper = z.infer<typeof examPaperSchema>;

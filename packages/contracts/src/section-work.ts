import { z } from 'zod';
import { assignmentSchema } from './assignments';
import { difficultyLevelSchema } from './questions';
import { paperSourceSchema } from './tests';

/** One section as its typist, proof-reader or test owner works on it; `editable` is the server's call. */

/** Why a proof-reader returns a question to its typist. */
export const SEND_BACK_REASONS = {
  SPELLING: 'SPELLING',
  DATA_CORRECTION: 'DATA_CORRECTION',
  ANSWER_OPTION: 'ANSWER_OPTION',
} as const;
export const sendBackReasonSchema = z.enum(SEND_BACK_REASONS);
export type SendBackReason = z.infer<typeof sendBackReasonSchema>;

/** Where one question stands with the proof-reader. Derived from its review row, never stored. */
export const REVIEW_STATES = {
  UNCHECKED: 'UNCHECKED',
  CHECKED: 'CHECKED',
  SENT_BACK: 'SENT_BACK',
  FIXED: 'FIXED',
} as const;
export const reviewStateSchema = z.enum(REVIEW_STATES);
export type ReviewState = z.infer<typeof reviewStateSchema>;

export const questionReviewSchema = z.object({
  state: reviewStateSchema,
  /** Set while a question is, or last was, sent back. */
  reason: sendBackReasonSchema.nullable(),
  note: z.string().nullable(),
  sentBackAt: z.string().nullable(),
  fixedAt: z.string().nullable(),
  checkedAt: z.string().nullable(),
});
export type QuestionReview = z.infer<typeof questionReviewSchema>;

/** Who is looking: their own seat on the section, or the test's owner (a super admin sits here too). */
export const SECTION_SEATS = {
  TYPIST: 'TYPIST',
  READER: 'READER',
  OWNER: 'OWNER',
} as const;
export const sectionSeatSchema = z.enum(SECTION_SEATS);
export type SectionSeat = z.infer<typeof sectionSeatSchema>;

export const sectionQuestionSchema = z.object({
  questionId: z.string(),
  preview: z.string(),
  difficulty: difficultyLevelSchema,
  /** Its place on the paper; null for a question typed for the section and not chosen yet. */
  order: z.number().int().nullable(),
  /** Written under a typist's row on this section — what the typist's Done chooses from. */
  typed: z.boolean(),
  review: questionReviewSchema,
  /** Whether THIS viewer may change it now — the server's rule, so the screen cannot disagree. */
  editable: z.boolean(),
});
export type SectionQuestion = z.infer<typeof sectionQuestionSchema>;

export const sectionWorkSchema = z.object({
  testId: z.string(),
  baseConfigSectionId: z.string(),
  sectionName: z.string(),
  testTitle: z.string().nullable(),
  paperSource: paperSourceSchema,
  questionCount: z.number().int(),
  sectionSubjectId: z.string().nullable(),
  /** The test has been offered: its paper no longer moves, and nobody but a super admin edits. */
  offered: z.boolean(),
  typist: assignmentSchema.nullable(),
  reader: assignmentSchema.nullable(),
  /** Whoever held a role before it passed on, oldest first. */
  history: assignmentSchema.array(),
  seat: sectionSeatSchema,
  /** The viewer's own row, when their seat is one; replaced means they only read now. */
  seatAssignmentId: z.string().nullable(),
  seatReplaced: z.boolean(),
  questions: sectionQuestionSchema.array(),
});
export type SectionWork = z.infer<typeof sectionWorkSchema>;

export const sendBackSchema = z.object({
  reason: sendBackReasonSchema,
  note: z.string().trim().max(500).optional(),
});
export type SendBackInput = z.input<typeof sendBackSchema>;
export type SendBackBody = z.infer<typeof sendBackSchema>;

export const ADMIN_SECTION_WORK_ROUTES = {
  one: (testId: string, sectionId: string) => `/admin/sections/${testId}/${sectionId}`,
  /** GET reads one question; PATCH saves it under the viewer's own rule. */
  question: (testId: string, sectionId: string, questionId: string) =>
    `/admin/sections/${testId}/${sectionId}/questions/${questionId}`,
  otherTests: (testId: string, sectionId: string, questionId: string) =>
    `/admin/sections/${testId}/${sectionId}/questions/${questionId}/other-tests`,
  /** POST ticks it; DELETE takes the tick back. */
  check: (testId: string, sectionId: string, questionId: string) =>
    `/admin/sections/${testId}/${sectionId}/questions/${questionId}/check`,
  sendBack: (testId: string, sectionId: string, questionId: string) =>
    `/admin/sections/${testId}/${sectionId}/questions/${questionId}/send-back`,
  fixed: (testId: string, sectionId: string, questionId: string) =>
    `/admin/sections/${testId}/${sectionId}/questions/${questionId}/fixed`,
} as const;

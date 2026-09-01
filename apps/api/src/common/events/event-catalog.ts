/** Every cross-module event in the platform, declared in one place (docs/03 §6). */

import {
  type AuditAction,
  type AuditActorType,
  type AuditFeature,
  type FieldDiff,
} from '@iace/contracts';

export const DOMAIN_EVENTS = {
  /** A student pressed submit. TODO(docs/03 §6): emit from the exam module. */
  ATTEMPT_SUBMITTED: 'attempt.submitted',
  /** A first evaluation landed, and the aggregates want it. WIRED — see the scoring worker. */
  SCORING_COMPLETED: 'scoring.completed',
  /** A series was enabled for a branch. TODO(docs/03 §6): emit from access/admin. */
  TEST_ASSIGNED: 'test.assigned',
  /** A paper question was excluded from scoring. TODO(docs/03 §6): from admin. */
  PAPER_QUESTION_DROPPED: 'paperQuestion.dropped',
  /** A paper question was awarded to everyone. TODO(docs/03 §6): from admin. */
  PAPER_QUESTION_BONUS: 'paperQuestion.bonus',
  /** A student's PIN changed and every session was revoked. WIRED — see auth. */
  STUDENT_PIN_RESET: 'student.pin_reset',
  /** An audited write succeeded. WIRED — see the audit module. */
  AUDIT_ROW_ACTION: 'audit.row_action',
  /** One student's access moved. WIRED — see the access module's cache listener. */
  STUDENT_ACCESS_CHANGED: 'student.access_changed',
  /** A series-wide change: every student's cached catalog is stale. WIRED — access and tests. */
  ACCESS_CATALOG_CHANGED: 'access.catalog_changed',
  /** A series opened for one student — an auto-unlock or an approved request. WIRED — see access. */
  SERIES_UNLOCKED: 'series.unlocked',
  /** Exam codes were ADDED to a student, never removed. WIRED — see students. */
  STUDENT_ENROLMENT_ADDED: 'student.enrolment_added',
  /** An admin filed a grant against a student. WIRED — see access. */
  SERIES_GRANTED: 'series.granted',
} as const;

export type DomainEventName = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];

/** Which of the two PIN paths this was. Both revoke every other session. */
export const PIN_RESET_REASONS = {
  /** Forgotten: proved the number by OTP, then chose a new PIN. */
  OTP_RESET: 'otp_reset',
  /** Remembered: signed in, gave the current PIN, chose a new one. */
  SELF_CHANGE: 'self_change',
} as const;

export type PinResetReason = (typeof PIN_RESET_REASONS)[keyof typeof PIN_RESET_REASONS];

export interface AttemptSubmittedEvent {
  attemptId: string;
  testId: string;
  studentId: string;
  /** ISO — events carry strings, so the payload survives a queue unchanged. */
  submittedAt: string;
}

export interface ScoringCompletedEvent {
  attemptId: string;
  testId: string;
  studentId: string;
  /** Which rollups it lands in: a practice sitting never reaches the cohort's three. */
  isGraded: boolean;
}

export interface TestAssignedEvent {
  testId: string;
  /** The branches that just gained access, through their per-series config rows. */
  branchIds: string[];
}

export interface PaperQuestionCorrectedEvent {
  testId: string;
  paperQuestionId: string;
  questionId: string;
  /** Audit only — `Admin.id`, matching the createdById columns in the schema. */
  changedByAdminId: string | null;
}

export interface StudentPinResetEvent {
  studentId: string;
  mobile: string;
  reason: PinResetReason;
}

export interface AuditRowActionEvent {
  feature: AuditFeature;
  action: AuditAction;
  entityId: string;
  actorType: AuditActorType;
  actorId: string | null;
  changed: FieldDiff | null;
  importLogId: string | null;
  requestId: string;
}

export interface StudentAccessChangedEvent {
  studentId: string;
}

export interface AccessCatalogChangedEvent {
  /** Null when the change was not about one series — a branch fan-out, an import. */
  testSeriesId: string | null;
}

export interface SeriesUnlockedEvent {
  studentId: string;
  testSeriesId: string;
}

export interface StudentEnrolmentAddedEvent {
  studentId: string;
  /** Only the codes this save ADDED — `Exam.code`, the string `Student.enrolledExams` holds. */
  examCodes: string[];
}

export interface SeriesGrantedEvent {
  studentId: string;
  testSeriesId: string;
}

/**
 * Name → payload. `emit` is typed off this, so an event cannot be published with the wrong shape
 * and a handler cannot claim a shape the producer never sends.
 */
export interface DomainEventPayloads {
  [DOMAIN_EVENTS.ATTEMPT_SUBMITTED]: AttemptSubmittedEvent;
  [DOMAIN_EVENTS.SCORING_COMPLETED]: ScoringCompletedEvent;
  [DOMAIN_EVENTS.TEST_ASSIGNED]: TestAssignedEvent;
  [DOMAIN_EVENTS.PAPER_QUESTION_DROPPED]: PaperQuestionCorrectedEvent;
  [DOMAIN_EVENTS.PAPER_QUESTION_BONUS]: PaperQuestionCorrectedEvent;
  [DOMAIN_EVENTS.STUDENT_PIN_RESET]: StudentPinResetEvent;
  [DOMAIN_EVENTS.AUDIT_ROW_ACTION]: AuditRowActionEvent;
  [DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED]: StudentAccessChangedEvent;
  [DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED]: AccessCatalogChangedEvent;
  [DOMAIN_EVENTS.SERIES_UNLOCKED]: SeriesUnlockedEvent;
  [DOMAIN_EVENTS.STUDENT_ENROLMENT_ADDED]: StudentEnrolmentAddedEvent;
  [DOMAIN_EVENTS.SERIES_GRANTED]: SeriesGrantedEvent;
}

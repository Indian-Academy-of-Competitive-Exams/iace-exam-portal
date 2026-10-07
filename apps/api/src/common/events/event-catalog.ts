/** Every cross-module event in the platform, declared in one place (docs/03 §6). */

export const DOMAIN_EVENTS = {
  /** A student was switched off, not merely re-granted or blocked. WIRED — auth revokes their sessions so the switch-off holds now, not at token expiry. */
  STUDENT_DEACTIVATED: 'student.deactivated',
  /** An admin moved the number a student signs in with. WIRED — auth revokes their sessions: the device holding the old number may not be theirs. */
  STUDENT_MOBILE_CHANGED: 'student.mobile_changed',
  /** A series or a test in it moved. WIRED — access bumps the counter every process's held series is built under. */
  ACCESS_CATALOG_CHANGED: 'access.catalog_changed',
  /** What the catalog shows of a stage moved: its name, its exam's code or course, or a blueprint on it. WIRED — as above. */
  EXAM_STAGE_CHANGED: 'exam_stage.changed',
  /** A student finished signing up and has an account for the first time. WIRED — notifications welcomes them. */
  STUDENT_SIGNED_UP: 'student.signed_up',
  /** An admin was switched off. WIRED — auth revokes their sessions so the flag takes effect now, not at token expiry. */
  ADMIN_DEACTIVATED: 'admin.deactivated',
} as const;

/** Only the names below carry a payload: one without one is not a thing the bus can publish. */
export type DomainEventName = keyof DomainEventPayloads;

export interface StudentDeactivatedEvent {
  studentId: string;
}

export interface StudentMobileChangedEvent {
  studentId: string;
}

export interface AccessCatalogChangedEvent {
  testSeriesId: string;
}

/** One stage, or every stage under an exam: the catalog is rebuilt whole either way. */
export type ExamStageChangedEvent = { examStageId: string } | { examId: string };

export interface StudentSignedUpEvent {
  studentId: string;
}

export interface AdminDeactivatedEvent {
  adminId: string;
}

/** Name → payload. `emit` is typed off this, so an event cannot be published with the wrong shape and a handler cannot claim a shape the producer never sends. */
export interface DomainEventPayloads {
  [DOMAIN_EVENTS.STUDENT_DEACTIVATED]: StudentDeactivatedEvent;
  [DOMAIN_EVENTS.STUDENT_MOBILE_CHANGED]: StudentMobileChangedEvent;
  [DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED]: AccessCatalogChangedEvent;
  [DOMAIN_EVENTS.EXAM_STAGE_CHANGED]: ExamStageChangedEvent;
  [DOMAIN_EVENTS.STUDENT_SIGNED_UP]: StudentSignedUpEvent;
  [DOMAIN_EVENTS.ADMIN_DEACTIVATED]: AdminDeactivatedEvent;
}

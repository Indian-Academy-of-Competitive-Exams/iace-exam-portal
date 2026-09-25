/** Every cross-module event in the platform, declared in one place (docs/03 §6). */

export const DOMAIN_EVENTS = {
  /** A first evaluation landed. DURABLE — the scorer writes it to `OutboxEvent`, never to the bus. */
  /** A student's PIN changed; auth revoked the sessions before emitting. ANNOUNCED — no handler. */
  STUDENT_PIN_RESET: 'student.pin_reset',
  /** One student's access moved. WIRED — see the access module's cache listener. */
  STUDENT_ACCESS_CHANGED: 'student.access_changed',
  /** A series-wide change: every student's cached catalog is stale. WIRED — access and tests. */
  ACCESS_CATALOG_CHANGED: 'access.catalog_changed',
  /** A student finished signing up and has an account for the first time. WIRED — see students. */
  STUDENT_SIGNED_UP: 'student.signed_up',
} as const;

/** Only the names below carry a payload: one without one is not a thing the bus can publish. */
export type DomainEventName = keyof DomainEventPayloads;

/** Which of the two PIN paths this was. Both revoke every other session. */
export const PIN_RESET_REASONS = {
  /** Forgotten: proved the number by OTP, then chose a new PIN. */
  OTP_RESET: 'otp_reset',
  /** Remembered: signed in, gave the current PIN, chose a new one. */
  SELF_CHANGE: 'self_change',
} as const;

export type PinResetReason = (typeof PIN_RESET_REASONS)[keyof typeof PIN_RESET_REASONS];

export interface StudentPinResetEvent {
  studentId: string;
  mobile: string;
  reason: PinResetReason;
}

export interface StudentAccessChangedEvent {
  studentId: string;
}

export interface AccessCatalogChangedEvent {
  testSeriesId: string;
}

export interface StudentSignedUpEvent {
  studentId: string;
}

/** Name → payload. `emit` is typed off this, so an event cannot be published with the wrong shape and a handler cannot claim a shape the producer never sends. */
export interface DomainEventPayloads {
  [DOMAIN_EVENTS.STUDENT_PIN_RESET]: StudentPinResetEvent;
  [DOMAIN_EVENTS.STUDENT_ACCESS_CHANGED]: StudentAccessChangedEvent;
  [DOMAIN_EVENTS.ACCESS_CATALOG_CHANGED]: AccessCatalogChangedEvent;
  [DOMAIN_EVENTS.STUDENT_SIGNED_UP]: StudentSignedUpEvent;
}

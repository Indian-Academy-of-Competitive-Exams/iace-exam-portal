import { type ActorTypes } from '@iace/contracts';

/**
 * Everything the platform sends OUTWARD, behind one interface (docs/03 §10).
 *
 * It started life as `OtpSender` and would have stayed that way until the day
 * "your result is ready" needed sending, at which point there would have been
 * two delivery abstractions, two places holding provider credentials, and two
 * answers to "is this allowed in production". Generalising it while OTP is
 * still the only caller costs one indirection now and settles that.
 *
 * A sender implements DELIVERY, not policy. It does not decide whether to send,
 * how often, or to whom — those are the caller's, which is why nothing here
 * touches Redis or the database.
 */

/** DI token for the active provider. */
export const MESSAGE_SENDER = Symbol('MESSAGE_SENDER');

/**
 * How a message reaches someone. `IN_APP` is the `Notification` table rather
 * than a third-party provider, which is exactly why it belongs in the same
 * list: the caller says what to send and to whom, not which vendor to call.
 */
export const MESSAGE_CHANNELS = {
  SMS: 'sms',
  EMAIL: 'email',
  IN_APP: 'in_app',
} as const;

export type MessageChannel = (typeof MESSAGE_CHANNELS)[keyof typeof MESSAGE_CHANNELS];

/**
 * What the message IS. A provider needs this: MSG91 sends a DLT-registered
 * template per message type, not free text, so "which template" has to be part
 * of the message rather than something a sender infers from its body.
 *
 * Only OTP is sent today. The rest are declared so the next caller picks a name
 * from a list instead of inventing one.
 */
export const MESSAGE_KINDS = {
  OTP: 'otp',
  /** TODO(docs/03 §10): sent when a scoring job finishes. */
  RESULT_READY: 'result_ready',
  /** TODO(docs/03 §10): sent when a test reaches a student's group. */
  TEST_ASSIGNED: 'test_assigned',
  /** TODO(docs/03 §10): sent before a scheduled test starts. */
  TEST_REMINDER: 'test_reminder',
} as const;

export type MessageKind = (typeof MESSAGE_KINDS)[keyof typeof MESSAGE_KINDS];

export interface OutboundMessage {
  channel: MessageChannel;
  kind: MessageKind;
  /** Mobile number, email address, or student id — whatever the channel takes. */
  to: string;
  /** Who this is for. Lets a sender pick the right sender-id or from-address. */
  actor: (typeof ActorTypes)[keyof typeof ActorTypes];
  /** Human-readable, for channels that carry one (email, in-app). */
  subject?: string;
  /** The rendered message. A template provider may ignore it and use `data`. */
  body: string;
  /**
   * Template variables. Kept separate from `body` because a DLT-registered SMS
   * template is filled in by the provider, not by us — the body is what a
   * console or SMTP sender shows when there is no template to fill.
   */
  data?: Record<string, string | number>;
}

export interface MessageSender {
  send(message: OutboundMessage): Promise<void>;
}

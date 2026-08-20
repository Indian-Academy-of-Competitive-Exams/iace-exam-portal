import { type ActorTypes } from '@iace/contracts';

/** Everything the platform sends OUTWARD, behind one interface (docs/03 §10). */

/** DI token for the active provider. */
export const MESSAGE_SENDER = Symbol('MESSAGE_SENDER');

/** How a message reaches someone. */
export const MESSAGE_CHANNELS = {
  SMS: 'sms',
  EMAIL: 'email',
  IN_APP: 'in_app',
} as const;

export type MessageChannel = (typeof MESSAGE_CHANNELS)[keyof typeof MESSAGE_CHANNELS];

/** What the message IS. */
export const MESSAGE_KINDS = {
  OTP: 'otp',
  /** TODO(docs/03 §10): sent when a scoring job finishes. */
  RESULT_READY: 'result_ready',
  /** TODO(docs/03 §10): sent when a test reaches a student. */
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
  /** Template variables. */
  data?: Record<string, string | number>;
}

export interface MessageSender {
  send(message: OutboundMessage): Promise<void>;
}

import { type ActorTypes } from '@iace/contracts';

/** Everything the platform sends OUTWARD, behind one interface (docs/03 §10). */

/** DI token for the active provider. */
export const MESSAGE_SENDER = Symbol('MESSAGE_SENDER');

/** How a message reaches someone. */
export const MESSAGE_CHANNELS = {
  SMS: 'sms',
  EMAIL: 'email',
  WHATSAPP: 'whatsapp',
  IN_APP: 'in_app',
} as const;

export type MessageChannel = (typeof MESSAGE_CHANNELS)[keyof typeof MESSAGE_CHANNELS];

/** What the message IS. Each one is a DLT template id in env; an unconfigured kind simply does not send. */
export const MESSAGE_KINDS = {
  OTP: 'otp',
  /** The PIN a roster import gave a student, which is the only time they are told one. */
  PIN: 'pin',
  /** Sent when a scoring job finishes. WIRED — through the notification delivery ledger. */
  RESULT_READY: 'result_ready',
  /** Reachable but unproduced: policy escalates it, and nothing asks for one yet. */
  TEST_ASSIGNED: 'test_assigned',
  /** Not wired (docs/03 §10): needs a scheduled job reading Test.opensAt/lateEntrySec. */
  TEST_REMINDER: 'test_reminder',
} as const;

export type MessageKind = (typeof MESSAGE_KINDS)[keyof typeof MESSAGE_KINDS];

/** The kinds a sender is WAITING on: nobody gets in without them, so a missing template is fatal. */
export const REQUIRED_KINDS = new Set<MessageKind>([MESSAGE_KINDS.OTP, MESSAGE_KINDS.PIN]);

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

/**
 * What each kind of notification is worth spending on, and how long the free
 * channels get to work before we pay for one. Code-owned like FEATURE_KEYS:
 * money and urgency are decisions, not rows an admin can drift.
 */
import { DeliveryChannel } from '@prisma/client';
import { NOTIFICATION_TYPE, type NotificationType } from '@iace/contracts';
import { MESSAGE_CHANNELS, type MessageChannel } from '../common/messaging';

/** Why we decided not to spend. Written to `NotificationDelivery.skipReason`. */
export const SKIP_REASONS = {
  NO_TEMPLATE: 'NO_TEMPLATE',
  NO_CONTACT: 'NO_CONTACT',
  OPTED_OUT: 'OPTED_OUT',
  ALREADY_READ: 'ALREADY_READ',
} as const;

export type SkipReason = (typeof SKIP_REASONS)[keyof typeof SKIP_REASONS];

/** The ledger's enum against the sender's. A drift here is a compile error, not a silent misroute. */
export const OUTBOUND_CHANNEL = {
  [DeliveryChannel.EMAIL]: MESSAGE_CHANNELS.EMAIL,
  [DeliveryChannel.SMS]: MESSAGE_CHANNELS.SMS,
  [DeliveryChannel.WHATSAPP]: MESSAGE_CHANNELS.WHATSAPP,
} as const satisfies Partial<Record<DeliveryChannel, MessageChannel>>;

export type PaidChannel = keyof typeof OUTBOUND_CHANNEL;

/** How long a student gets to open the app before we start paying to reach them. */
const DEFER_SEC = 600;

/** Waiting out the window must still leave this long to act, or we pay immediately instead. */
export const ACTION_MARGIN_SEC = 1800;

const MS = 1000;

interface Policy {
  /** Ordered. Empty means this kind never justifies a paid message, however long it goes unread. */
  escalate: readonly PaidChannel[];
  deferSec: number;
}

/** WhatsApp leads: a DLT template cannot carry a deep link, so SMS asks them to go and look. */
export const NOTIFICATION_POLICY = {
  [NOTIFICATION_TYPE.RESULT_READY]: { escalate: [DeliveryChannel.WHATSAPP], deferSec: DEFER_SEC },
  [NOTIFICATION_TYPE.TEST_ASSIGNED]: {
    escalate: [DeliveryChannel.WHATSAPP, DeliveryChannel.SMS],
    deferSec: DEFER_SEC,
  },
  [NOTIFICATION_TYPE.GRANT_ADDED]: { escalate: [DeliveryChannel.WHATSAPP], deferSec: DEFER_SEC },
  // Access a student did not ask for and cannot lose. The bell is the whole of it.
  [NOTIFICATION_TYPE.ENROLLMENT_ADDED]: { escalate: [], deferSec: DEFER_SEC },
  // An announcement pays only when an admin says so, which the console has yet to be able to say.
  [NOTIFICATION_TYPE.GENERIC]: { escalate: [], deferSec: DEFER_SEC },
} as const satisfies Record<NotificationType, Policy>;

export interface EscalationPlan {
  channels: readonly PaidChannel[];
  /** Seconds to wait first. Zero means the deadline is too close to wait out. */
  deferSec: number;
}

/** Urgency belongs to the notification, not the kind — same kind, opposite answers. */
export function escalationFor(
  type: NotificationType,
  actBy: Date | null,
  now: Date,
): EscalationPlan {
  const policy = NOTIFICATION_POLICY[type];
  if (policy.escalate.length === 0) return { channels: [], deferSec: 0 };

  const leftToAct = actBy === null ? Infinity : actBy.getTime() - now.getTime();
  const cannotWait = leftToAct <= (policy.deferSec + ACTION_MARGIN_SEC) * MS;

  return { channels: policy.escalate, deferSec: cannotWait ? 0 : policy.deferSec };
}

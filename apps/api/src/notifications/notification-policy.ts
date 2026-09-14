/**
 * What each kind of notification is worth spending on, and how long the free
 * channels get to work before we pay for one. Code-owned like FEATURE_KEYS:
 * money and urgency are the institute's decisions, never a student's setting.
 */
import { DeliveryChannel } from '@prisma/client';
import { MESSAGE_CHANNELS, type MessageChannel } from '../common/messaging';

/** Why we decided not to spend. Written to `NotificationDelivery.skipReason`. */
export const SKIP_REASONS = {
  NO_TEMPLATE: 'NO_TEMPLATE',
  NO_CONTACT: 'NO_CONTACT',
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

/** What the delivery queue may be handed. A free channel is sent where it is booked, not there. */
export const PAID_CHANNELS = Object.keys(OUTBOUND_CHANNEL) as PaidChannel[];

/** How long a student gets to open the app before we start paying to reach them. */
const DEFER_SEC = 600;

/** Waiting out the window must still leave this long to act, or we pay immediately instead. */
export const ACTION_MARGIN_SEC = 1800;

const MS = 1000;

export interface EscalationPlan {
  channels: readonly PaidChannel[];
  /** Seconds to wait first. Zero means the deadline is too close to wait out. */
  deferSec: number;
}

/** In-app first: no kind buys a message, so the only paid chain is the one an admin chose for a send. */
export function escalationFor(
  actBy: Date | null,
  now: Date,
  chosen: readonly PaidChannel[] = [],
): EscalationPlan {
  if (chosen.length === 0) return { channels: [], deferSec: 0 };

  // Urgency belongs to the notification, not its kind: the same kind gets opposite answers.
  const leftToAct = actBy === null ? Infinity : actBy.getTime() - now.getTime();
  const cannotWait = leftToAct <= (DEFER_SEC + ACTION_MARGIN_SEC) * MS;

  return { channels: chosen, deferSec: cannotWait ? 0 : DEFER_SEC };
}

/** The one channel tried first. The rest are a FALLBACK chain, not a fan-out — never booked together. */
export function firstChannelFor(chosen: readonly PaidChannel[] = []): PaidChannel | null {
  return chosen[0] ?? null;
}

/** What to try when a channel has terminally failed. Null means this message has run out of road. */
export function nextChannelAfter(
  channel: PaidChannel,
  chosen: readonly PaidChannel[] = [],
): PaidChannel | null {
  const at = chosen.indexOf(channel);

  return at >= 0 ? (chosen[at + 1] ?? null) : null;
}

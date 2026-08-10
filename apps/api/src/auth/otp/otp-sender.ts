import { type ActorType } from '@iace/contracts';

/** DI token for the active delivery channel. */
export const OTP_SENDER = Symbol('OTP_SENDER');

export interface OtpDelivery {
  actor: ActorType;
  /** Mobile number for students, email address for admins. */
  destination: string;
  code: string;
  ttlSec: number;
}

/**
 * Swapping console → MSG91 (student SMS) and SMTP (admin email) is a provider
 * change in AuthModule and nothing else; no caller knows which one is bound.
 */
export interface OtpSender {
  send(delivery: OtpDelivery): Promise<void>;
}

import { type ActorType } from '@iace/contracts';

/**
 * Every Redis key the platform uses is minted here, so the keyspace stays greppable and no two
 * features collide on a prefix.
 */
export const redisKeys = {
  /** The pending OTP for one identity. Holds the HMAC of the code, never the code. */
  otp: (actor: ActorType, identifier: string) => `otp:${actor.toLowerCase()}:${identifier}`,

  /** Set while a resend is refused; its TTL is the remaining cooldown. */
  otpCooldown: (actor: ActorType, identifier: string) =>
    `otp:cooldown:${actor.toLowerCase()}:${identifier}`,

  /**
   * A student's consecutive failed PIN attempts. Cleared on success, and by its own TTL, so an
   * occasional typo never accumulates into a lockout.
   */
  pinAttempts: (mobile: string) => `pin:attempts:${mobile}`,

  /** Present while a student is locked out of PIN login; TTL = time remaining. */
  pinLock: (mobile: string) => `pin:lock:${mobile}`,

  /** How many times this number has been locked out recently — the rung of the escalation ladder. */
  pinLockouts: (mobile: string) => `pin:lockouts:${mobile}`,

  /** Hash of the single-use ticket that authorises setting a PIN after an OTP. */
  pinSetup: (mobile: string) => `pin:setup:${mobile}`,

  /** One refresh session: token hash + device binding. TTL = refresh lifetime. */
  session: (actor: ActorType, subjectId: string, sessionId: string) =>
    `session:${actor.toLowerCase()}:${subjectId}:${sessionId}`,

  /** Index of a subject's live session ids — powers "sign out everywhere". */
  sessionIndex: (actor: ActorType, subjectId: string) =>
    `sessions:${actor.toLowerCase()}:${subjectId}`,
} as const;

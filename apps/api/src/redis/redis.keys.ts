import { type ActorType } from '@iace/contracts';

/**
 * Every Redis key the platform uses is minted here, so the keyspace stays
 * greppable and no two features collide on a prefix.
 */
export const redisKeys = {
  /** The pending OTP for one identity. Holds the HMAC of the code, never the code. */
  otp: (actor: ActorType, identifier: string) => `otp:${actor.toLowerCase()}:${identifier}`,

  /** Set while a resend is refused; its TTL is the remaining cooldown. */
  otpCooldown: (actor: ActorType, identifier: string) =>
    `otp:cooldown:${actor.toLowerCase()}:${identifier}`,

  /** One refresh session: token hash + device binding. TTL = refresh lifetime. */
  session: (actor: ActorType, subjectId: string, sessionId: string) =>
    `session:${actor.toLowerCase()}:${subjectId}:${sessionId}`,

  /** Index of a subject's live session ids — powers "sign out everywhere". */
  sessionIndex: (actor: ActorType, subjectId: string) =>
    `sessions:${actor.toLowerCase()}:${subjectId}`,
} as const;

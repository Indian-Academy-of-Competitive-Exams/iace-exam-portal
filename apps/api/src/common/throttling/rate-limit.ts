/**
 * Who a request counts against, and the arithmetic of one fixed window. Kept
 * apart from the Nest wiring so both can be read without a running Redis.
 */
import { type ThrottlerStorage } from '@nestjs/throttler';
import { type AuthenticatedUser } from '../security';

/** Derived rather than imported: the package does not re-export the record shape from its entry point. */
export type ThrottlerRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

/** A branch of two hundred students shares one public address, so an IP is only ever the fallback. */
export function trackerFor(user: AuthenticatedUser | undefined, ip: string | undefined): string {
  return user ? `${user.actor.toLowerCase()}:${user.id}` : `ip:${ip ?? 'unknown'}`;
}

/** What the guard is told when Redis cannot answer: nobody is blocked mid-exam by a throttle we cannot read. */
export const ALLOWED: ThrottlerRecord = {
  totalHits: 0,
  timeToExpire: 0,
  isBlocked: false,
  timeToBlockExpire: 0,
};

/** One window's count turned into the record the guard reads. `ttl` and `remainingMs` are milliseconds. */
export function windowRecord(
  hits: number,
  limit: number,
  remainingMs: number,
  ttl: number,
): ThrottlerRecord {
  const timeToExpire = Math.ceil((remainingMs > 0 ? remainingMs : ttl) / 1000);
  const isBlocked = hits > limit;

  return {
    totalHits: hits,
    timeToExpire,
    isBlocked,
    timeToBlockExpire: isBlocked ? timeToExpire : 0,
  };
}

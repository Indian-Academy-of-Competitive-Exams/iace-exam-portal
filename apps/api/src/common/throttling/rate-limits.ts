/**
 * The routes that need a tighter window than the platform default, marked by a
 * decorator rather than a path list — a route carries its own limit, and moving
 * it cannot leave the limit behind.
 */
import { SetMetadata, type ExecutionContext } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'iace:rate-limit';

/** Each name is a named throttler in `ThrottlingModule`, and skips every route not marked with it. */
export const RATE_LIMITS = {
  AUTH: 'auth',
  SITTING: 'sitting',
  SHARE: 'share',
} as const;

export type RateLimitName = (typeof RATE_LIMITS)[keyof typeof RATE_LIMITS];

const marked = (name: RateLimitName) => SetMetadata(RATE_LIMIT_KEY, name);

/** OTP, PIN and refresh: unauthenticated, so counted per address, and a branch shares one. */
export const AuthRateLimit = () => marked(RATE_LIMITS.AUTH);

/** Autosave and submit: counted per student, so one runaway client cannot crowd out a hall. */
export const SittingRateLimit = () => marked(RATE_LIMITS.SITTING);

/** A public report link, which anyone holding it can open — counted per address. */
export const ShareRateLimit = () => marked(RATE_LIMITS.SHARE);

/** True means "not this route": a named throttler runs only where its own decorator put it. */
export function notMarkedWith(name: RateLimitName) {
  return (context: ExecutionContext): boolean =>
    Reflect.getMetadata(RATE_LIMIT_KEY, context.getHandler()) !== name;
}

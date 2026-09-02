/**
 * What helmet sends on every API response. This API answers JSON and nothing
 * else, so its own policy denies everything; the pages that render question
 * content are the SPAs, and their policy belongs to whatever serves their HTML.
 */
import type { HelmetOptions } from 'helmet';

/** Nothing loads, nothing frames it, nothing rewrites where a relative URL in it would point. */
const DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'none'"],
  'frame-ancestors': ["'none'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

/** Helmet's other defaults stand — only the policy it guesses for an HTML app is replaced. */
export const helmetOptions: HelmetOptions = {
  contentSecurityPolicy: { useDefaults: false, directives: DIRECTIVES },
};

/** In production the env schema has already refused an empty list, so `false` only ever bites in dev. */
export function corsOrigin(origins: readonly string[], isProduction: boolean): string[] | boolean {
  if (origins.length > 0) return [...origins];
  return !isProduction;
}

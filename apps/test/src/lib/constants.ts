/**
 * App-level string vocabularies. Anything that appears in more than one place —
 * or that a typo would break silently — is named here rather than written
 * inline. Shared, cross-app values (actor types, error codes) live in
 * `@iace/contracts`; these are the ones only this SPA cares about.
 */

/** Route paths. Referenced by the router, the guards and every navigate(). */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  PROFILE: '/profile',
  PROFILE_EDIT: '/profile/edit',
  ACCOUNT: '/account',
  /** React Router's catch-all. */
  NOT_FOUND: '*',
} as const;

/**
 * The nav, in the order a student needs them. Deliberately short — they came
 * here to take a test, not to administer an account.
 */
export const NAV_ITEMS = [
  { to: ROUTES.HOME, label: 'Home' },
  { to: ROUTES.PROFILE, label: 'Profile' },
  { to: ROUTES.ACCOUNT, label: 'Sign-in' },
] as const;

/**
 * The student's own record. Shared so the profile screens and every upload
 * write to the same cache entry — two keys would mean a photo that uploaded
 * successfully and a page that still says it is missing.
 */
export const ME_QUERY_KEY = ['me'] as const;

/**
 * localStorage keys OWNED BY THIS APP. Namespaced per app so the SPAs sharing
 * one origin never read each other's session.
 *
 * The theme key is deliberately absent: it belongs to the design system
 * (`THEME_STORAGE_KEY` in @iace/ui) and is shared on purpose — one person, one
 * origin, one choice of palette.
 */
export const STORAGE_KEYS = {
  // Named for the app, not the audience: the broader student portal arrives as
  // a separate SPA later and would otherwise claim this same key on this same
  // origin, and whichever loaded last would silently clobber the other.
  AUTH: 'iace.test.auth',
} as const;

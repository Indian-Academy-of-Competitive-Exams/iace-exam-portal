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
  /** React Router's catch-all. */
  NOT_FOUND: '*',
} as const;

export const THEMES = {
  LIGHT: 'light',
  DARK: 'dark',
} as const;

/** The attribute the design-system tokens key off, on <html>. */
export const THEME_ATTRIBUTE = 'data-theme';

/**
 * localStorage keys. Namespaced per app so the two SPAs on localhost:5173 and
 * :5174 never read each other's session.
 *
 * NOTE: index.html applies the stored theme before first paint, so it repeats
 * THEME and THEME_ATTRIBUTE as literals — it runs before this bundle exists.
 * Change one, change the other.
 */
export const STORAGE_KEYS = {
  THEME: 'iace.theme',
  // Named for the app, not the audience: the broader student portal arrives as
  // a separate SPA later and would otherwise claim this same key on this same
  // origin, and whichever loaded last would silently clobber the other.
  AUTH: 'iace.test.auth',
} as const;

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
  STUDENTS: '/students',
  STUDENT: (id: string) => `/students/${id}`,
  STUDENT_PATTERN: '/students/:id',
  GROUPS: '/groups',
  IMPORT_STUDENTS: '/students/import',
  /** React Router's catch-all. */
  NOT_FOUND: '*',
} as const;

/** The left-hand nav, in the order an admin works through them. */
export const NAV_ITEMS = [
  { to: ROUTES.HOME, label: 'Overview' },
  { to: ROUTES.STUDENTS, label: 'Students' },
  { to: ROUTES.GROUPS, label: 'Groups' },
] as const;

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
  AUTH: 'iace.admin.auth',
} as const;

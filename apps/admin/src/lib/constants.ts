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
  BRANCHES: '/branches',
  /** Adding students to ONE group: the group is in the path, not in the file. */
  IMPORT_GROUP_MEMBERS: (id: string) => `/groups/${id}/students/import`,
  IMPORT_GROUP_MEMBERS_PATTERN: '/groups/:id/students/import',
  IMPORT_STUDENTS: '/students/import',
  /** React Router's catch-all. */
  NOT_FOUND: '*',
} as const;

/** The left-hand nav, in the order an admin works through them. */
export const NAV_ITEMS = [
  { to: ROUTES.HOME, label: 'Overview' },
  { to: ROUTES.STUDENTS, label: 'Students' },
  { to: ROUTES.GROUPS, label: 'Groups' },
  { to: ROUTES.BRANCHES, label: 'Branches' },
] as const;

/**
 * The signed-in admin's identity, cached under one key so `createAuth` and
 * anything that reads the session agree on where it lives.
 */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * localStorage keys OWNED BY THIS APP. Namespaced per app so the SPAs sharing
 * one origin never read each other's session.
 *
 * The theme key is deliberately absent: it belongs to the design system
 * (`THEME_STORAGE_KEY` in @iace/ui) and is shared on purpose — one person, one
 * origin, one choice of palette.
 */
export const STORAGE_KEYS = {
  AUTH: 'iace.admin.auth',
} as const;

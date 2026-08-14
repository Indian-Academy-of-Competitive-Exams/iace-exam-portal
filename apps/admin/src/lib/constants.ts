import { FEATURE_KEYS, type FeatureKey } from '@iace/contracts';

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
  /** Super-admin only: who the admins are, what the sectors are, who holds what. */
  ADMINS: '/admins',
  FEATURES: '/features',
  PERMISSIONS: '/permissions',
  /** React Router's catch-all. */
  NOT_FOUND: '*',
} as const;

export interface AdminNavItem {
  to: string;
  label: string;
  /** Needs at least READ on this feature. */
  feature?: FeatureKey;
  /** Needs isSuperAdmin, whatever is granted. */
  superAdminOnly?: boolean;
}

/**
 * The nav, in the order an admin works through it, each item carrying what it
 * takes to see it.
 *
 * The requirement lives HERE rather than in the shell, because the shell is
 * shared with the student app and must not learn that a section called
 * "Branches" exists, let alone what gates it. A section with no requirement is
 * visible to every signed-in admin.
 *
 * Hiding is not security — every route behind these is enforced server-side.
 * It is about not showing somebody a door that will not open.
 */
export const NAV_ITEMS: readonly AdminNavItem[] = [
  { to: ROUTES.HOME, label: 'Overview' },
  { to: ROUTES.STUDENTS, label: 'Students', feature: FEATURE_KEYS.STUDENT_MANAGEMENT },
  { to: ROUTES.GROUPS, label: 'Groups', feature: FEATURE_KEYS.STUDENT_MANAGEMENT },
  { to: ROUTES.BRANCHES, label: 'Branches', feature: FEATURE_KEYS.STUDENT_MANAGEMENT },
  { to: ROUTES.ADMINS, label: 'Admins', superAdminOnly: true },
  { to: ROUTES.FEATURES, label: 'Features', superAdminOnly: true },
  { to: ROUTES.PERMISSIONS, label: 'Permissions', superAdminOnly: true },
];

/**
 * The signed-in admin's identity, cached under one key so `createAuth` and
 * anything that reads the session agree on where it lives.
 */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** Features and their grant lists — shared by the Features and Permissions
 *  screens, so a grant made on one refreshes the other. */
export const FEATURES_QUERY_KEY = ['admin', 'features'] as const;

/**
 * The admin list the Permissions screen assigns from.
 *
 * PAGE_SIZE_MAX, deliberately: this is an assignment surface, not a browse one,
 * and an admin missing from it cannot be granted anything. An institute with
 * more than a hundred admins would need a Combobox over useInfinitePages here
 * (the rule in CLAUDE.md) — flagged rather than pretended away.
 */
export const PAGE_SIZE_FOR_PICKERS = 100;

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

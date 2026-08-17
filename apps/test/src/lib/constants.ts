import { KeyRound, User } from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
/** App-level string vocabularies. Cross-app ones live in `@iace/contracts`. */

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
 * Empty on purpose, so the shell draws no sidebar at all. The mark leads home and
 * Profile and Change PIN live under the account menu.
 */
export const NAV_ITEMS: readonly NavItem[] = [];

/** The account screens, under the user menu, above Log out. */
export const USER_MENU_ITEMS: readonly NavItem[] = [
  { to: ROUTES.PROFILE, label: 'Profile', icon: User },
  { to: ROUTES.ACCOUNT, label: 'Change PIN', icon: KeyRound },
];

/** The signed-in student's identity, cached under one key. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** The student's RECORD — profile, documents, groups. A different key from the identity above. */
export const PROFILE_QUERY_KEY = ['me'] as const;

/**
 * localStorage keys owned by this app, namespaced so the SPAs never read each other's.
 * The theme key is absent on purpose: it belongs to @iace/ui and is shared.
 */
export const STORAGE_KEYS = {
  // Named for the app, not the audience: the student portal is a separate SPA on this origin.
  AUTH: 'iace.test.auth',
} as const;

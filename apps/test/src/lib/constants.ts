import { Home, KeyRound, User } from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
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
export const NAV_ITEMS: readonly NavItem[] = [
  { to: ROUTES.HOME, label: 'Home', icon: Home },
  { to: ROUTES.PROFILE, label: 'Profile', icon: User },
  { to: ROUTES.ACCOUNT, label: 'Sign-in', icon: KeyRound },
];

/**
 * The signed-in student's identity, cached under one key so `createAuth` and
 * anything that reads the session agree on where it lives.
 */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/**
 * The student's own RECORD — profile, documents, groups. A different thing from
 * the identity above, and deliberately a different key: the profile screens and
 * every upload write here, and the header's avatar reads it, so a photo shows
 * the moment it uploads rather than on the next reload.
 */
export const PROFILE_QUERY_KEY = ['me'] as const;

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

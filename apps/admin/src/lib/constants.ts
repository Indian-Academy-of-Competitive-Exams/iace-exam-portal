import {
  Building2,
  KeyRound,
  Layers,
  LayoutDashboard,
  ShieldCheck,
  ToggleRight,
  Upload,
  Users,
} from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
import { FEATURE_KEYS } from '@iace/contracts';

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

/**
 * A NavItem plus the one thing the shared shape deliberately does not carry.
 *
 * `superAdminOnly` is NOT a feature key and must never become one: Admins,
 * Features and Permissions are the screens that decide who decides, so gating
 * them on a grantable permission would let the permission system hand out
 * control of itself. It stays app-local — @iace/app-kit has no concept of a
 * super admin, and giving it one would be teaching the shared chrome about
 * this product's authorisation model.
 */
export interface AdminNavItem extends NavItem {
  superAdminOnly?: boolean;
  children?: AdminNavItem[];
}

/**
 * The nav, in the order an admin works through it.
 *
 * Sections rather than a flat list now: the shell resolves each one to an
 * accordion or a side panel by child count (NAV_INLINE_MAX_ITEMS), so this file
 * says what belongs together and the chrome decides how it opens.
 */
export const NAV_ITEMS: readonly AdminNavItem[] = [
  { to: ROUTES.HOME, label: 'Overview', icon: LayoutDashboard },
  {
    label: 'Students',
    icon: Users,
    featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
    children: [
      { to: ROUTES.STUDENTS, label: 'All students', icon: Users },
      { to: ROUTES.IMPORT_STUDENTS, label: 'Import students', icon: Upload },
      { to: ROUTES.GROUPS, label: 'Groups', icon: Layers },
      { to: ROUTES.BRANCHES, label: 'Branches', icon: Building2 },
    ],
  },
  {
    label: 'Administration',
    icon: ShieldCheck,
    superAdminOnly: true,
    children: [
      { to: ROUTES.ADMINS, label: 'Admins', icon: ShieldCheck },
      { to: ROUTES.FEATURES, label: 'Features', icon: ToggleRight },
      { to: ROUTES.PERMISSIONS, label: 'Permissions', icon: KeyRound },
    ],
  },
];

/**
 * Strip what this admin may not see, at every depth.
 *
 * Only `superAdminOnly` — `featureKey` is the shell's job, and doing it twice
 * would be two rules to keep in step. Recursive because a super-admin-only
 * child can sit inside an otherwise visible section.
 */
export function filterAdminNav(
  items: readonly AdminNavItem[],
  isSuperAdmin: boolean,
): AdminNavItem[] {
  return items.reduce<AdminNavItem[]>((kept, item) => {
    if (item.superAdminOnly && !isSuperAdmin) return kept;
    const children = item.children ? filterAdminNav(item.children, isSuperAdmin) : undefined;
    if (children?.length === 0 && !item.to) return kept;
    kept.push(children ? { ...item, children } : item);
    return kept;
  }, []);
}

/**
 * The signed-in admin's identity, cached under one key so `createAuth` and
 * anything that reads the session agree on where it lives.
 */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** Features and their grant lists — shared by the Features and Permissions
 *  screens, so a grant made on one refreshes the other. */
export const FEATURES_QUERY_KEY = ['admin', 'features'] as const;

/**
 * Admins. Shared for the same reason: a grant changes the feature's holder list
 * AND the admin's permission map, and the Permissions screen renders off the
 * second — so both caches have to be invalidated by whichever screen made the
 * change, or the checkboxes show the state from before the click.
 */
export const ADMINS_QUERY_KEY = ['admin', 'admins'] as const;

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

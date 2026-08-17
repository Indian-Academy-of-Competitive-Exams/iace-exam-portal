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

/** App-level string vocabularies. Cross-app ones live in `@iace/contracts`. */

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
 * A NavItem plus `superAdminOnly`, which is NOT a feature key and must never become one:
 * the screens it gates are the ones that decide who decides.
 */
export interface AdminNavItem extends NavItem {
  superAdminOnly?: boolean;
  children?: AdminNavItem[];
}

/** The nav, in the order an admin works through it. The shell decides how a section opens. */
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

/** Strips `superAdminOnly` at every depth. `featureKey` is the shell's job. */
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

/** The signed-in admin's identity, cached under one key. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** Features and their grant lists — shared by the Features and Permissions
 *  screens, so a grant made on one refreshes the other. */
export const FEATURES_QUERY_KEY = ['admin', 'features'] as const;

/** Admins. A grant changes both this and the feature list, so both are invalidated together. */
export const ADMINS_QUERY_KEY = ['admin', 'admins'] as const;

/**
 * The admin list the Permissions screen assigns from. PAGE_SIZE_MAX: an admin
 * missing from it cannot be granted anything. Past a hundred, this needs a Combobox.
 */
export const PAGE_SIZE_FOR_PICKERS = 100;

/**
 * localStorage keys owned by this app, namespaced so the SPAs never read each other's.
 * The theme key is absent on purpose: it belongs to @iace/ui and is shared.
 */
export const STORAGE_KEYS = {
  AUTH: 'iace.admin.auth',
} as const;

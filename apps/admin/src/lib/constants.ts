import {
  BookOpen,
  Building2,
  FolderTree,
  GraduationCap,
  History,
  KeyRound,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
import {
  FEATURE_KEYS,
  STUDENT_TYPE,
  type AuditAction,
  type AuditActorType,
  type AuditFeature,
  type ImportSource,
  type StudentType,
} from '@iace/contracts';

/** App-level string vocabularies. Cross-app ones live in `@iace/contracts`. */

/** Route paths. Referenced by the router, the guards and every navigate(). */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  STUDENTS: '/students',
  STUDENT: (id: string) => `/students/${id}`,
  STUDENT_PATTERN: '/students/:id',
  BRANCHES: '/branches',
  EXAMS: '/exams',
  IMPORT_STUDENTS: '/students/import',
  /** The question bank. Import and taxonomy sit under it, before the :id route. */
  QUESTIONS: '/questions',
  QUESTION_NEW: '/questions/new',
  IMPORT_QUESTIONS: '/questions/import',
  TAXONOMY: '/questions/taxonomy',
  QUESTION: (id: string) => `/questions/${id}`,
  QUESTION_PATTERN: '/questions/:id',
  /** Super-admin only: who the admins are and who holds what. */
  ADMINS: '/admins',
  PERMISSIONS: '/permissions',
  /** Every admin reaches these — the service, not the route, scopes what they see. */
  AUDIT: '/audit',
  AUDIT_IMPORTS: '/audit/imports',
  /** React Router's catch-all. */
  NOT_FOUND: '*',
} as const;

/** What each student type is called on screen. The enum values are never shown raw. */
export const STUDENT_TYPE_LABELS: Readonly<Record<StudentType, string>> = {
  [STUDENT_TYPE.ONLINE]: 'Online',
  [STUDENT_TYPE.OFFLINE]: 'At a branch',
  [STUDENT_TYPE.NON_IACE]: 'Not an IACE student',
};

/** What an audit row's `feature` is called on screen. */
export const AUDIT_FEATURE_LABELS: Readonly<Record<AuditFeature, string>> = {
  STUDENT: 'Student',
  STUDENT_PROFILE: 'Student profile',
  GROUP: 'Group',
  BRANCH: 'Branch',
  ADMIN: 'Admin',
  QUESTION: 'Question',
  TEST: 'Test',
  EXAM_TYPE: 'Exam type',
  TAXONOMY_SUBJECT: 'Subject',
  TAXONOMY_TOPIC: 'Topic',
  TAXONOMY_SUB_TOPIC: 'Sub-topic',
  FEATURE_PERMISSION: 'Feature permission',
};

/** What an audit row's `action` is called on screen. */
export const AUDIT_ACTION_LABELS: Readonly<Record<AuditAction, string>> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  ACTIVATE: 'Activated',
  DEACTIVATE: 'Deactivated',
  BLOCK: 'Blocked',
  UNBLOCK: 'Unblocked',
  IMPORT: 'Imported',
};

/** What an audit row's `actorType` is called on screen — the fallback when there is no `actorName`. */
export const AUDIT_ACTOR_TYPE_LABELS: Readonly<Record<AuditActorType, string>> = {
  ADMIN: 'Admin',
  STUDENT: 'Student',
  SCRIPT: 'Script',
  SYSTEM: 'System',
};

/** How an import run's rows got here — also the fallback when a run has no actor. */
export const IMPORT_SOURCE_LABELS: Readonly<Record<ImportSource, string>> = {
  INDIVIDUAL: 'Added by hand',
  SHEET: 'Uploaded sheet',
  SCRIPT: 'Portal sync',
  SELF_SIGNUP: 'Self sign-up',
};

/**
 * A NavItem plus `superAdminOnly`, which is NOT a feature key and must never become one:
 * the screens it gates are the ones that decide who decides.
 */
export interface AdminNavItem extends NavItem {
  superAdminOnly?: boolean;
  children?: AdminNavItem[];
}

/** The nav, in the order an admin works through it. Home is the mark, not a row here. */
export const NAV_ITEMS: readonly AdminNavItem[] = [
  {
    label: 'Students',
    icon: Users,
    featureKey: FEATURE_KEYS.STUDENT_MANAGEMENT,
    children: [
      { to: ROUTES.STUDENTS, label: 'All students', icon: Users },
      { to: ROUTES.IMPORT_STUDENTS, label: 'Import students', icon: Upload },
      { to: ROUTES.BRANCHES, label: 'Branches', icon: Building2 },
      { to: ROUTES.EXAMS, label: 'Exams', icon: GraduationCap },
    ],
  },
  {
    label: 'Question bank',
    icon: BookOpen,
    featureKey: FEATURE_KEYS.QUESTION_MANAGEMENT,
    children: [
      { to: ROUTES.QUESTIONS, label: 'All questions', icon: BookOpen },
      { to: ROUTES.IMPORT_QUESTIONS, label: 'Import questions', icon: Upload },
      { to: ROUTES.TAXONOMY, label: 'Subjects and topics', icon: FolderTree },
    ],
  },
  {
    label: 'Administration',
    icon: ShieldCheck,
    superAdminOnly: true,
    children: [
      { to: ROUTES.ADMINS, label: 'Admins', icon: ShieldCheck },
      { to: ROUTES.PERMISSIONS, label: 'Permissions', icon: KeyRound },
    ],
  },
  // Not superAdminOnly: every admin reaches this, scoped to their own rows.
  {
    label: 'Audit log',
    icon: History,
    children: [
      { to: ROUTES.AUDIT, label: 'Activity', icon: History },
      { to: ROUTES.AUDIT_IMPORTS, label: 'Imports', icon: Upload },
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

/** The code-owned feature keys and their grant lists, read by the Permissions screen. */
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

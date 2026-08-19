import {
  BookOpen,
  Building2,
  FolderTree,
  GraduationCap,
  History,
  KeyRound,
  Layers,
  ShieldCheck,
  ToggleRight,
  Upload,
  Users,
} from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
import {
  FEATURE_KEYS,
  GROUP_TYPE,
  STUDENT_TYPE,
  type AuditAction,
  type AuditActorType,
  type AuditFeature,
  type GroupType,
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
  GROUPS: '/groups',
  BRANCHES: '/branches',
  EXAM_TYPES: '/exam-types',
  /** Adding students to ONE group: the group is in the path, not in the file. */
  IMPORT_GROUP_MEMBERS: (id: string) => `/groups/${id}/students/import`,
  IMPORT_GROUP_MEMBERS_PATTERN: '/groups/:id/students/import',
  IMPORT_STUDENTS: '/students/import',
  /** The question bank. Import and taxonomy sit under it, before the :id route. */
  QUESTIONS: '/questions',
  QUESTION_NEW: '/questions/new',
  IMPORT_QUESTIONS: '/questions/import',
  TAXONOMY: '/questions/taxonomy',
  QUESTION: (id: string) => `/questions/${id}`,
  QUESTION_PATTERN: '/questions/:id',
  /** Super-admin only: who the admins are, what the sectors are, who holds what. */
  ADMINS: '/admins',
  FEATURES: '/features',
  PERMISSIONS: '/permissions',
  /** Every admin reaches this — the service, not the route, scopes what they see. */
  AUDIT: '/audit',
  /** React Router's catch-all. */
  NOT_FOUND: '*',
} as const;

/** What a group type is called on screen. */
export const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  [GROUP_TYPE.GLOBAL]: 'All students',
  [GROUP_TYPE.EXAM]: 'Exam',
  [GROUP_TYPE.PROGRAM]: 'Program',
  [GROUP_TYPE.SCHOLARSHIP]: 'Scholarship',
  [GROUP_TYPE.NON_IACE]: 'Non-IACE',
};

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

/** The audit screen's two tabs, also read from the URL — shared with `ChangedCell`'s link back to Imports. */
export const AUDIT_TAB = { ACTIVITY: 'activity', IMPORTS: 'imports' } as const;
export type AuditTabValue = (typeof AUDIT_TAB)[keyof typeof AUDIT_TAB];

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
      { to: ROUTES.GROUPS, label: 'Groups', icon: Layers },
      { to: ROUTES.BRANCHES, label: 'Branches', icon: Building2 },
      { to: ROUTES.EXAM_TYPES, label: 'Exam types', icon: GraduationCap },
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
      { to: ROUTES.FEATURES, label: 'Features', icon: ToggleRight },
      { to: ROUTES.PERMISSIONS, label: 'Permissions', icon: KeyRound },
    ],
  },
  // Not superAdminOnly: every admin reaches this, scoped to their own rows.
  { to: ROUTES.AUDIT, label: 'Audit log', icon: History },
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

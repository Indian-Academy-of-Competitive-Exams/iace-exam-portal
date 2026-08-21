import {
  BookOpen,
  Building2,
  ClipboardList,
  FolderTree,
  GraduationCap,
  History,
  KeyRound,
  Layers,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Users,
} from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
import {
  BRANCH_TYPE,
  FEATURE_KEYS,
  STUDENT_TYPE,
  type AuditAction,
  type AuditActorType,
  type AuditFeature,
  type BranchType,
  type ImportSource,
  type LanguageCode,
  type LanguageMode,
  type MeritType,
  type NavigationPolicy,
  type StudentType,
  type TestUi,
  type TimerTemplate,
  type UnlockMode,
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
  /** The coaching variants. A student and a series both carry the code as free text. */
  PROGRAMS: '/programs',
  IMPORT_STUDENTS: '/students/import',
  /** The question bank. Import and taxonomy sit under it, before the :id route. */
  QUESTIONS: '/questions',
  QUESTION_NEW: '/questions/new',
  IMPORT_QUESTIONS: '/questions/import',
  TAXONOMY: '/questions/taxonomy',
  QUESTION: (id: string) => `/questions/${id}`,
  QUESTION_PATTERN: '/questions/:id',
  /** Tests. A base config is the stage blueprint every test under it inherits its shape from. */
  BASE_CONFIGS: '/tests/configs',
  BASE_CONFIG_NEW: '/tests/configs/new',
  BASE_CONFIG: (id: string) => `/tests/configs/${id}`,
  BASE_CONFIG_PATTERN: '/tests/configs/:id',
  /** The unit of offering: a test reaches a student only through a series. */
  TEST_SERIES: '/tests/series',
  TEST_SERIES_NEW: '/tests/series/new',
  TEST_SERIES_DETAIL: (id: string) => `/tests/series/${id}`,
  TEST_SERIES_PATTERN: '/tests/series/:id',
  /** Super-admin only: who the admins are and who holds what. */
  ADMINS: '/admins',
  PERMISSIONS: '/permissions',
  /** Every admin reaches these — the service, not the route, scopes what they see. */
  AUDIT: '/audit',
  AUDIT_IMPORTS: '/audit/imports',
  /** React Router's catch-all. */
  NOT_FOUND: '*',
} as const;

/** What each student type is called on screen — the enum's own words, cased for reading. */
export const STUDENT_TYPE_LABELS: Readonly<Record<StudentType, string>> = {
  [STUDENT_TYPE.ONLINE]: 'Online',
  [STUDENT_TYPE.OFFLINE]: 'Offline',
  [STUDENT_TYPE.NON_IACE]: 'Non-IACE',
};

/** What each branch type is called on screen. */
export const BRANCH_TYPE_LABELS: Readonly<Record<BranchType, string>> = {
  [BRANCH_TYPE.PHYSICAL]: 'Physical',
  [BRANCH_TYPE.VIRTUAL]: 'Online',
};

/** What an audit row's `feature` is called on screen. */
export const AUDIT_FEATURE_LABELS: Readonly<Record<AuditFeature, string>> = {
  STUDENT: 'Student',
  STUDENT_PROFILE: 'Student profile',
  BRANCH: 'Branch',
  ADMIN: 'Admin',
  QUESTION: 'Question',
  TEST: 'Test',
  TEST_SERIES: 'Test series',
  BASE_CONFIG: 'Base config',
  EXAM_TAXONOMY: 'Exam catalog',
  TAXONOMY_SUBJECT: 'Subject',
  TAXONOMY_TOPIC: 'Topic',
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

/** What a base config's timer template is called on screen — it names what the clock does. */
export const TIMER_TEMPLATE_LABELS: Readonly<Record<TimerTemplate, string>> = {
  COMPOSITE_FREE: 'One clock, move anywhere',
  SECTIONAL_LOCKED: 'A clock per section',
  SESSION_MODULE_LOCKED: 'Sessions of sections',
  PER_ITEM_TIMED: 'A clock per question',
};

export const NAVIGATION_POLICY_LABELS: Readonly<Record<NavigationPolicy, string>> = {
  FREE: 'Move anywhere',
  FORWARD_ONLY: 'Forward only',
};

export const TEST_UI_LABELS: Readonly<Record<TestUi, string>> = {
  CBT: 'CBT',
  OMR: 'OMR sheet',
  GENERIC: 'Generic',
  TYPING: 'Typing',
};

export const LANGUAGE_MODE_LABELS: Readonly<Record<LanguageMode, string>> = {
  SINGLE: 'The student picks one',
  DUAL: 'Both shown together',
};

export const MERIT_TYPE_LABELS: Readonly<Record<MeritType, string>> = {
  MERIT: 'Counts toward merit',
  QUALIFYING: 'Only has to be passed',
};

/** The stored codes (EN/HI/TE), not the lowercase keys inside question content JSON. */
export const LANGUAGE_CODE_LABELS: Readonly<Record<LanguageCode, string>> = {
  EN: 'English',
  HI: 'Hindi',
  TE: 'Telugu',
};

/** How a series opens for a student who can reach it. */
export const UNLOCK_MODE_LABELS: Readonly<Record<UnlockMode, string>> = {
  AUTO: 'Opens on its own',
  REQUEST: 'The student asks',
  ADMIN: 'An admin opens it',
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
      { to: ROUTES.PROGRAMS, label: 'Programs', icon: Route },
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
    label: 'Tests',
    icon: ClipboardList,
    featureKey: FEATURE_KEYS.TEST_MANAGEMENT,
    children: [
      { to: ROUTES.BASE_CONFIGS, label: 'Base configs', icon: SlidersHorizontal },
      { to: ROUTES.TEST_SERIES, label: 'Test series', icon: Layers },
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

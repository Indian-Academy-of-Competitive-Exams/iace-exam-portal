import {
  BookOpen,
  Building2,
  CheckCheck,
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
  type DifficultyLevel,
  type DrawStrategy,
  type EvaluationMode,
  type ExamTemplate,
  type Gender,
  type StudentSeriesSource,
  type ImportSource,
  type LanguageCode,
  type LanguageMode,
  type MeritType,
  type NavigationPolicy,
  type PaperBinding,
  type StudentType,
  type TestBuilderStep,
  type TestScope,
  type TestStatus,
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
  QUESTION_APPROVALS: '/questions/approvals',
  IMPORT_QUESTIONS: '/questions/import',
  TAXONOMY: '/questions/taxonomy',
  QUESTION: (id: string) => `/questions/${id}`,
  QUESTION_PATTERN: '/questions/:id',
  /** Tests. A base config is the stage blueprint every test under it inherits its shape from. */
  BASE_CONFIGS: '/tests/configs',
  BASE_CONFIG_NEW: '/tests/configs/new',
  BASE_CONFIG: (id: string) => `/tests/configs/${id}`,
  BASE_CONFIG_PATTERN: '/tests/configs/:id',
  /** The tests themselves. `configs` and `series` are static, so they outrank the `:id` route. */
  TESTS: '/tests',
  TEST_NEW: '/tests/new',
  TEST: (id: string) => `/tests/${id}`,
  TEST_PATTERN: '/tests/:id',
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

/** What each gender is called on screen; the picker builds itself from GENDERS. */
export const GENDER_LABELS: Readonly<Record<Gender, string>> = {
  MALE: 'Male',
  FEMALE: 'Female',
  OTHER: 'Other',
};

/** What opens a series for a student, in the words an admin would use for it. */
export const SERIES_SOURCE_LABELS: Readonly<Record<StudentSeriesSource, string>> = {
  EXAM: 'Exam enrolment',
  PROGRAM: 'Program',
  GRANT: 'Granted directly',
};

/** AP_TS_POLICE reads as AP/TS POLICE. The underscore is a storage detail. */
export const familyLabel = (family: string) => family.replaceAll('_', '/');

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
  BASE_CONFIG: 'Base configuration',
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

/** The term an exam notification uses. The sentence explaining it belongs in the hint below. */
export const TIMER_TEMPLATE_LABELS: Readonly<Record<TimerTemplate, string>> = {
  COMPOSITE_FREE: 'Composite',
  SECTIONAL_LOCKED: 'Sectional',
  SESSION_MODULE_LOCKED: 'Session-locked',
  PER_ITEM_TIMED: 'Per question',
};

export const TIMER_TEMPLATE_HINTS: Readonly<Record<TimerTemplate, string>> = {
  COMPOSITE_FREE: 'One clock for the whole paper',
  SECTIONAL_LOCKED: 'A clock per section; it locks when its time ends',
  SESSION_MODULE_LOCKED: 'Sessions of sections, each a locked block',
  PER_ITEM_TIMED: 'A countdown per question, moving on at zero',
};

export const NAVIGATION_POLICY_LABELS: Readonly<Record<NavigationPolicy, string>> = {
  FREE: 'Free',
  FORWARD_ONLY: 'Forward only',
};

export const NAVIGATION_POLICY_HINTS: Readonly<Record<NavigationPolicy, string>> = {
  FREE: 'Move between questions in any order',
  FORWARD_ONLY: 'No returning to a question once left',
};

export const TEST_UI_LABELS: Readonly<Record<TestUi, string>> = {
  CBT: 'CBT',
  OMR: 'OMR sheet',
  GENERIC: 'Generic',
  TYPING: 'Typing',
};

export const EXAM_TEMPLATE_LABELS: Readonly<Record<ExamTemplate, string>> = {
  COMFORTABLE: 'Comfortable',
  STRICT: 'Strict',
};

export const EXAM_TEMPLATE_HINTS: Readonly<Record<ExamTemplate, string>> = {
  COMFORTABLE: 'Roomier spacing and larger targets',
  STRICT: 'Dense and austere, like the government CBT',
};

export const LANGUAGE_MODE_LABELS: Readonly<Record<LanguageMode, string>> = {
  SINGLE: 'Single language',
  DUAL: 'Bilingual',
};

export const LANGUAGE_MODE_HINTS: Readonly<Record<LanguageMode, string>> = {
  SINGLE: 'The student picks one at the start',
  DUAL: 'Both languages on screen together',
};

export const MERIT_TYPE_LABELS: Readonly<Record<MeritType, string>> = {
  MERIT: 'Merit',
  QUALIFYING: 'Qualifying',
};

export const MERIT_TYPE_HINTS: Readonly<Record<MeritType, string>> = {
  MERIT: 'Counts toward the total score',
  QUALIFYING: 'Must be passed; adds nothing to merit',
};

/** The stored codes (EN/HI/TE), not the lowercase keys inside question content JSON. */
export const LANGUAGE_CODE_LABELS: Readonly<Record<LanguageCode, string>> = {
  EN: 'English',
  HI: 'Hindi',
  TE: 'Telugu',
};

/** What a test covers. Everything else about its shape comes from its base configuration. */
export const TEST_SCOPE_LABELS: Readonly<Record<TestScope, string>> = {
  FULL: 'Full paper',
  MODULE: 'Module',
  SECTIONAL: 'Sectional',
  TOPIC: 'Topic',
};

export const EVALUATION_MODE_LABELS: Readonly<Record<EvaluationMode, string>> = {
  RANKED: 'Ranked',
  PRACTICE: 'Practice',
};

export const EVALUATION_MODE_HINTS: Readonly<Record<EvaluationMode, string>> = {
  RANKED: 'Scored against the cohort, with a rank and percentile',
  PRACTICE: 'Scored, never ranked',
};

export const PAPER_BINDING_LABELS: Readonly<Record<PaperBinding, string>> = {
  FIXED: 'Fixed',
  GENERATED: 'Generated',
};

export const PAPER_BINDING_HINTS: Readonly<Record<PaperBinding, string>> = {
  FIXED: 'Picked by hand and frozen when it is offered; every student sits it',
  GENERATED: 'Drawn again for each student when their attempt starts',
};

export const DIFFICULTY_LABELS: Readonly<Record<DifficultyLevel, string>> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

export const DRAW_STRATEGY_LABELS: Readonly<Record<DrawStrategy, string>> = {
  RANDOM: 'Random',
  NEWEST_FIRST: 'Newest first',
  LEAST_SERVED: 'Least served',
  UNSEEN_FIRST: 'Unseen first',
};

export const DRAW_STRATEGY_HINTS: Readonly<Record<DrawStrategy, string>> = {
  RANDOM: 'Any question in the pool, with equal chance',
  NEWEST_FIRST: 'The most recently added questions',
  LEAST_SERVED: 'The questions used in the fewest papers so far',
  UNSEEN_FIRST: 'Questions the student has not met before',
};

/** The phases of building a test. The order is the contract's; these are only the words. */
export const TEST_BUILDER_STEP_LABELS: Readonly<Record<TestBuilderStep, string>> = {
  SETUP: 'Setup',
  PAPER: 'Paper',
  OFFER: 'Offer',
};

export const TEST_STATUS_LABELS: Readonly<Record<TestStatus, string>> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  INACTIVE: 'Retired',
};

/** How a series opens for a student who can reach it. */
export const UNLOCK_MODE_LABELS: Readonly<Record<UnlockMode, string>> = {
  AUTO: 'Automatic',
  REQUEST: 'On request',
  ADMIN: 'Admin released',
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
      { to: ROUTES.QUESTION_APPROVALS, label: 'Draft questions', icon: CheckCheck },
      { to: ROUTES.IMPORT_QUESTIONS, label: 'Import questions', icon: Upload },
      { to: ROUTES.TAXONOMY, label: 'Subjects and topics', icon: FolderTree },
    ],
  },
  {
    label: 'Tests',
    icon: ClipboardList,
    featureKey: FEATURE_KEYS.TEST_MANAGEMENT,
    children: [
      { to: ROUTES.TESTS, label: 'All tests', icon: ClipboardList },
      { to: ROUTES.BASE_CONFIGS, label: 'Base configurations', icon: SlidersHorizontal },
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

const ADMIN = 'admin';

/** Every query key this app owns; a raw key that drifts by a character fails silently at invalidation. */
export const QUERY_KEYS = {
  ADMINS: [ADMIN, 'admins'],
  AUDIT: [ADMIN, 'audit'],
  BASE_CONFIG: [ADMIN, 'base-config'],
  BASE_CONFIGS: [ADMIN, 'base-configs'],
  BRANCH_TIMING: [ADMIN, 'branch-timing'],
  BRANCHES: [ADMIN, 'branches'],
  EXAM_STAGES: [ADMIN, 'exam-stages'],
  EXAMS: [ADMIN, 'exams'],
  FEATURES: [ADMIN, 'features'],
  ME: ['auth', 'me'],
  PROGRAMS: [ADMIN, 'programs'],
  QUESTION: [ADMIN, 'question'],
  QUESTIONS: [ADMIN, 'questions'],
  STUDENT: [ADMIN, 'student'],
  STUDENTS: [ADMIN, 'students'],
  SUBJECTS: [ADMIN, 'subjects'],
  TEST: [ADMIN, 'test'],
  TEST_PAPER: [ADMIN, 'test-paper'],
  TEST_SERIES: [ADMIN, 'test-series'],
  TEST_SERIES_LINKS: [ADMIN, 'test-series-links'],
  TESTS: [ADMIN, 'tests'],
  TOPICS: [ADMIN, 'topics'],
} as const;

/** Segments that qualify a key, shared because a picker and the list it feeds must agree. */
export const QUERY_SCOPES = {
  NAMED: 'named',
  PICKER: 'picker',
} as const;

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

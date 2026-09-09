import {
  BookOpen,
  Building2,
  PenLine,
  CheckCheck,
  ClipboardList,
  FolderTree,
  GraduationCap,
  History,
  Megaphone,
  KeyRound,
  Layers,
  Radar,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Users,
} from 'lucide-react';
import { filterNavBy, type NavItem } from '@iace/app-kit';
import {
  type AttemptStatus,
  type AuditAction,
  type AuditActorType,
  type AuditFeature,
  BRANCH_TYPE,
  type BranchType,
  type DifficultyLevel,
  type EvaluationMode,
  type ExamTemplate,
  FEATURE_KEYS,
  type Gender,
  type ImportSource,
  type LanguageCode,
  type LanguageMode,
  type MeritType,
  type AnswerMode,
  type NavigationPolicy,
  type PaperBinding,
  type QuestionStatus,
  type QuestionType,
  PERFORMANCE_SCOPES,
  type PerformanceScope,
  STUDENT_TYPE,
  type StudentSeriesSource,
  type StudentType,
  type TestBuilderStep,
  type TestSeriesKind,
  type TestStatus,
  type TestUi,
  type TimerTemplate,
} from '@iace/contracts';

/** App-level string vocabularies. Cross-app ones live in `@iace/contracts`. */

/** Route paths. Referenced by the router, the guards and every navigate(). */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  STUDENTS: '/students',
  STUDENT: (id: string) => `/students/${id}`,
  STUDENT_PATTERN: '/students/:id',
  STUDENT_PERFORMANCE: (id: string) => `/students/${id}/performance`,
  STUDENT_PERFORMANCE_PATTERN: '/students/:id/performance',
  BRANCHES: '/branches',
  EXAMS: '/exams',
  IMPORT_STUDENTS: '/students/import',
  /** The question bank. Import and taxonomy sit under it, before the :id route. */
  QUESTIONS: '/questions',
  QUESTION_NEW: '/questions/new',
  QUESTION_APPROVALS: '/questions/approvals',
  IMPORT_QUESTIONS: '/questions/import',
  TAXONOMY: '/questions/taxonomy',
  QUESTION: (id: string) => `/questions/${id}`,
  QUESTION_PATTERN: '/questions/:id',
  /** Authoring: one box for typing questions, and the author's own record of what they typed. */
  AUTHORING_EDITOR: '/authoring',
  AUTHORING_QUESTION: (id: string) => `/authoring/${id}`,
  AUTHORING_EDITOR_PATTERN: '/authoring/:id',
  AUTHORING_HISTORY: '/authoring/history',
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
  /** The paper on its own screen: the extra segment outranks `/tests/:id`. */
  TEST_PAPER: (id: string) => `/tests/${id}/paper`,
  TEST_PAPER_PATTERN: '/tests/:id/paper',
  /** How the cohort did on it, off the rollups. Same shape of segment as the paper. */
  TEST_ANALYTICS: (id: string) => `/tests/${id}/analytics`,
  TEST_ANALYTICS_PATTERN: '/tests/:id/analytics',
  /** The unit of offering: a test reaches a student only through a series. */
  TEST_SERIES_NEW: '/tests/series/new',
  TEST_SERIES_DETAIL: (id: string) => `/tests/series/${id}`,
  TEST_SERIES_PATTERN: '/tests/series/:id',
  /** Programs and events on one screen: both are how a series reaches a cohort. */
  COHORTS: '/cohorts',
  EVENT_IMPORT: (id: string) => `/cohorts/events/${id}/import`,
  EVENT_IMPORT_PATTERN: '/cohorts/events/:id/import',
  /** Addressed by the CODE a student carries, which is what the sheet enrols them into. */
  PROGRAM_IMPORT: (code: string) => `/cohorts/programs/${encodeURIComponent(code)}/import`,
  PROGRAM_IMPORT_PATTERN: '/cohorts/programs/:code/import',
  /** Super-admin only: who the admins are and who holds what. */
  ADMINS: '/admins',
  PERMISSIONS: '/permissions',
  /** Watching a test's sittings while they run, and resolving the ones that broke. */
  LIVE_OPS: '/live-ops',
  /** Every admin reaches these — the service, not the route, scopes what they see. */
  ANNOUNCEMENTS: '/announcements',
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

/** What each kind of question is called on screen. */
export const QUESTION_TYPE_LABELS: Readonly<Record<QuestionType, string>> = {
  SINGLE_MCQ: 'Multiple choice',
  TEXT_FIELD: 'Typed answer',
};

/** What a question's state is called on screen. */
export const QUESTION_STATUS_LABELS: Readonly<Record<QuestionStatus, string>> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

/** Live reads as live; waiting and retired both read as quiet. */
export const QUESTION_STATUS_VARIANT: Readonly<Record<QuestionStatus, 'neutral' | 'success'>> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  ARCHIVED: 'neutral',
};

/** Harder reads as more urgent, so a page of them scans by colour. */
export const DIFFICULTY_VARIANT: Readonly<Record<DifficultyLevel, 'success' | 'info' | 'warning'>> =
  {
    LOW: 'success',
    MEDIUM: 'info',
    HIGH: 'warning',
  };

/** How a typed answer is compared. */
export const ANSWER_MODE_LABELS: Readonly<Record<AnswerMode, string>> = {
  EXACT: 'Exact text',
  NUMERIC: 'Numeric',
};

/** What each kind of series is called on screen. */
export const TEST_SERIES_KIND_LABELS: Readonly<Record<TestSeriesKind, string>> = {
  STANDARD: 'Standard',
  FREE: 'Free',
  PROGRAM: 'Program',
  EVENT: 'Event',
};

/** Who each kind reaches, which the name alone does not say. */
export const TEST_SERIES_KIND_HINTS: Readonly<Record<TestSeriesKind, string>> = {
  STANDARD: "Reached by an enrolment in its stage's exam course, at a branch that runs it",
  FREE: 'Reached by every student',
  PROGRAM: 'Reached only by students carrying its program',
  EVENT: 'Reached only by the candidates on its event',
};

/** What opens a series for a student, in the words an admin would use for it. */
export const SERIES_SOURCE_LABELS: Readonly<Record<StudentSeriesSource, string>> = {
  COURSE: 'Course, at this branch',
  PROGRAM: 'Program',
  FREE: 'Free to everyone',
  EVENT: 'Event candidate',
  GRANT: 'Granted directly',
};

/** AP_TS_POLICE reads as AP/TS POLICE. The underscore is a storage detail. */
export const courseLabel = (course: string) => course.replaceAll('_', '/');

/** What each branch type is called on screen. */
export const BRANCH_TYPE_LABELS: Readonly<Record<BranchType, string>> = {
  [BRANCH_TYPE.PHYSICAL]: 'Physical',
  [BRANCH_TYPE.VIRTUAL]: 'Online',
};

/** What a sitting's state is called on screen. VOIDED is an admin's own doing, so it is named. */
export const ATTEMPT_STATUS_LABELS: Readonly<Record<AttemptStatus, string>> = {
  IN_PROGRESS: 'In progress',
  SUBMITTED: 'Submitted',
  EVALUATED: 'Marked',
  EXPIRED: 'Expired',
  VOIDED: 'Void',
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
  BRANCH_TEST_CONFIG: 'Branch series',
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
  DEFAULT: 'Default',
  SSC_RAILWAYS: 'SSC/Railways',
};

export const EXAM_TEMPLATE_HINTS: Readonly<Record<ExamTemplate, string>> = {
  DEFAULT: 'Roomier spacing and larger targets',
  SSC_RAILWAYS: 'Dense, with the timer in the section bar and the palette on the left',
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
  GENERATED: 'Several papers drawn when it is offered; each student is dealt one',
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

/**
 * A NavItem plus `superAdminOnly`, which is NOT a feature key and must never become one:
 * the screens it gates are the ones that decide who decides.
 */
/** Which list the cohorts screen is showing. Absent from the URL means Programs. */
export const COHORT_TABS = {
  PROGRAMS: 'programs',
  EVENTS: 'events',
} as const;
export type CohortTab = (typeof COHORT_TABS)[keyof typeof COHORT_TABS];

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
      { to: ROUTES.BRANCHES, label: 'Branches', icon: Building2 },
      { to: ROUTES.EXAMS, label: 'Exams', icon: GraduationCap },
      { to: ROUTES.COHORTS, label: 'Programs and events', icon: Route },
    ],
  },
  {
    label: 'Question bank',
    icon: BookOpen,
    featureKey: FEATURE_KEYS.QUESTION_MANAGEMENT,
    children: [
      { to: ROUTES.QUESTIONS, label: 'All questions', icon: BookOpen },
      { to: ROUTES.QUESTION_APPROVALS, label: 'Draft questions', icon: CheckCheck },
      { to: ROUTES.TAXONOMY, label: 'Subjects and topics', icon: FolderTree },
    ],
  },
  /** Its own section, on a key of its own: a typist gets this and not the bank above it. */
  {
    label: 'Authoring',
    icon: PenLine,
    featureKey: FEATURE_KEYS.QUESTION_AUTHORING,
    children: [
      { to: ROUTES.AUTHORING_EDITOR, label: 'Editor', icon: PenLine },
      { to: ROUTES.AUTHORING_HISTORY, label: 'History', icon: History },
    ],
  },
  {
    label: 'Tests',
    icon: ClipboardList,
    featureKey: FEATURE_KEYS.TEST_MANAGEMENT,
    children: [
      { to: ROUTES.TESTS, label: 'Tests & Test Series', icon: Layers },
      { to: ROUTES.BASE_CONFIGS, label: 'Base configurations', icon: SlidersHorizontal },
    ],
  },
  {
    label: 'Live operations',
    icon: Radar,
    featureKey: FEATURE_KEYS.TEST_OPERATIONS,
    children: [{ to: ROUTES.LIVE_OPS, label: 'Sittings', icon: Radar }],
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
  {
    label: 'Announcements',
    icon: Megaphone,
    featureKey: FEATURE_KEYS.NOTIFICATION_MANAGEMENT,
    children: [{ to: ROUTES.ANNOUNCEMENTS, label: 'Sent', icon: Megaphone }],
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

/** Strips `superAdminOnly`. `featureKey` is the shell's job, and every other key is a peer. */
export function filterAdminNav(
  items: readonly AdminNavItem[],
  viewer: { isSuperAdmin: boolean },
): AdminNavItem[] {
  return filterNavBy(items, (item) => Boolean(item.superAdminOnly) && !viewer.isSuperAdmin);
}

const ADMIN = 'admin';

/** Every query key this app owns; a raw key that drifts by a character fails silently at invalidation. */
export const QUERY_KEYS = {
  ADMINS: [ADMIN, 'admins'],
  AUTHORING: [ADMIN, 'authoring'],
  ANNOUNCEMENTS: [ADMIN, 'announcements'],
  AUDIT: [ADMIN, 'audit'],
  BASE_CONFIG: [ADMIN, 'base-config'],
  BASE_CONFIGS: [ADMIN, 'base-configs'],
  BRANCHES: [ADMIN, 'branches'],
  EVENTS: [ADMIN, 'events'],
  EXAM_STAGES: [ADMIN, 'exam-stages'],
  EXAMS: [ADMIN, 'exams'],
  FEATURES: [ADMIN, 'features'],
  LIVE_OPS: [ADMIN, 'live-ops'],
  ME: ['auth', 'me'],
  PROGRAMS: [ADMIN, 'programs'],
  QUESTION: [ADMIN, 'question'],
  QUESTIONS: [ADMIN, 'questions'],
  STUDENT: [ADMIN, 'student'],
  STUDENTS: [ADMIN, 'students'],
  SUBJECTS: [ADMIN, 'subjects'],
  TEST: [ADMIN, 'test'],
  TEST_ANALYTICS: [ADMIN, 'test-analytics'],
  TEST_PAPER: [ADMIN, 'test-paper'],
  TEST_SERIES: [ADMIN, 'test-series'],
  TEST_SERIES_LINKS: [ADMIN, 'test-series-links'],
  TESTS: [ADMIN, 'tests'],
  TOPICS: [ADMIN, 'topics'],
} as const;

/** The two a named student's report can be asked about here: this app offers no series picker. */
export const PERFORMANCE_SCOPE_LABELS: Readonly<Record<string, string>> = {
  [PERFORMANCE_SCOPES.ATTEMPT]: 'This sitting',
  [PERFORMANCE_SCOPES.ALL_TIME]: 'All time',
};

/** One student's share links, and the sittings the picker offers — both cards read the one row set. */
export const studentSharesQueryKey = (studentId: string) =>
  [...QUERY_KEYS.STUDENT, studentId, 'shares'] as const;

/** Keyed by what the report is OF, so switching sitting or scope never reads a stale one. */
export const studentReportQueryKey = (
  studentId: string,
  scope: PerformanceScope,
  scopeId: string,
) => [...QUERY_KEYS.STUDENT, studentId, 'performance', scope, scopeId] as const;

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
  /** The question in the box right now. A closed tab loses nothing; only a save writes a row. */
  AUTHORING_DRAFT: 'iace.admin.authoring',
} as const;

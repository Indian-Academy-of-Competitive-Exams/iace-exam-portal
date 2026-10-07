import {
  BookOpen,
  Building2,
  PenLine,
  ClipboardList,
  FileChartColumn,
  FolderTree,
  GraduationCap,
  History,
  ListChecks,
  Megaphone,
  KeyRound,
  Layers,
  Radar,
  Route,
  ShieldCheck,
  SpellCheck,
  SlidersHorizontal,
  Upload,
  Users,
} from 'lucide-react';
import { filterNavBy, type NavItem } from '@iace/app-kit';
import {
  type AdminRole,
  type AnnouncementAudience,
  type AssignmentRole,
  type AttemptStatus,
  type AuditAction,
  type AuditActorType,
  type AuditFeature,
  BRANCH_TYPE,
  type BranchType,
  courseLabel,
  type DifficultyLevel,
  EXAM_COURSES,
  type ExamTemplate,
  FEATURE_KEYS,
  type FeatureKey,
  type Gender,
  type ImportSource,
  type LanguageCode,
  type LanguageMode,
  type MeritType,
  type AnswerMode,
  type NavigationPolicy,
  type QuestionStatus,
  type QuestionType,
  PERFORMANCE_SCOPES,
  PERMISSION_LEVELS,
  type PermissionLevel,
  REPORT_GROUPS,
  REPORT_KEYS,
  REPORT_PARAMS,
  REPORT_PERIODS,
  type ReportChoiceParam,
  type ReportGroup,
  type ReportKey,
  type ReportParam,
  type ReportPeriod,
  type ReportQueryInput,
  type PerformanceScope,
  STUDENT_TYPE,
  type StudentSeriesSource,
  type StudentType,
  type TestBuilderStep,
  type TestSeriesKind,
  type TestStatus,
  type TestUi,
  type TimerTemplate,
  REVIEW_STATES,
  SEND_BACK_REASONS,
  type ReviewState,
  type SendBackReason,
} from '@iace/contracts';

/** App-level string vocabularies. Cross-app ones live in `@iace/contracts`. */

/** The question a section page opens on. */
export const SECTION_QUESTION_PARAM = 'q';

/** Route paths. Referenced by the router, the guards and every navigate(). */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  STUDENTS: '/students',
  STUDENT: (id: string) => `/students/${id}`,
  STUDENT_PATTERN: '/students/:id',
  STUDENT_PERFORMANCE_PATTERN: '/students/:id/performance',
  BRANCHES: '/branches',
  EXAMS: '/exams',
  IMPORT_STUDENTS: '/students/import',
  /** The question bank. Import and taxonomy sit under it, before the :id route. */
  QUESTIONS: '/questions',
  QUESTION_NEW: '/questions/new',
  /** The reader's own queue; the typist's is AUTHORING_ASSIGNMENTS. */
  PROOFREADING_ASSIGNMENTS: '/proofreading/assignments',
  /** One section's authoring page, entered as its typist, its reader or the test's owner. */
  TYPING_SECTION: (testId: string, sectionId: string) =>
    `/authoring/assignments/tests/${testId}/sections/${sectionId}`,
  TYPING_SECTION_PATTERN: '/authoring/assignments/tests/:testId/sections/:sectionId',
  TYPING_SECTION_QUESTION: (testId: string, sectionId: string, questionId: string) =>
    `/authoring/assignments/tests/${testId}/sections/${sectionId}?${SECTION_QUESTION_PARAM}=${encodeURIComponent(questionId)}`,
  READING_SECTION: (testId: string, sectionId: string) =>
    `/proofreading/assignments/tests/${testId}/sections/${sectionId}`,
  READING_SECTION_PATTERN: '/proofreading/assignments/tests/:testId/sections/:sectionId',
  TEST_SECTION: (testId: string, sectionId: string) => `/tests/${testId}/sections/${sectionId}`,
  TEST_SECTION_PATTERN: '/tests/:testId/sections/:sectionId',
  SECTION_PROGRESS: '/tests/section-progress',
  IMPORT_QUESTIONS: '/questions/import',
  TAXONOMY: '/questions/taxonomy',
  QUESTION: (id: string) => `/questions/${id}`,
  QUESTION_PATTERN: '/questions/:id',
  QUESTION_EDIT: (id: string) => `/questions/${id}/edit`,
  QUESTION_EDIT_PATTERN: '/questions/:id/edit',
  /** Authoring: one box for typing questions, and the author's own record of what they typed. */
  AUTHORING_EDITOR: '/authoring',
  AUTHORING_QUESTION: (id: string) => `/authoring/${id}`,
  AUTHORING_EDITOR_PATTERN: '/authoring/:id',
  AUTHORING_HISTORY: '/authoring/history',
  /** The typist's own queue, and the editor under it — nested, so the rail marks the row it came from. */
  AUTHORING_ASSIGNMENTS: '/authoring/assignments',
  /** A sheet of questions straight into the section it was written for. */
  AUTHORING_IMPORT: (testId: string, sectionId: string) =>
    `/authoring/assignments/tests/${testId}/sections/${sectionId}/import`,
  AUTHORING_IMPORT_PATTERN: '/authoring/assignments/tests/:testId/sections/:sectionId/import',
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
  /** The paper in full, as a hall is handed it. The extra segment outranks the paper's own screen. */
  TEST_PAPER_PRINT: (id: string) => `/tests/${id}/paper/print`,
  TEST_PAPER_PRINT_PATTERN: '/tests/:id/paper/print',
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
  /** The catalogue, and one report under it: the key is the catalogue's own. */
  REPORTS: '/reports',
  REPORT: (key: ReportKey) => `/reports/${key}`,
  REPORT_PATTERN: '/reports/:key',
  ANNOUNCEMENTS: '/announcements',
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

/** What each kind of question is called on screen. */
export const QUESTION_TYPE_LABELS: Readonly<Record<QuestionType, string>> = {
  SINGLE_MCQ: 'Multiple choice',
  TEXT_FIELD: 'Typed answer',
};

/** Every exam course as a choice, written the way the institute says it. */
export const COURSE_ITEMS = EXAM_COURSES.map((course) => ({
  value: course,
  label: courseLabel(course),
}));

/** What a question's state is called on screen. */
export const QUESTION_STATUS_LABELS: Readonly<Record<QuestionStatus, string>> = {
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
};

/** Live reads as live; retired reads as quiet. */
export const QUESTION_STATUS_VARIANT: Readonly<Record<QuestionStatus, 'neutral' | 'success'>> = {
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
  PROGRAM: 'Program',
  EVENT: 'Event',
  ANNOUNCEMENT: 'Announcement',
  AUDIT_LOG: 'Audit log',
  REPORT: 'Report',
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
  EXPORT: 'Exported',
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
  SSC_RAILWAYS: 'Dense, with the timer in the section bar and the palette on the right',
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

/** The phases of building a test. The order is the contract's; these are only the words. */
export const TEST_BUILDER_STEP_LABELS: Readonly<Record<TestBuilderStep, string>> = {
  SETUP: 'Setup',
  PAPER: 'Paper',
  OFFER: 'Offer',
};

/** Who staffs a section. Written out — never "PR" for a proof-reader. */
const IS_MAC = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');

/** A Mac prints Cmd and Option where every other keyboard prints Ctrl and Alt; the editor answers to both. */
export const KEY_NAMES = { MOD: IS_MAC ? 'Cmd' : 'Ctrl', ALT: IS_MAC ? 'Option' : 'Alt' } as const;

/** Why a question went back to its typist, in the words the reader picks it by. */
export const SEND_BACK_REASON_LABELS: Readonly<Record<SendBackReason, string>> = {
  [SEND_BACK_REASONS.SPELLING]: 'Spelling mistakes',
  [SEND_BACK_REASONS.DATA_CORRECTION]: 'Data correction',
  [SEND_BACK_REASONS.ANSWER_OPTION]: 'No suitable option as answer',
};

export const REVIEW_STATE_LABELS: Readonly<Record<ReviewState, string>> = {
  [REVIEW_STATES.UNCHECKED]: 'Not checked',
  [REVIEW_STATES.CHECKED]: 'Checked',
  [REVIEW_STATES.SENT_BACK]: 'Sent back',
  [REVIEW_STATES.FIXED]: 'Fixed',
};

export const ASSIGNMENT_ROLE_LABELS: Readonly<Record<AssignmentRole, string>> = {
  TYPIST: 'Typist',
  PROOFREADER: 'Proof-reader',
};

/** What an admin is called. A label, not a permission — the feature keys decide what they reach. */
export const ADMIN_ROLE_LABELS: Readonly<Record<AdminRole, string>> = {
  TYPIST: 'Typist',
  PROOFREADER: 'Proof-reader',
  ADMIN: 'Admin',
  SUPER_ADMIN: 'Super admin',
};

export const TEST_STATUS_LABELS: Readonly<Record<TestStatus, string>> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
};

// AdminNavItem adds superAdminOnly, which is NOT a feature key — it gates the screens that decide who decides.
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
      { to: ROUTES.TAXONOMY, label: 'Subjects and topics', icon: FolderTree },
    ],
  },
  /** Its own section, on a key of its own: a reader holds sections, never the bank. */
  {
    label: 'Proof-reading',
    icon: SpellCheck,
    featureKey: FEATURE_KEYS.QUESTION_PROOFREAD,
    children: [{ to: ROUTES.PROOFREADING_ASSIGNMENTS, label: 'My sections', icon: ListChecks }],
  },
  /** Its own section, on a key of its own: a typist gets this and not the bank above it. */
  {
    label: 'Authoring',
    icon: PenLine,
    featureKey: FEATURE_KEYS.QUESTION_AUTHORING,
    children: [
      { to: ROUTES.AUTHORING_EDITOR, label: 'Editor', icon: PenLine },
      { to: ROUTES.AUTHORING_ASSIGNMENTS, label: 'My sections', icon: ListChecks },
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
      {
        to: ROUTES.SECTION_PROGRESS,
        label: 'Section progress',
        icon: ListChecks,
        superAdminOnly: true,
      },
    ],
  },
  {
    label: 'Live operations',
    icon: Radar,
    featureKey: FEATURE_KEYS.TEST_OPERATIONS,
    children: [{ to: ROUTES.LIVE_OPS, label: 'Sittings', icon: Radar }],
  },
  {
    label: 'Reports',
    icon: FileChartColumn,
    featureKey: FEATURE_KEYS.REPORTS,
    children: [{ to: ROUTES.REPORTS, label: 'All reports', icon: FileChartColumn }],
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

/** What each group of reports is called on its tab. */
export const REPORT_GROUP_LABELS: Readonly<Record<ReportGroup, string>> = {
  [REPORT_GROUPS.INSTITUTE]: 'Institute',
  [REPORT_GROUPS.TESTS]: 'Tests',
  [REPORT_GROUPS.STUDENTS]: 'Students',
  [REPORT_GROUPS.PERFORMANCE]: 'Performance',
  [REPORT_GROUPS.ENROLMENT]: 'Enrolment',
  [REPORT_GROUPS.CONTENT]: 'Content',
  [REPORT_GROUPS.OPERATIONS]: 'Operations',
};

/** What each report holds, on its catalogue card: its content, since a title alone does not say. */
export const REPORT_SUMMARIES: Readonly<Record<ReportKey, string>> = {
  [REPORT_KEYS.TEST_RESULTS]: 'Every sitting with rank, percentile, marks and each section’s score',
  [REPORT_KEYS.TEST_SUMMARY]:
    'Mean, median, highest and lowest, with the score spread and sections',
  [REPORT_KEYS.TEST_SECTIONS]: 'Each section’s maximum, attempts, average score and average time',
  [REPORT_KEYS.TEST_ITEMS]: 'Each question’s right, wrong and blank counts, time and share correct',
  [REPORT_KEYS.TEST_ABSENTEES]: 'Students the test reached who have not sat it',
  [REPORT_KEYS.TEST_MERIT]:
    'The top ranks by score, time and percentile, with each branch’s topper',
  [REPORT_KEYS.TEST_BRANCHES]:
    'Each branch’s participation, mean score, highest and mean percentile',
  [REPORT_KEYS.TEST_CUTOFFS]:
    'Each student against every qualifying section’s cutoff, and the result',
  [REPORT_KEYS.TEST_VOIDED]: 'Sittings struck off the ranking, with when, why and by whom',
  [REPORT_KEYS.TEST_ANSWER_KEY]: 'Every question with its answer, marks and negative marks',
  [REPORT_KEYS.TEST_ACTIVITY_WEEKLY]:
    'Tests opened in the week, sittings on each, and the week before',
  [REPORT_KEYS.TEST_ACTIVITY_MONTHLY]:
    'Tests opened in the month, sittings on each, and the month before',
  [REPORT_KEYS.SERIES_PROGRESS]:
    'Each test of a series, and each student’s tests sat and percentile',
  [REPORT_KEYS.TEST_SCHEDULE]: 'Tests opening in the period, and the students each one reaches',
  [REPORT_KEYS.PARTICIPATION_TREND]: 'Day by day: ranked sittings, students and tests sat',
  [REPORT_KEYS.STUDENT_SCORE_CARD]:
    'One sitting: marks, rank, percentile and each section against the cohort',
  [REPORT_KEYS.STUDENT_WEEKLY]:
    'One student’s week: each sitting, percentile, accuracy and subjects',
  [REPORT_KEYS.STUDENT_MONTHLY]:
    'One student’s month: each sitting, percentile, accuracy and subjects',
  [REPORT_KEYS.STUDENT_CUMULATIVE]:
    'Every sitting a student has had, with accuracy and pace by subject',
  [REPORT_KEYS.STUDENT_PARENT_LETTER]:
    'A period’s sittings and subjects, set as a letter to the parent',
  [REPORT_KEYS.STUDENT_TOPICS]: 'A student’s accuracy and pace on every topic met',
  [REPORT_KEYS.STUDENT_MISSED]: 'Open tests a student could have sat and did not',
  [REPORT_KEYS.PERFORMANCE_BY_BRANCH]:
    'Each branch’s participation, average percentile and accuracy',
  [REPORT_KEYS.PERFORMANCE_BY_PROGRAM]:
    'Each program’s participation, average percentile and accuracy',
  [REPORT_KEYS.PERFORMANCE_BY_EXAM]: 'Each exam’s participation, average percentile and accuracy',
  [REPORT_KEYS.TOP_PERFORMERS]: 'Students placed by average percentile over the period',
  [REPORT_KEYS.MOST_IMPROVED]:
    'Average percentile against the period before: most risen, most fallen',
  [REPORT_KEYS.WEAK_SUBJECTS]: 'Each subject’s accuracy across every ranked sitting',
  [REPORT_KEYS.WEAK_TOPICS]: 'Each topic’s right, wrong and blank counts and share correct',
  [REPORT_KEYS.ABSENTEES]: 'Students who missed tests opened in the period, and how many',
  [REPORT_KEYS.INACTIVE_STUDENTS]:
    'Students with no sitting in a set number of days, and their last',
  [REPORT_KEYS.RETAKES]: 'Students who sat a test again, and how many times',
  [REPORT_KEYS.STUDENT_ROSTER]: 'Every student with type, courses, exams, programs and status',
  [REPORT_KEYS.NEW_ENROLMENTS]: 'Students added in the period, counted by branch and listed',
  [REPORT_KEYS.STRENGTH]: 'Headcount by branch, course, exam and program',
  [REPORT_KEYS.PROFILE_COMPLETENESS]:
    'Students with an unfinished profile, and what each is missing',
  [REPORT_KEYS.STUDENT_STATUS]: 'Students suspended, blocked from tests or deleted, and by whom',
  [REPORT_KEYS.MANUAL_GRANTS]: 'Series access given to a student by hand, and who gave it',
  [REPORT_KEYS.EVENT_CANDIDATES]: 'An event’s candidates, and how many of its tests each has sat',
  [REPORT_KEYS.MOBILE_CHANGES]: 'Mobile numbers changed in the period: old, new and by whom',
  [REPORT_KEYS.AUTHORING_PROGRESS]:
    'Each section of a test: questions typed against needed, and who holds it',
  [REPORT_KEYS.OVERDUE_ASSIGNMENTS]: 'Sections past their due date, who holds each and days late',
  [REPORT_KEYS.STAFF_OUTPUT]: 'Each admin’s questions typed, sections read, checked and sent back',
  [REPORT_KEYS.SEND_BACKS]: 'Questions sent back to each typist, and how many were fixed',
  [REPORT_KEYS.BANK_INVENTORY]: 'Active and archived questions, by subject and by topic',
  [REPORT_KEYS.QUESTION_USAGE]: 'Questions used on a paper against never used, and the most used',
  [REPORT_KEYS.AUDIT_TRAIL]: 'Every recorded change in the period: who, what and when',
  [REPORT_KEYS.ADMIN_ACTIVITY]: 'Each admin’s recorded changes in the period, counted by action',
  [REPORT_KEYS.ANNOUNCEMENTS]: 'Announcements sent, their recipients, channels and estimated cost',
  [REPORT_KEYS.PERMISSIONS_MATRIX]: 'Every admin with status and level on each feature',
  [REPORT_KEYS.DIGEST_WEEKLY]: 'The week on one page: tests, participation, enrolment and toppers',
  [REPORT_KEYS.DIGEST_MONTHLY]:
    'The month on one page: tests, participation, enrolment and toppers',
};

/** The periods a report's bar offers by name. */
export const REPORT_PERIOD_LABELS: Readonly<Record<ReportPeriod, string>> = {
  [REPORT_PERIODS.THIS_WEEK]: 'This week',
  [REPORT_PERIODS.LAST_WEEK]: 'Last week',
  [REPORT_PERIODS.THIS_MONTH]: 'This month',
  [REPORT_PERIODS.LAST_MONTH]: 'Last month',
};

/** What a report is asked for by, as the catalogue names it. */
export const REPORT_PARAM_LABELS: Readonly<Record<ReportParam, string>> = {
  [REPORT_PARAMS.TEST]: 'Test',
  [REPORT_PARAMS.STUDENT]: 'Student',
  [REPORT_PARAMS.ATTEMPT]: 'Sitting',
  [REPORT_PARAMS.SERIES]: 'Series',
  [REPORT_PARAMS.EVENT]: 'Event',
  [REPORT_PARAMS.BRANCH]: 'Branch',
  [REPORT_PARAMS.PERIOD]: 'Period',
  [REPORT_PARAMS.TOP]: 'Rows',
  [REPORT_PARAMS.DAYS]: 'Days',
};

/** What a screen's own requests need: any one of `keys` at `level`, as the API's guards read them. */
export interface RouteAccess {
  keys: readonly FeatureKey[];
  level: PermissionLevel;
}

type Can = (key: FeatureKey, level: PermissionLevel) => boolean;

const reads = (...keys: FeatureKey[]): RouteAccess => ({ keys, level: PERMISSION_LEVELS.READ });
const writes = (...keys: FeatureKey[]): RouteAccess => ({ keys, level: PERMISSION_LEVELS.WRITE });

/** Either half of the section work shares one queue, so the API answers both keys on it. */
const ASSIGNEE_KEYS = [FEATURE_KEYS.QUESTION_AUTHORING, FEATURE_KEYS.QUESTION_PROOFREAD] as const;

/** A section answers to its typist, its proof-reader and the test's owner alike. */
export const SECTION_KEYS = [...ASSIGNEE_KEYS, FEATURE_KEYS.TEST_MANAGEMENT] as const;

/** Each screen's guard as its endpoints state it: a read to open one, a write to make one. Unlisted is every admin's; a super-admin screen refuses itself. */
export const ROUTE_ACCESS: Readonly<Partial<Record<string, RouteAccess>>> = {
  [ROUTES.STUDENTS]: reads(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.STUDENT_PATTERN]: reads(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.IMPORT_STUDENTS]: writes(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.BRANCHES]: reads(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.EXAMS]: reads(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.COHORTS]: reads(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.EVENT_IMPORT_PATTERN]: writes(FEATURE_KEYS.STUDENT_MANAGEMENT),
  [ROUTES.PROGRAM_IMPORT_PATTERN]: writes(FEATURE_KEYS.STUDENT_MANAGEMENT),
  // The list endpoint also answers a test owner, for the picker; the bank's own screens do not.
  [ROUTES.QUESTIONS]: reads(FEATURE_KEYS.QUESTION_MANAGEMENT),
  [ROUTES.QUESTION_PATTERN]: reads(FEATURE_KEYS.QUESTION_MANAGEMENT),
  [ROUTES.QUESTION_NEW]: writes(FEATURE_KEYS.QUESTION_MANAGEMENT),
  [ROUTES.QUESTION_EDIT_PATTERN]: writes(FEATURE_KEYS.QUESTION_MANAGEMENT),
  [ROUTES.IMPORT_QUESTIONS]: writes(FEATURE_KEYS.QUESTION_MANAGEMENT),
  [ROUTES.TAXONOMY]: reads(FEATURE_KEYS.QUESTION_MANAGEMENT, ...SECTION_KEYS),
  [ROUTES.TYPING_SECTION_PATTERN]: reads(...SECTION_KEYS),
  [ROUTES.READING_SECTION_PATTERN]: reads(...SECTION_KEYS),
  [ROUTES.TEST_SECTION_PATTERN]: reads(...SECTION_KEYS),
  [ROUTES.PROOFREADING_ASSIGNMENTS]: reads(...ASSIGNEE_KEYS),
  [ROUTES.AUTHORING_ASSIGNMENTS]: reads(...ASSIGNEE_KEYS),
  [ROUTES.AUTHORING_HISTORY]: reads(FEATURE_KEYS.QUESTION_AUTHORING),
  // A blank editor has nothing to read; one opened on a question shows it read-only below WRITE.
  [ROUTES.AUTHORING_EDITOR]: writes(FEATURE_KEYS.QUESTION_AUTHORING),
  [ROUTES.AUTHORING_EDITOR_PATTERN]: reads(FEATURE_KEYS.QUESTION_AUTHORING),
  [ROUTES.AUTHORING_IMPORT_PATTERN]: writes(FEATURE_KEYS.QUESTION_AUTHORING),
  [ROUTES.BASE_CONFIGS]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.BASE_CONFIG_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.BASE_CONFIG_NEW]: writes(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TESTS]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_NEW]: writes(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_PAPER_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_PAPER_PRINT_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_ANALYTICS_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_SERIES_PATTERN]: reads(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.TEST_SERIES_NEW]: writes(FEATURE_KEYS.TEST_MANAGEMENT),
  [ROUTES.LIVE_OPS]: reads(FEATURE_KEYS.TEST_OPERATIONS),
  [ROUTES.ANNOUNCEMENTS]: reads(FEATURE_KEYS.NOTIFICATION_MANAGEMENT),
};

/** Whether the viewer may open a route pattern; a super admin passes inside `can`. */
export function opensRoute(path: string, can: Can): boolean {
  const access = ROUTE_ACCESS[path];
  return access === undefined || access.keys.some((key) => can(key, access.level));
}

/** Strips `superAdminOnly` and any row whose screen would refuse the viewer. `featureKey` is the shell's job. */
export function filterAdminNav(
  items: readonly AdminNavItem[],
  viewer: { isSuperAdmin: boolean; can: Can },
): AdminNavItem[] {
  return filterNavBy(
    items,
    (item) =>
      (Boolean(item.superAdminOnly) && !viewer.isSuperAdmin) ||
      (item.to !== undefined && !opensRoute(item.to, viewer.can)),
  );
}

/** A create-or-edit dialog's target while it is adding a record rather than editing one. */
export const NEW_RECORD = 'new';

const ADMIN = 'admin';

/** Every query key this app owns; a record sits under its list's root, so invalidating the list reaches it. */
export const QUERY_KEYS = {
  ADMINS: [ADMIN, 'admins'],
  ASSIGNMENTS: [ADMIN, 'assignments'],
  AUTHORING: [ADMIN, 'authoring'],
  ANNOUNCEMENTS: [ADMIN, 'announcements'],
  AUDIT: [ADMIN, 'audit'],
  BASE_CONFIG: [ADMIN, 'base-configs', 'detail'],
  BASE_CONFIGS: [ADMIN, 'base-configs'],
  BRANCHES: [ADMIN, 'branches'],
  DASHBOARD: [ADMIN, 'dashboard'],
  EVENTS: [ADMIN, 'events'],
  EXAM_STAGES: [ADMIN, 'exam-stages'],
  EXAMS: [ADMIN, 'exams'],
  FEATURES: [ADMIN, 'features'],
  LIVE_OPS: [ADMIN, 'live-ops'],
  LIVE_OPS_BOARD: [ADMIN, 'live-ops', 'board'],
  ME: ['auth', 'me'],
  PROGRAMS: [ADMIN, 'programs'],
  PROOFREADING: [ADMIN, 'proofreading'],
  QUESTION: [ADMIN, 'questions', 'detail'],
  QUESTIONS: [ADMIN, 'questions'],
  STUDENT: [ADMIN, 'students', 'detail'],
  STUDENTS: [ADMIN, 'students'],
  SECTION_THREAD: [ADMIN, 'section-thread'],
  SUBJECTS: [ADMIN, 'subjects'],
  TEST: [ADMIN, 'tests', 'detail'],
  REPORTS: [ADMIN, 'reports'],
  TEST_ANALYTICS: [ADMIN, 'test-analytics'],
  TEST_PAPER: [ADMIN, 'test-paper'],
  TEST_SERIES: [ADMIN, 'test-series'],
  TESTS: [ADMIN, 'tests'],
  TOPICS: [ADMIN, 'topics'],
} as const;

/** How often the analytics screen asks again while a re-sync it asked for is landing. */
export const ANALYTICS_SYNC_POLL_MS = 3_000;

/** Past the rebuild's own two-minute ceiling, polling will not see a sync that has not landed. */
export const ANALYTICS_SYNC_MAX_MS = 150_000;

/** The two a named student's report can be asked about here: this app offers no series picker. */
export const PERFORMANCE_SCOPE_LABELS: Readonly<Record<string, string>> = {
  [PERFORMANCE_SCOPES.ATTEMPT]: 'This sitting',
  [PERFORMANCE_SCOPES.ALL_TIME]: 'All time',
};

/** Segments that qualify a key, shared because a picker and the list it feeds must agree. */
const QUERY_SCOPES = {
  NAMED: 'named',
  /** A CHOOSER: it attaches something, so it offers only what is still running. */
  PICKER: 'picker',
  /** A FILTER: it narrows a list, so it must reach a retired value or those rows go missing. */
  FILTER: 'filter',
  /** A question as the authoring workspace holds it, apart from the detail it was read from. */
  HELD: 'held',
  /** Every row in one read, so a paged view of the same list is a separate entry. */
  ALL: 'all',
  /** A record in full for the printer, apart from the screen it is printed from. */
  PRINT: 'print',
} as const;

// ---------------------------------------------------------------------------
// Query keys — every one this app reads or invalidates is built by a helper here.
// ---------------------------------------------------------------------------

export const adminFilterQueryKey = () => [...QUERY_KEYS.ADMINS, QUERY_SCOPES.FILTER] as const;

export const allAdminsQueryKey = () => [...QUERY_KEYS.ADMINS, QUERY_SCOPES.ALL] as const;

export const announcementQueryKey = (id: string) => [...QUERY_KEYS.ANNOUNCEMENTS, id] as const;

export const announcementPreviewQueryKey = (audience: Partial<AnnouncementAudience>) =>
  [...QUERY_KEYS.ANNOUNCEMENTS, 'preview', audience] as const;

export const assignmentPickerQueryKey = (role: AssignmentRole, testId: string) =>
  [...QUERY_KEYS.ASSIGNMENTS, QUERY_SCOPES.PICKER, role, testId] as const;

export const assignmentTestFilterQueryKey = (scope: string) =>
  [...QUERY_KEYS.ASSIGNMENTS, QUERY_SCOPES.FILTER, 'tests', scope] as const;

export const assignmentSectionFilterQueryKey = (testId: string, scope: string) =>
  [...QUERY_KEYS.ASSIGNMENTS, QUERY_SCOPES.FILTER, 'sections', testId, scope] as const;

export const testAssignmentsQueryKey = (testId: string) =>
  [...QUERY_KEYS.ASSIGNMENTS, testId] as const;

export const assignableAdminsQueryKey = (role: AssignmentRole) =>
  [...QUERY_KEYS.ASSIGNMENTS, 'assignable', role] as const;

export const assignmentProgressQueryKey = () => [...QUERY_KEYS.ASSIGNMENTS, 'progress'] as const;

export const myAssignmentsQueryKey = (role: AssignmentRole) =>
  [...QUERY_KEYS.ASSIGNMENTS, 'mine', role] as const;

export const authoringQuestionQueryKey = (id: string | undefined) =>
  [...QUERY_KEYS.AUTHORING, id] as const;

export const authoringDuplicateQueryKey = (editingId: string, revision: number | undefined) =>
  [...QUERY_KEYS.AUTHORING, 'duplicate', editingId, revision] as const;

export const authoringStatsQueryKey = () => [...QUERY_KEYS.AUTHORING, 'stats'] as const;

export const authoringHistoryQueryKey = () => [...QUERY_KEYS.AUTHORING, 'history'] as const;

export const questionAuditQueryKey = (questionId: string) =>
  [...QUERY_KEYS.AUDIT, 'question', questionId] as const;

export const auditRowActionsQueryKey = () => [...QUERY_KEYS.AUDIT, 'row-actions'] as const;

export const auditImportsQueryKey = () => [...QUERY_KEYS.AUDIT, 'imports'] as const;

export const baseConfigQueryKey = (id: string | undefined) =>
  [...QUERY_KEYS.BASE_CONFIG, id] as const;

export const baseConfigPickerQueryKey = (examStageId: string) =>
  [...QUERY_KEYS.BASE_CONFIGS, QUERY_SCOPES.PICKER, examStageId] as const;

export const defaultBaseConfigQueryKey = (examStageId: string) =>
  [...QUERY_KEYS.BASE_CONFIGS, 'default', examStageId] as const;

export const eventQueryKey = (id: string) => [...QUERY_KEYS.EVENTS, id] as const;

export const eventPickerQueryKey = () => [...QUERY_KEYS.EVENTS, QUERY_SCOPES.PICKER] as const;

export const eventFilterQueryKey = () => [...QUERY_KEYS.EVENTS, QUERY_SCOPES.FILTER] as const;

export const examsQueryKey = (activeOnly: boolean) =>
  [...QUERY_KEYS.EXAMS, { activeOnly }] as const;

export const examPickerQueryKey = () => [...QUERY_KEYS.EXAMS, QUERY_SCOPES.PICKER] as const;

export const examFilterQueryKey = () => [...QUERY_KEYS.EXAMS, QUERY_SCOPES.FILTER] as const;

export const examStagesQueryKey = (examId: string) => [...QUERY_KEYS.EXAM_STAGES, examId] as const;

export const examStagePickerQueryKey = (examId: string) =>
  [...QUERY_KEYS.EXAM_STAGES, QUERY_SCOPES.PICKER, examId] as const;

export const examStageFilterQueryKey = (examIds: string) =>
  [...QUERY_KEYS.EXAM_STAGES, QUERY_SCOPES.FILTER, examIds] as const;

export const liveTestPickerQueryKey = () => [...QUERY_KEYS.LIVE_OPS, QUERY_SCOPES.PICKER] as const;

export const liveOpsBoardQueryKey = (testId: string) =>
  [...QUERY_KEYS.LIVE_OPS_BOARD, testId] as const;

export const programPickerQueryKey = () => [...QUERY_KEYS.PROGRAMS, QUERY_SCOPES.PICKER] as const;

export const programFilterQueryKey = () => [...QUERY_KEYS.PROGRAMS, QUERY_SCOPES.FILTER] as const;

export const sectionWorkQueryKey = (testId: string, sectionId: string) =>
  [...QUERY_KEYS.PROOFREADING, 'work', testId, sectionId] as const;

/** The workspace's own copy of one card, under the section so settling the section reaches it. */
export const sectionWorkHeldQueryKey = (testId: string, sectionId: string, questionId: string) =>
  [...sectionWorkQueryKey(testId, sectionId), questionId, QUERY_SCOPES.HELD] as const;

export const questionOtherTestsQueryKey = (questionId: string) =>
  [...QUERY_KEYS.PROOFREADING, 'other-tests', questionId] as const;

export const questionQueryKey = (id: string) => [...QUERY_KEYS.QUESTION, id] as const;

export const heldQuestionQueryKey = (id: string) =>
  [...QUERY_KEYS.QUESTION, id, QUERY_SCOPES.HELD] as const;

export const questionVersionsQueryKey = (questionId: string) =>
  [...QUERY_KEYS.QUESTIONS, questionId, 'versions'] as const;

export const sectionQuestionPickerQueryKey = (sectionId: string) =>
  [...QUERY_KEYS.QUESTIONS, QUERY_SCOPES.PICKER, sectionId] as const;

export const availableQuestionsQueryKey = (
  testId: string,
  subjectId: string | null,
  topicIds: string,
) => [...QUERY_KEYS.QUESTIONS, 'available', testId, subjectId, topicIds] as const;

export const importDraftsQueryKey = (importLogId: string) =>
  [...QUERY_KEYS.QUESTIONS, 'import', importLogId] as const;

export const importDraftQueryKey = (importLogId: string, line: string) =>
  [...importDraftsQueryKey(importLogId), line] as const;

export const studentQueryKey = (id: string) => [...QUERY_KEYS.STUDENT, id] as const;

export const studentSittingsQueryKey = (studentId: string, search: string) =>
  [...QUERY_KEYS.STUDENT, studentId, 'sittings', search] as const;

export const studentSeriesQueryKey = (studentId: string) =>
  [...QUERY_KEYS.STUDENT, studentId, 'series'] as const;

/** Keyed by what the report is OF, so switching sitting or scope never reads a stale one. */
export const studentReportQueryKey = (
  studentId: string,
  scope: PerformanceScope,
  scopeId: string,
) => [...QUERY_KEYS.STUDENT, studentId, 'performance', scope, scopeId] as const;

export const studentPickerQueryKey = () => [...QUERY_KEYS.STUDENTS, QUERY_SCOPES.PICKER] as const;

export const subjectPickerQueryKey = () => [...QUERY_KEYS.SUBJECTS, QUERY_SCOPES.PICKER] as const;

export const topicPickerQueryKey = (subjectIds: string) =>
  [...QUERY_KEYS.TOPICS, QUERY_SCOPES.PICKER, subjectIds] as const;

export const testQueryKey = (testId: string) => [...QUERY_KEYS.TEST, testId] as const;

export const namedTestQueryKey = (examStageId: string | undefined, stem: string) =>
  [...QUERY_KEYS.TESTS, QUERY_SCOPES.NAMED, examStageId, stem] as const;

export const reportQueryKey = (key: ReportKey, query: ReportQueryInput) =>
  [...QUERY_KEYS.REPORTS, key, query] as const;

/** A sitting's choices hang off a student, so whose they are is part of the key. */
export const reportChoicesQueryKey = (param: ReportChoiceParam, studentId: string) =>
  [...QUERY_KEYS.REPORTS, QUERY_SCOPES.PICKER, param, studentId] as const;

export const testAnalyticsQueryKey = (testId: string) =>
  [...QUERY_KEYS.TEST_ANALYTICS, testId] as const;

export const testPaperQueryKey = (testId: string) => [...QUERY_KEYS.TEST_PAPER, testId] as const;

/** The printed paper is its own entry: it is the whole content, and each read of it is logged. */
export const testPaperPrintQueryKey = (testId: string, languages: string, withKey: boolean) =>
  [...QUERY_KEYS.TEST_PAPER, testId, QUERY_SCOPES.PRINT, languages, withKey] as const;

export const seriesQueryKey = (id: string) => [...QUERY_KEYS.TEST_SERIES, id] as const;

export const namedSeriesQueryKey = (examStageId: string | undefined, stem: string) =>
  [...QUERY_KEYS.TEST_SERIES, QUERY_SCOPES.NAMED, examStageId, stem] as const;

export const seriesPickerQueryKey = (notReachedBy: string, forExamStageId: string) =>
  [...QUERY_KEYS.TEST_SERIES, QUERY_SCOPES.PICKER, notReachedBy, forExamStageId] as const;

export const sectionThreadQueryKey = (testId: string, sectionId: string) =>
  [...QUERY_KEYS.SECTION_THREAD, testId, sectionId] as const;

// The admin list the Permissions screen assigns from; past a hundred this needs a Combobox instead.
export const PAGE_SIZE_FOR_PICKERS = 100;

// localStorage keys namespaced so the SPAs never read each other's; the theme key is absent since it belongs to @iace/ui.
export const STORAGE_KEYS = {
  AUTH: 'iace.admin.auth',
  /** The question in the box right now. A closed tab loses nothing; only a save writes a row. */
  AUTHORING_DRAFT: 'iace.admin.authoring',
  /** Which page tours this device has been shown; one key holding the set, so a tour added later needs no migration. */
  TOURS: 'iace.admin.tours',
} as const;

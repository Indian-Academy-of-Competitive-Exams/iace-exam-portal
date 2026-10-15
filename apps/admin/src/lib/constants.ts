import { type ReportKey } from '@iace/contracts';

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
  /** The question in the box as a candidate meets it: its own tab, outside the shell. */
  CANDIDATE_VIEW: (viewId: string) => `/candidate-view/${viewId}`,
  CANDIDATE_VIEW_PATTERN: '/candidate-view/:viewId',
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
  /** One sheet for a whole typed test, each row into its section's typist's drafts. */
  TEST_IMPORT: (id: string) => `/tests/${id}/import`,
  TEST_IMPORT_PATTERN: '/tests/:testId/import',
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

/** Which list the cohorts screen is showing. Absent from the URL means Programs. */
export const COHORT_TABS = {
  PROGRAMS: 'programs',
  EVENTS: 'events',
} as const;
export type CohortTab = (typeof COHORT_TABS)[keyof typeof COHORT_TABS];

/** A create-or-edit dialog's target while it is adding a record rather than editing one. */
export const NEW_RECORD = 'new';

/** How often the analytics screen asks again while a re-sync it asked for is landing. */
export const ANALYTICS_SYNC_POLL_MS = 3_000;

/** Past the rebuild's own two-minute ceiling, polling will not see a sync that has not landed. */
export const ANALYTICS_SYNC_MAX_MS = 150_000;

// The admin list the Permissions screen assigns from; past a hundred this needs a Combobox instead.
export const PAGE_SIZE_FOR_PICKERS = 100;

// localStorage keys namespaced so the SPAs never read each other's; the theme key is absent since it belongs to @iace/ui.
export const STORAGE_KEYS = {
  AUTH: 'iace.admin.auth',
  /** The question in the box right now. A closed tab loses nothing; only a save writes a row. */
  AUTHORING_DRAFT: 'iace.admin.authoring',
  /** One entry per opened candidate view, under a random id the address carries. */
  CANDIDATE_VIEW: 'iace.admin.candidate-view',
  /** Which page tours this device has been shown; one key holding the set, so a tour added later needs no migration. */
  TOURS: 'iace.admin.tours',
} as const;

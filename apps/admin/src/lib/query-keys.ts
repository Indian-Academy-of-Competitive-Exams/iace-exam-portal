import {
  type AnnouncementAudience,
  type AssignmentRole,
  type ReportChoiceParam,
  type ReportKey,
  type ReportQueryInput,
  type PerformanceScope,
} from '@iace/contracts';

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

/** With the test alone it is every count read for that test's paper, which a paper edit makes stale. */
export const availableQuestionsQueryKey = (
  testId: string,
  ...slice: [subjectId: string | null, topicIds: string] | []
) => [...QUERY_KEYS.QUESTIONS, 'available', testId, ...slice] as const;

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

import {
  type AdminRole,
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
  STUDENT_TYPE,
  type StudentSeriesSource,
  type StudentType,
  type SupportPriority,
  type SupportStatus,
  type TestBuilderStep,
  type TestSeriesKind,
  type TestStatus,
  type TestUi,
  type TimerTemplate,
  REVIEW_STATES,
  SEND_BACK_REASONS,
  type ReviewState,
  type SendBackReason,
  type WritingFormat,
} from '@iace/contracts';

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
  TYPING: 'Typing passage',
  DESCRIPTIVE: 'Descriptive',
};

/** What each kind of written answer is called on screen. */
export const WRITING_FORMAT_LABELS: Readonly<Record<WritingFormat, string>> = {
  ESSAY: 'Essay',
  LETTER: 'Letter',
  PRECIS: 'Précis',
  OTHER: 'Other',
};

/** Every exam course as a choice, written the way the institute says it. */
export const COURSE_ITEMS = EXAM_COURSES.map((course) => ({
  value: course,
  label: courseLabel(course),
}));

/** The key a question's code travels under, on the draft and in the server's refusal. */
export const QUESTION_CODE_FIELD = 'questionCode';

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
  RAILWAYS: 'Railways',
  BANKING: 'Banking',
  SSC: 'SSC',
};

export const EXAM_TEMPLATE_HINTS: Readonly<Record<ExamTemplate, string>> = {
  DEFAULT: 'Roomier spacing and larger targets',
  RAILWAYS: 'Dense, with the timer in the section bar and the palette on the right',
  BANKING: 'Section tabs across the top, the timer beside them and the palette on the right',
  SSC: 'The timer in the header, the buttons above the question and the palette on the right',
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

/** The two a named student's report can be asked about here: this app offers no series picker. */
export const PERFORMANCE_SCOPE_LABELS: Readonly<Record<string, string>> = {
  [PERFORMANCE_SCOPES.ATTEMPT]: 'This sitting',
  [PERFORMANCE_SCOPES.ALL_TIME]: 'All time',
};

export const SUPPORT_STATUS_LABELS: Readonly<Record<SupportStatus, string>> = {
  OPEN: 'Open',
  ANSWERED: 'Answered',
  CLOSED: 'Closed',
};

export const SUPPORT_PRIORITY_LABELS: Readonly<Record<SupportPriority, string>> = {
  NORMAL: 'Normal',
  HIGH: 'High',
};

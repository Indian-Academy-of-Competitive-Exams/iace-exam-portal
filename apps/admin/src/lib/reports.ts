import {
  REPORT_GROUPS,
  REPORT_KEYS,
  REPORT_PARAMS,
  REPORT_PERIODS,
  type ReportGroup,
  type ReportKey,
  type ReportParam,
  type ReportPeriod,
} from '@iace/contracts';

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
  [REPORT_KEYS.TEST_TYPING]:
    'Each student’s speed, mistakes and result in every typing section of the test',
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

import { type TourStep } from '@iace/app-kit';
import { TOUR_ANCHORS } from '@iace/ui';

/** One id per tour. It is what `seenTours` stores, so renaming one shows that tour again. */
export const TOUR_IDS = {
  TESTS_AND_SERIES: 'tests-and-series',
  TEST_BUILDER: 'test-builder',
  QUESTIONS: 'questions',
  TAXONOMY: 'taxonomy',
  IMPORT_QUESTIONS: 'import-questions',
  LIVE_OPS: 'live-ops',
  STUDENT_DETAIL: 'student-detail',
} as const;

/** The `data-tour` values these tours point at, beyond the tabs and filter bar every frame carries. */
export const TOUR_TARGETS = {
  SERIES_NEW: 'series-new',
  BUILDER_STEPS: 'builder-steps',
  BUILDER_ACTION: 'builder-action',
  QUESTIONS_ACTIONS: 'questions-actions',
  TAXONOMY_NEW: 'taxonomy-new',
  STUDENT_EDIT: 'student-edit',
  LIVE_PICKER: 'live-picker',
} as const;

export const TESTS_AND_SERIES_TOUR: readonly TourStep[] = [
  {
    target: TOUR_ANCHORS.TABS,
    title: 'Series, and every test',
    body: 'A series is what a student is given access to; All tests is the flat list of the papers inside them.',
  },
  {
    target: TOUR_TARGETS.SERIES_NEW,
    title: 'A test is built inside its series',
    body: 'Only a series is created from here — New series first, then its tests from the series itself.',
  },
  {
    target: TOUR_ANCHORS.FILTERS,
    title: 'One set of filters, both lists',
    body: 'The exam and the search carry across when you switch tabs, so neither list is left narrowed by the other.',
  },
];

export const TEST_BUILDER_TOUR: readonly TourStep[] = [
  {
    target: TOUR_TARGETS.BUILDER_STEPS,
    title: 'Setup, paper, then who sits it',
    body: 'Each step saves on its own, so a half-built test is a draft you can leave and come back to.',
  },
  {
    target: TOUR_TARGETS.BUILDER_ACTION,
    title: 'What this test was built from',
    body: 'The base configuration behind it, and its analytics once students have sat the paper.',
  },
];

export const QUESTIONS_TOUR: readonly TourStep[] = [
  {
    target: TOUR_ANCHORS.FILTERS,
    title: 'Narrowing the bank',
    body: 'Subject, topic and status, and Match filters decides whether a question must meet all of them or any.',
  },
  {
    target: TOUR_TARGETS.QUESTIONS_ACTIONS,
    title: 'One question, or a sheet of them',
    body: 'Import takes a spreadsheet and shows you every row it would refuse before anything is written.',
  },
];

export const TAXONOMY_TOUR: readonly TourStep[] = [
  {
    target: TOUR_ANCHORS.TABS,
    title: 'Two levels of one taxonomy',
    body: 'A subject holds topics, and a question is tagged with both — which is what the bank filters on.',
  },
  {
    target: TOUR_TARGETS.TAXONOMY_NEW,
    title: 'Adding to either level',
    body: 'The button follows the open tab, so it adds a subject on Subjects and a topic on Topics.',
  },
];

export const IMPORT_QUESTIONS_TOUR: readonly TourStep[] = [
  {
    target: TOUR_ANCHORS.IMPORT_UPLOAD,
    title: 'The sheet, before it is written',
    body: 'A file is read and checked here; nothing reaches the bank until you commit it.',
  },
  {
    target: TOUR_ANCHORS.IMPORT_PREVIEW,
    title: 'Every row it would refuse',
    body: 'Errors are listed per row, and a commit takes the valid rows and leaves the rest for you to fix.',
  },
];

export const LIVE_OPS_TOUR: readonly TourStep[] = [
  {
    target: TOUR_ANCHORS.TABS,
    title: 'A sitting through its life',
    body: 'Running, submitted and marked — the same test read at three points, while it is happening.',
  },
  {
    target: TOUR_TARGETS.LIVE_PICKER,
    title: 'Which test you are watching',
    body: 'Pick the paper and the branch; the board counts live from the database rather than from a snapshot.',
  },
];

export const STUDENT_DETAIL_TOUR: readonly TourStep[] = [
  {
    target: TOUR_ANCHORS.TABS,
    title: 'One student, every view',
    body: 'Their details, the series they reach, their sittings and the actions taken on their account.',
  },
  {
    target: TOUR_TARGETS.STUDENT_EDIT,
    title: 'What an edit records',
    body: 'Every change here is written to the audit log against your account, including who blocked a student and when.',
  },
];

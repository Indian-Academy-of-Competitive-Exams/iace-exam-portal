/**
 * What each student screen filters BY — keys, labels and choices — in one place, because both
 * clients draw the same page and the two had drifted. How a control is DRAWN stays each app's
 * own; only the facts are shared, so nothing DOM may reach this file.
 */
import {
  courseLabel,
  EXAM_COURSES,
  QUESTION_FILTERS,
  TEST_BUCKET,
  type ExamCourse,
  type SavedFacets,
  type StudentCatalogSeries,
} from '@iace/contracts';

/** The unset value every "Any …" row carries, which is how a filter reads as off in both apps. */
export const ANY_CHOICE = '';

export interface FilterItem {
  value: string;
  label: string;
}

export interface FilterSpec {
  key: string;
  kind: 'search' | 'choice' | 'multi';
  label: string;
  /** Beside the search on the web; on the phone, what stays out of the sheet. */
  primary?: boolean;
  placeholder?: string;
  /** Absent only on `search`, which offers no choices to list. */
  items?: readonly FilterItem[];
}

/** A filter's value is a string or a set of them; these are how either is read without a cast. */
export type FilterValue = string | readonly string[];

export const asText = (value: FilterValue | undefined): string =>
  typeof value === 'string' ? value : '';

export const asSet = (value: FilterValue | undefined): readonly string[] =>
  Array.isArray(value) ? value : [];

/** Which notifications are shown. Unread leads: it is the one a bell is opened for. */
export const READ_STATE = { ALL: ANY_CHOICE, UNREAD: 'unread' } as const;

export const NOTIFICATION_FILTERS: readonly FilterSpec[] = [
  {
    key: 'state',
    kind: 'choice',
    label: 'Show',
    primary: true,
    items: [
      { value: READ_STATE.UNREAD, label: 'Unread' },
      { value: READ_STATE.ALL, label: 'All' },
    ],
  },
];

export const QUESTION_REPORT_FILTERS: readonly FilterSpec[] = [
  {
    key: 'status',
    kind: 'choice',
    label: 'Result',
    primary: true,
    items: [
      { value: ANY_CHOICE, label: 'Any result' },
      { value: QUESTION_FILTERS.CORRECT, label: 'Correct' },
      { value: QUESTION_FILTERS.INCORRECT, label: 'Incorrect' },
      { value: QUESTION_FILTERS.UNATTEMPTED, label: 'Unattempted' },
    ],
  },
];

/** Where a paper stands for this student — the one thing a shelf is scanned for. */
export const TEST_STATE_ITEMS: readonly FilterItem[] = [
  { value: ANY_CHOICE, label: 'Any state' },
  { value: TEST_BUCKET.OPEN, label: 'Open now' },
  { value: TEST_BUCKET.LATER, label: 'Scheduled' },
  { value: TEST_BUCKET.DONE, label: 'Done' },
];

export function testsFilters(series: readonly StudentCatalogSeries[]): FilterSpec[] {
  return [
    {
      key: 'q',
      kind: 'search',
      label: 'Search tests',
      primary: true,
      placeholder: 'Search your tests',
    },
    { key: 'course', kind: 'choice', label: 'Exam', primary: true, items: courseItems(series) },
    { key: 'state', kind: 'choice', label: 'State', items: TEST_STATE_ITEMS },
    { key: 'series', kind: 'choice', label: 'Series', items: seriesItems(series) },
  ];
}

/** Named apart from the spec: the web's picker fetches its own choices and takes only these. */
export const SAVED_FILTER_FIELDS = {
  SUBJECT: { key: 'subjectId', label: 'Subject', placeholder: 'Any subject' },
  TEST: { key: 'testId', label: 'Test', placeholder: 'Any test' },
} as const;

export type SavedFilterKey = (typeof SAVED_FILTER_FIELDS)[keyof typeof SAVED_FILTER_FIELDS]['key'];

/** Only what their own set spans: a filter must offer no choice that finds nothing. */
export function savedFilters(facets: SavedFacets | undefined): FilterSpec[] {
  return [
    {
      ...SAVED_FILTER_FIELDS.SUBJECT,
      kind: 'multi',
      primary: true,
      items: facetItems(facets?.subjects),
    },
    { ...SAVED_FILTER_FIELDS.TEST, kind: 'multi', primary: true, items: facetItems(facets?.tests) },
  ];
}

/** Only the series this student reaches; a filter offering one row is a filter offering nothing. */
export function seriesItems(series: readonly StudentCatalogSeries[]): FilterItem[] {
  return [
    { value: ANY_CHOICE, label: 'Any series' },
    ...series.map((row) => ({ value: row.id, label: row.name })),
  ];
}

/** Only the courses this student actually reaches; a filter offering nothing is noise. */
export function courseItems(series: readonly StudentCatalogSeries[]): FilterItem[] {
  const held = new Set(
    series.map((row) => row.examStage?.course).filter((one): one is ExamCourse => Boolean(one)),
  );

  return [
    { value: ANY_CHOICE, label: 'Any exam' },
    ...EXAM_COURSES.filter((one) => held.has(one)).map((one) => ({
      value: one,
      label: courseLabel(one),
    })),
  ];
}

/** A set-valued filter has no "Any …" row: choosing none of them already means every one. */
const facetItems = (rows: SavedFacets['subjects'] | undefined): FilterItem[] =>
  (rows ?? []).map((row) => ({ value: row.id, label: row.name }));

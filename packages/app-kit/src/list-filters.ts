/**
 * What each student screen filters BY — keys, labels and choices — in one place, because both
 * clients draw the same page and the two had drifted. How a control is DRAWN stays each app's
 * own; only the facts are shared, so nothing DOM may reach this file.
 */
import {
  courseLabel,
  EXAM_COURSES,
  NOTIFICATION_TYPE,
  todayISO,
  type NotificationListQueryInput,
  type NotificationType,
  QUESTION_FILTERS,
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_INFO,
  SUPPORT_STATUSES,
  SUPPORT_STATUS_STUDENT_LABEL,
  TEST_BUCKET,
  type MyTicketListQuery,
  type SupportCategory,
  type SupportStatus,
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
  kind: 'search' | 'choice' | 'multi' | 'date';
  label: string;
  /** Beside the search on the web; on the phone, what stays out of the sheet. */
  primary?: boolean;
  placeholder?: string;
  /** Absent on `search` and `date`, which offer no choices to list. */
  items?: readonly FilterItem[];
  /** The latest `YYYY-MM-DD` a `date` may pick. */
  max?: string;
}

/** A filter's value is a string or a set of them; these are how either is read without a cast. */
export type FilterValue = string | readonly string[];

export const asText = (value: FilterValue | undefined): string =>
  typeof value === 'string' ? value : '';

export const asSet = (value: FilterValue | undefined): readonly string[] =>
  Array.isArray(value) ? value : [];

/** Which notifications are shown. Unread leads: it is the one a bell is opened for. */
export const READ_STATE = { ALL: ANY_CHOICE, UNREAD: 'unread' } as const;

/** What a student calls each kind, several types to one where the student sees no difference. */
export const NOTIFICATION_KINDS = {
  RESULT: {
    label: 'Result',
    types: [NOTIFICATION_TYPE.RESULT_READY, NOTIFICATION_TYPE.RESULT_UPDATED],
  },
  TEST: { label: 'Test', types: [NOTIFICATION_TYPE.TEST_ASSIGNED] },
  ACCESS: { label: 'Access', types: [NOTIFICATION_TYPE.GRANT_ADDED] },
  ENROLMENT: { label: 'Enrolment', types: [NOTIFICATION_TYPE.ENROLLMENT_ADDED] },
  NOTICE: { label: 'Notice', types: [NOTIFICATION_TYPE.GENERIC] },
  SECURITY: { label: 'Security', types: [NOTIFICATION_TYPE.PIN_CHANGED] },
  WELCOME: { label: 'Welcome', types: [NOTIFICATION_TYPE.WELCOME] },
} as const satisfies Record<string, { label: string; types: readonly NotificationType[] }>;
type NotificationKind = keyof typeof NOTIFICATION_KINDS;

const KIND_ENTRIES = Object.entries(NOTIFICATION_KINDS) as [
  NotificationKind,
  (typeof NOTIFICATION_KINDS)[NotificationKind],
][];

export const notificationKindOf = (type: NotificationType): string =>
  KIND_ENTRIES.find(([, kind]) => (kind.types as readonly string[]).includes(type))?.[1].label ??
  type;

export const NOTIFICATION_FILTERS: readonly FilterSpec[] = [
  { key: 'q', kind: 'search', label: 'Search', primary: true, placeholder: 'Search notifications' },
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
  {
    key: 'kind',
    kind: 'multi',
    label: 'Type',
    // Nothing sends a Security notification now; the kind stays only to name old ones.
    items: KIND_ENTRIES.filter(([value]) => value !== 'SECURITY').map(([value, kind]) => ({
      value,
      label: kind.label,
    })),
  },
  // A getter, so a tab left open past midnight reads the new day at its next render.
  {
    key: 'from',
    kind: 'date',
    label: 'From',
    get max() {
      return todayISO();
    },
  },
  {
    key: 'to',
    kind: 'date',
    label: 'To',
    get max() {
      return todayISO();
    },
  },
];

/** The filters as the endpoint takes them; `unreadAsOf` holds a paged Unread list still while its rows are read. */
export function notificationQuery(
  values: Readonly<Record<string, FilterValue | undefined>>,
  unreadAsOf?: string,
): NotificationListQueryInput {
  const unreadOnly = asText(values.state) === READ_STATE.UNREAD;
  const kinds = asSet(values.kind).filter(
    (one): one is NotificationKind => one in NOTIFICATION_KINDS,
  );
  return {
    ...(unreadOnly ? { unreadOnly: 'true', unreadAsOf } : {}),
    q: asText(values.q) || undefined,
    type: kinds.length > 0 ? kinds.flatMap((one) => NOTIFICATION_KINDS[one].types) : undefined,
    from: asText(values.from) || undefined,
    to: asText(values.to) || undefined,
  };
}

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
    { key: 'series', kind: 'multi', label: 'Series', items: seriesItems(series) },
  ];
}

/** Named apart from the spec: the web's picker fetches its own choices and takes only these. */
export const SAVED_FILTER_FIELDS = {
  SUBJECT: { key: 'subjectId', label: 'Subject', placeholder: 'Any subject' },
  TEST: { key: 'testId', label: 'Test', placeholder: 'Any test' },
} as const;

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

/** Only the series this student reaches; choosing none of them means all of them. */
export function seriesItems(series: readonly StudentCatalogSeries[]): FilterItem[] {
  return series.map((row) => ({ value: row.id, label: row.name }));
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

/** A student's own queries: by their words, where each stands, and what it is about. */
export const SUPPORT_FILTERS: readonly FilterSpec[] = [
  { key: 'q', kind: 'search', label: 'Search', primary: true, placeholder: 'Search your queries' },
  {
    key: 'status',
    kind: 'choice',
    label: 'Status',
    primary: true,
    items: [
      { value: ANY_CHOICE, label: 'Any status' },
      ...Object.values(SUPPORT_STATUSES).map((status) => ({
        value: status,
        label: SUPPORT_STATUS_STUDENT_LABEL[status],
      })),
    ],
  },
  {
    key: 'category',
    kind: 'choice',
    label: 'Category',
    items: [
      { value: ANY_CHOICE, label: 'Any category' },
      ...Object.values(SUPPORT_CATEGORIES).map((category) => ({
        value: category,
        label: SUPPORT_CATEGORY_INFO[category].label,
      })),
    ],
  },
];

/** The support filters as the list endpoint takes them. */
export const supportQuery = (
  values: Readonly<Record<string, FilterValue>>,
): Omit<MyTicketListQuery, 'page' | 'pageSize'> => ({
  q: asText(values.q) || undefined,
  status: (asText(values.status) || undefined) as SupportStatus | undefined,
  category: (asText(values.category) || undefined) as SupportCategory | undefined,
});

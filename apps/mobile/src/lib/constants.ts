/** Storage keys owned by this app, namespaced the way the SPAs name their localStorage keys. */
export const STORAGE_KEYS = {
  AUTH: 'iace.mobile.auth',
  /** Per install: what tells the server this device is the one answering. */
  TAB: 'iace.mobile.tab',
  /** Answers a save has not delivered yet, kept on the phone until one does. */
  QUEUED_ANSWERS: 'iace.mobile.queued',
  /** Which page tours this install has been shown; one key holding the set, so a tour added later needs no migration. */
  TOURS: 'iace.mobile.tours',
} as const;

/** The keys both student clients cache under, defined once so the two never disagree. */
export {
  ACTIVE_DEVICES_QUERY_KEY,
  CATALOG_QUERY_KEY,
  ME_QUERY_KEY,
  NOTIFICATIONS_QUERY_KEY,
  OVERVIEW_QUERY_KEY,
  PERFORMANCE_QUERY_KEY,
  PERFORMANCE_SERIES_QUERY_KEY,
  PROFILE_QUERY_KEY,
  SYSTEM_CHECK_QUERY_KEY,
  TEST_DAYS_QUERY_KEY,
  UNREAD_QUERY_KEY,
  attemptPaperQueryKey,
  bookmarksInAttemptQueryKey,
  briefQueryKey,
  leaderboardQueryKey,
  notificationsQueryKey,
  performanceReportQueryKey,
  questionReportQueryKey,
  savedFacetsQueryKey,
  savedQueryKey,
  scoreCardQueryKey,
  solutionsQueryKey,
  startedAttemptQueryKey,
} from '@iace/app-kit';

/** The search param carrying the language choice to `/exam/[testId]`. */
export const EXAM_LANGUAGES_PARAM = 'languages' as const;

/** What a sitting knew about itself as it ended. Put in the cache by the exam, never fetched. */
export const endedSittingQueryKey = (attemptId: string) =>
  ['me', 'attempts', attemptId, 'ended'] as const;

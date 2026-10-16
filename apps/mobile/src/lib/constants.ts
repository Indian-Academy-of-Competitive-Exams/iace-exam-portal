import { SUPPORT_STATUSES, type SupportStatus } from '@iace/contracts';
import { type BadgeVariant } from '../components/ui/badge';

/** Storage keys owned by this app, namespaced the way the SPAs name their localStorage keys. */
export const STORAGE_KEYS = {
  AUTH: 'iace.mobile.auth',
  /** Per install: what tells the server this device is the one answering. */
  TAB: 'iace.mobile.tab',
  /** Answers a save has not delivered yet, kept on the phone until one does. */
  QUEUED_ANSWERS: 'iace.mobile.queued',
  /** Which page tours this install has been shown; one key holding the set, so a tour added later needs no migration. */
  TOURS: 'iace.mobile.tours',
  THEME: 'iace.mobile.theme',
} as const;

/** The keys both student clients cache under, defined once so the two never disagree. */
export {
  ACTIVE_DEVICES_QUERY_KEY,
  CATALOG_QUERY_KEY,
  ME_QUERY_KEY,
  NOTIFICATIONS_QUERY_KEY,
  OVERVIEW_QUERY_KEY,
  PERFORMANCE_QUERY_KEY,
  PROFILE_QUERY_KEY,
  SYSTEM_CHECK_QUERY_KEY,
  TEST_DAYS_QUERY_KEY,
  NOTIFICATION_LISTS_QUERY_KEY,
  UNREAD_QUERY_KEY,
  bookmarksInAttemptQueryKey,
  briefQueryKey,
  leaderboardQueryKey,
  notificationsQueryKey,
  questionReportQueryKey,
  savedFacetsQueryKey,
  savedQueryKey,
  scoreCardQueryKey,
  solutionsQueryKey,
} from '@iace/app-kit';

/** The search param carrying the language choice to `/exam/[testId]`. */
export const EXAM_LANGUAGES_PARAM = 'languages' as const;

/** The web's own param: the sitting a Resume names, so one handed in since is never begun afresh. */
export const EXAM_RESUME_PARAM = 'resume' as const;

/** What a sitting knew about itself as it ended. Put in the cache by the exam, never fetched. */
export const endedSittingQueryKey = (attemptId: string) =>
  ['me', 'attempts', attemptId, 'ended'] as const;

/** One root, so a send, a close or a new query refreshes the list and the thread together. */
export const SUPPORT_QUERY_KEY = ['me', 'support'] as const;
export const SUPPORT_LIST_QUERY_KEY = [...SUPPORT_QUERY_KEY, 'list'] as const;
export const supportTicketQueryKey = (ticketId: string) =>
  [...SUPPORT_QUERY_KEY, 'ticket', ticketId] as const;
export const LOGIN_HELP_BRANCHES_QUERY_KEY = ['auth', 'login-help', 'branches'] as const;

/** What a new query reads its prefill from, the web's own names. */
export const HELP_PARAMS = { CATEGORY: 'category', ATTEMPT: 'attemptId' } as const;

/** A query's status in the student's words, as the web says it: OPEN means it is IACE's turn. */
export const SUPPORT_STATUS_LABEL: Readonly<Record<SupportStatus, string>> = {
  [SUPPORT_STATUSES.OPEN]: 'Waiting on IACE',
  [SUPPORT_STATUSES.ANSWERED]: 'Answered',
  [SUPPORT_STATUSES.CLOSED]: 'Closed',
};

export const SUPPORT_STATUS_BADGE: Readonly<Record<SupportStatus, BadgeVariant>> = {
  [SUPPORT_STATUSES.OPEN]: 'warning',
  [SUPPORT_STATUSES.ANSWERED]: 'success',
  [SUPPORT_STATUSES.CLOSED]: 'neutral',
};

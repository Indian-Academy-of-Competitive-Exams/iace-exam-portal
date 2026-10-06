import {
  BarChart3,
  Bell,
  Bookmark,
  ClipboardList,
  Download,
  KeyRound,
  Trophy,
  User,
} from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
import { ANSWER_STATE, type AnswerState } from '@iace/contracts';
/** App-level string vocabularies. Cross-app ones live in `@iace/contracts`. */

/** Route paths. Referenced by the router, the guards and every navigate(). */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  TESTS: '/tests',
  SERIES: (seriesId: string) => `/series/${seriesId}`,
  SERIES_PATTERN: '/series/:seriesId',
  TEST_ABOUT: (testId: string) => `/tests/${testId}/about`,
  TEST_ABOUT_PATTERN: '/tests/:testId/about',
  /** Outside the shell with the sitting it leads into: the walk up to a paper is not a page to browse. */
  TEST_INSTRUCTIONS: (testId: string) => `/tests/${testId}/instructions`,
  TEST_INSTRUCTIONS_PATTERN: '/tests/:testId/instructions',
  /** Full screen, outside the shell: an exam hall has no navigation out of it. */
  EXAM: (testId: string) => `/tests/${testId}/exam`,
  EXAM_PATTERN: '/tests/:testId/exam',
  /** Where a sitting lands the moment it ends, while the marking job is still running. */
  SUBMITTED: (attemptId: string) => `/attempts/${attemptId}/submitted`,
  SUBMITTED_PATTERN: '/attempts/:attemptId/submitted',
  /** One test, whole: five tabs over the sitting a student is asking about. */
  REPORT: (attemptId: string) => `/attempts/${attemptId}/report`,
  REPORT_PATTERN: '/attempts/:attemptId/report',
  REPORT_TAB: (attemptId: string, tab: string) => `/attempts/${attemptId}/report/${tab}`,
  /** Where a link written before the shell existed lands; each redirects into its tab. */
  SCORE_CARD_PATTERN: '/attempts/:attemptId/score-card',
  REVIEW_PATTERN: '/attempts/:attemptId/review',
  QUESTION_REPORT_PATTERN: '/attempts/:attemptId/questions',
  PERFORMANCE: '/performance',
  LEADERBOARD: '/leaderboard',
  /** Both lists, tabbed: what they starred, and what they got wrong. */
  SAVED: '/saved',
  /** Their own reports, to print or keep. */
  DOWNLOADS: '/downloads',
  NOTIFICATIONS: '/notifications',
  /** Under the bell, so the trail reads Notifications > Settings and the rail stays on the bell. */
  NOTIFICATION_SETTINGS: '/notifications/settings',
  PROFILE: '/profile',
  ACCOUNT: '/account',
  /** React Router's catch-all. */
  NOT_FOUND: '*',
} as const;

/** The exam hall's param naming the sitting that Continue here reclaims. */
export const RESUME_PARAM = 'resume';

export const NAV_ITEMS: readonly NavItem[] = [
  { to: ROUTES.TESTS, label: 'Tests', icon: ClipboardList },
  { to: ROUTES.PERFORMANCE, label: 'Performance', icon: BarChart3 },
  { to: ROUTES.LEADERBOARD, label: 'Leaderboard', icon: Trophy },
  { to: ROUTES.SAVED, label: 'Saved questions', icon: Bookmark },
  { to: ROUTES.DOWNLOADS, label: 'Downloads', icon: Download },
  { to: ROUTES.NOTIFICATIONS, label: 'Notifications', icon: Bell },
];

/** A header picker is sized to its own label; left to itself a Combobox takes the whole header. */
export const PICKER_WIDTH = { REPORT: 'w-[26rem]', SCOPE: 'w-44' } as const;

/** What the worker posts on a push; its twin is PUSH_RECEIVED in public/sw.js, which cannot import. */
export const PUSH_RECEIVED = 'push-received';

/** One page of the bell, and the page size the header count is asked for. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** The VAPID key this browser subscribes with, which is all the settings screen reads. */
export const PUSH_CONFIG_QUERY_KEY = ['me', 'push-subscription'] as const;

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

/** The subject filter choosing no scope means every scope, the way a `choice` filter's blank does. */
export const ANY_SCOPE = '';

/** The five states a question can be in, and the colour the palette draws each one; app-kit names them. */
export const PALETTE_LEGEND: readonly {
  state: AnswerState;
  variant: 'neutral' | 'warning' | 'success' | 'primary' | 'danger';
}[] = [
  { state: ANSWER_STATE.NOT_VISITED, variant: 'neutral' },
  { state: ANSWER_STATE.NOT_ANSWERED, variant: 'danger' },
  { state: ANSWER_STATE.ANSWERED, variant: 'success' },
  { state: ANSWER_STATE.MARKED_REVIEW, variant: 'primary' },
  { state: ANSWER_STATE.ANSWERED_MARKED, variant: 'warning' },
];

/** The account screens, under the user menu, above Log out. */
export const USER_MENU_ITEMS: readonly NavItem[] = [
  { to: ROUTES.PROFILE, label: 'Profile', icon: User },
  { to: ROUTES.ACCOUNT, label: 'Account', icon: KeyRound },
];

/** Browser storage keys owned by this app, namespaced so the SPAs never read each other's; the theme key is absent since it belongs to @iace/ui and is shared. */
export const STORAGE_KEYS = {
  // Named for the app, not the audience: the student portal is a separate SPA on this origin.
  AUTH: 'iace.test.auth',
  /** Per tab, in sessionStorage: what tells the server which tab is answering. */
  TAB: 'iace.test.tab',
  /** Answers a save has not delivered yet, so a reload mid-outage does not lose them. */
  QUEUED_ANSWERS: 'iace.test.queued',
  /** Which page tours this device has been shown; one key holding the set, so a tour added later needs no migration. */
  TOURS: 'iace.test.tours',
} as const;

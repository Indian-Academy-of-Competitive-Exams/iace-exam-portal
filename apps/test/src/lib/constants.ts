import { BarChart3, Bell, Bookmark, ClipboardList, KeyRound, Trophy, User } from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
import {
  ANSWER_STATE,
  LEADERBOARD_MEASURES,
  LEADERBOARD_SCOPES,
  type AnswerState,
  type LeaderboardMeasure,
  type LeaderboardScope,
  type PerformanceScope,
} from '@iace/contracts';
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
  { to: ROUTES.NOTIFICATIONS, label: 'Notifications', icon: Bell },
];

/** A header picker is sized to its own label; left to itself a Combobox takes the whole header. */
export const PICKER_WIDTH = { REPORT: 'w-[26rem]', SCOPE: 'w-44' } as const;

/** The student catalog, cached under one key so a submit can drop it. */
export const CATALOG_QUERY_KEY = ['me', 'catalog'] as const;

/** The window is the server's to choose, so the key has nothing to vary on. */
export const TEST_DAYS_QUERY_KEY = ['me', 'test-days'] as const;

/** The bell's own count, kept apart from the list so paging never disturbs the header. */
export const UNREAD_QUERY_KEY = ['me', 'notifications', 'unread'] as const;

export const notificationsQueryKey = (unreadOnly: boolean) =>
  ['me', 'notifications', { unreadOnly }] as const;

/** What the worker posts on a push; its twin is PUSH_RECEIVED in public/sw.js, which cannot import. */
export const PUSH_RECEIVED = 'push-received';

/** One page of the bell, and the page size the header count is asked for. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** The VAPID key this browser subscribes with, which is all the settings screen reads. */
export const PUSH_CONFIG_QUERY_KEY = ['me', 'push-subscription'] as const;
/** One page of the saved list. The same feed shape as the bell, so the same page. */
export const savedQueryKey = () => ['me', 'saved'] as const;

/** Both filters' options, which span the whole set and so do not move when a page does. */
export const savedFacetsQueryKey = () => ['me', 'saved', 'facets'] as const;

/** What the review reads to draw its stars — one read per sitting, not one per question. */
export const bookmarksInAttemptQueryKey = (attemptId: string) =>
  ['me', 'saved', 'attempts', attemptId] as const;

/** One sitting's marks, and the worked solutions the gate may still be holding back. */
export const scoreCardQueryKey = (attemptId: string) => ['me', 'attempts', attemptId, 'score-card'];

export const questionReportQueryKey = (attemptId: string) =>
  ['me', 'attempts', attemptId, 'question-report'] as const;
export const solutionsQueryKey = (attemptId: string) => ['me', 'attempts', attemptId, 'solutions'];

/** Every test this student has sat, which is what the Performance tab and the landing both read. */
export const PERFORMANCE_QUERY_KEY = ['me', 'performance'] as const;

/** The whole career off the two rollup tables — what Performance opens on. */
export const OVERVIEW_QUERY_KEY = ['me', 'overview'] as const;

/** The subject filter choosing no scope means every scope, the way a `choice` filter's blank does. */
export const ANY_SCOPE = '';

/** One report, keyed by what it is OF — the screen swaps scope and paper without a stale read. */
export const performanceReportQueryKey = (scope: PerformanceScope, scopeId: string) =>
  ['me', 'performance', 'report', scope, scopeId] as const;

/** One board, keyed by what it is OF, so swapping scope or paper never reads a stale one. */
export const leaderboardQueryKey = (scope: LeaderboardScope, scopeId: string) =>
  ['me', 'leaderboard', scope, scopeId] as const;

/** Marks rank one paper; across papers only a percentile does. Both are "the number" on a row. */
export const LEADERBOARD_MEASURE_LABELS: Readonly<Record<LeaderboardMeasure, string>> = {
  [LEADERBOARD_MEASURES.MARKS]: 'Marks',
  [LEADERBOARD_MEASURES.PERCENTILE_POINTS]: 'Points',
};

export const LEADERBOARD_SCOPE_LABELS: Readonly<Record<LeaderboardScope, string>> = {
  [LEADERBOARD_SCOPES.TEST]: 'This test',
  [LEADERBOARD_SCOPES.SERIES]: 'Series points',
  [LEADERBOARD_SCOPES.ALL_TIME]: 'All time',
};

/** What the three podium seats are called. Nobody says "1st" about a topper. */
export const PODIUM_LABELS: Readonly<Record<number, string>> = {
  1: 'Topper',
  2: '2nd',
  3: '3rd',
};

/** The series the SERIES scope may be asked about, which only a sitting puts on the list. */
export const PERFORMANCE_SERIES_QUERY_KEY = ['me', 'performance', 'series'] as const;

/** What a test covers, read before the clock starts. */
export const briefQueryKey = (testId: string) => ['me', 'tests', testId, 'brief'];

/** The five states a question can be in, and the colour the palette draws each one. */
export const PALETTE_LEGEND: readonly {
  state: AnswerState;
  label: string;
  variant: 'neutral' | 'warning' | 'success' | 'primary' | 'danger';
}[] = [
  { state: ANSWER_STATE.NOT_VISITED, label: 'Not visited', variant: 'neutral' },
  { state: ANSWER_STATE.NOT_ANSWERED, label: 'Not answered', variant: 'danger' },
  { state: ANSWER_STATE.ANSWERED, label: 'Answered', variant: 'success' },
  { state: ANSWER_STATE.MARKED_REVIEW, label: 'Marked for review', variant: 'primary' },
  { state: ANSWER_STATE.ANSWERED_MARKED, label: 'Answered and marked', variant: 'warning' },
];

/** The account screens, under the user menu, above Log out. */
export const USER_MENU_ITEMS: readonly NavItem[] = [
  { to: ROUTES.PROFILE, label: 'Profile', icon: User },
  { to: ROUTES.ACCOUNT, label: 'Account', icon: KeyRound },
];

/** The signed-in student's identity, cached under one key. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** The student's RECORD — profile and photo. A different key from the identity above. */
export const PROFILE_QUERY_KEY = ['me'] as const;

/** Where this student is signed in, for the Account page's Active devices list. */
export const ACTIVE_DEVICES_QUERY_KEY = ['me', 'sessions'] as const;

/** localStorage keys owned by this app, namespaced so the SPAs never read each other's; the theme key is absent since it belongs to @iace/ui and is shared. */
export const STORAGE_KEYS = {
  // Named for the app, not the audience: the student portal is a separate SPA on this origin.
  AUTH: 'iace.test.auth',
  /** Per tab, in sessionStorage: what tells the server which tab is answering. */
  TAB: 'iace.test.tab',
  /** Answers a save has not delivered yet, so a reload mid-outage does not lose them. */
  QUEUED_ANSWERS: 'iace.test.queued',
} as const;

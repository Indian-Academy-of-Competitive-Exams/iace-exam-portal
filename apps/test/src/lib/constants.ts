import { BarChart3, ClipboardList, Gift, KeyRound, User } from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
import { type BadgeProps } from '@iace/ui';
import {
  ANSWER_STATE,
  MASTERY_TRENDS,
  PERFORMANCE_SCOPES,
  type AnswerState,
  type LanguageCode,
  type MasteryTrend,
  type PerformanceScope,
} from '@iace/contracts';
/** App-level string vocabularies. Cross-app ones live in `@iace/contracts`. */

/** Route paths. Referenced by the router, the guards and every navigate(). */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  TESTS: '/tests',
  BROWSE: '/free-tests',
  SERIES: (seriesId: string) => `/series/${seriesId}`,
  SERIES_PATTERN: '/series/:seriesId',
  TEST_ABOUT: (testId: string) => `/tests/${testId}/about`,
  TEST_ABOUT_PATTERN: '/tests/:testId/about',
  TEST_INSTRUCTIONS: (testId: string) => `/tests/${testId}/instructions`,
  TEST_INSTRUCTIONS_PATTERN: '/tests/:testId/instructions',
  /** Full screen, outside the shell: an exam hall has no navigation out of it. */
  EXAM: (testId: string) => `/tests/${testId}/exam`,
  EXAM_PATTERN: '/tests/:testId/exam',
  /** Where a sitting lands the moment it ends, while the marking job is still running. */
  SUBMITTED: (attemptId: string) => `/attempts/${attemptId}/submitted`,
  SUBMITTED_PATTERN: '/attempts/:attemptId/submitted',
  SCORE_CARD: (attemptId: string) => `/attempts/${attemptId}/score-card`,
  SCORE_CARD_PATTERN: '/attempts/:attemptId/score-card',
  REVIEW: (attemptId: string) => `/attempts/${attemptId}/review`,
  REVIEW_PATTERN: '/attempts/:attemptId/review',
  PERFORMANCE: '/performance',
  PROFILE: '/profile',
  ACCOUNT: '/account',
  /** React Router's catch-all. */
  NOT_FOUND: '*',
} as const;

export const NAV_ITEMS: readonly NavItem[] = [
  { to: ROUTES.TESTS, label: 'Tests', icon: ClipboardList },
  { to: ROUTES.PERFORMANCE, label: 'Performance', icon: BarChart3 },
  { to: ROUTES.BROWSE, label: 'Free tests', icon: Gift },
];

/** The student catalog, cached under one key so a submit can drop it. */
export const CATALOG_QUERY_KEY = ['me', 'catalog'] as const;

/** One sitting's marks, and the worked solutions the gate may still be holding back. */
export const scoreCardQueryKey = (attemptId: string) => ['me', 'attempts', attemptId, 'score-card'];
export const solutionsQueryKey = (attemptId: string) => ['me', 'attempts', attemptId, 'solutions'];
export const analyticsQueryKey = (attemptId: string) => ['me', 'attempts', attemptId, 'analytics'];

/** Every test this student has sat, which is what the Performance tab and the landing both read. */
export const PERFORMANCE_QUERY_KEY = ['me', 'performance'] as const;

/** One report, keyed by what it is OF — the screen swaps scope and paper without a stale read. */
export const performanceReportQueryKey = (scope: PerformanceScope, scopeId: string) =>
  ['me', 'performance', 'report', scope, scopeId] as const;

/** Three of the four: ATTEMPT is a single sitting, which the score card already opens on. */
export const PERFORMANCE_SCOPE_LABELS: Readonly<Record<string, string>> = {
  [PERFORMANCE_SCOPES.TEST]: 'This test',
  [PERFORMANCE_SCOPES.SERIES]: 'This series',
  [PERFORMANCE_SCOPES.ALL_TIME]: 'All time',
};

/** The series the SERIES scope may be asked about, which only a sitting puts on the list. */
export const PERFORMANCE_SERIES_QUERY_KEY = ['me', 'performance', 'series'] as const;

/** Chart series slots run 1..8 and are assigned, never cycled — a ninth subject shares the last. */
export const SERIES_SLOT_COUNT = 8;

export const MASTERY_TREND_LABELS: Readonly<Record<MasteryTrend, string>> = {
  [MASTERY_TRENDS.RISING]: 'Rising',
  [MASTERY_TRENDS.STEADY]: 'Steady',
  [MASTERY_TRENDS.SLIDING]: 'Sliding',
};

export const MASTERY_TREND_BADGE: Readonly<Record<MasteryTrend, BadgeProps['variant']>> = {
  [MASTERY_TRENDS.RISING]: 'success',
  [MASTERY_TRENDS.STEADY]: 'neutral',
  [MASTERY_TRENDS.SLIDING]: 'warning',
};

/** Difficulty bands as the report keys them: `DifficultyStanding.name` carries the enum value. */
export const DIFFICULTY_LABELS: Readonly<Record<string, string>> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

/** What a test covers, read before the clock starts. */
export const briefQueryKey = (testId: string) => ['me', 'tests', testId, 'brief'];

/** The free series they could ask for, which an ask changes. */
export const BROWSE_QUERY_KEY = ['me', 'open-series'] as const;

/** The languages a paper can be sat in, in the words the exam world uses for them. */
export const LANGUAGE_LABELS: Readonly<Record<LanguageCode, string>> = {
  EN: 'English',
  HI: 'Hindi',
  TE: 'Telugu',
};

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
  { to: ROUTES.ACCOUNT, label: 'Change PIN', icon: KeyRound },
];

/** The signed-in student's identity, cached under one key. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** The student's RECORD — profile and photo. A different key from the identity above. */
export const PROFILE_QUERY_KEY = ['me'] as const;

/**
 * localStorage keys owned by this app, namespaced so the SPAs never read each other's.
 * The theme key is absent on purpose: it belongs to @iace/ui and is shared.
 */
export const STORAGE_KEYS = {
  // Named for the app, not the audience: the student portal is a separate SPA on this origin.
  AUTH: 'iace.test.auth',
} as const;

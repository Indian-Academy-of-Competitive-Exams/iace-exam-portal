import { BarChart3, ClipboardList, Gift, KeyRound, User } from 'lucide-react';
import { type NavItem } from '@iace/app-kit';
import { ANSWER_STATE, type AnswerState, type LanguageCode } from '@iace/contracts';
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

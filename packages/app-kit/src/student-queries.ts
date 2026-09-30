/** Every read both student clients cache, keyed once, so web and mobile can never cache one read twice. */
import { queryOptions } from '@tanstack/react-query';
import { type LanguageCode, type LeaderboardScope } from '@iace/contracts';
import { type AppApiClient } from './api-client';
import { isBriefRefused } from './catalog';
import { isMarkingPending } from './marking';

/** The signed-in student's identity. */
export const ME_QUERY_KEY = ['auth', 'me'] as const;

/** The one root every read below hangs off, spelled once: a second copy is a cache nobody can invalidate whole. */
const ME = 'me';

/** The student's RECORD — profile and photo; under its own leaf, since the root prefixes every read below. */
export const PROFILE_QUERY_KEY = [ME, 'profile'] as const;

/** The student catalog, cached under one key so a submit can drop it. */
export const CATALOG_QUERY_KEY = [ME, 'catalog'] as const;

/** The window is the server's to choose, so the key has nothing to vary on. */
export const TEST_DAYS_QUERY_KEY = [ME, 'test-days'] as const;

/** Both lists and the bell's count, which a read moves together. */
export const NOTIFICATIONS_QUERY_KEY = [ME, 'notifications'] as const;

/** The bell's own count, kept apart from the list so paging never disturbs it. */
export const UNREAD_QUERY_KEY = [...NOTIFICATIONS_QUERY_KEY, 'unread'] as const;

export const notificationsQueryKey = (unreadOnly: boolean) =>
  [...NOTIFICATIONS_QUERY_KEY, { unreadOnly }] as const;

/** Every saved question, and the prefix the two reads below share so one toggle moves them together. */
const SAVED_QUERY_KEY = [ME, 'saved'] as const;

export const savedQueryKey = () => SAVED_QUERY_KEY;

/** Both filters' options, which span the whole set and so do not move when a page does. */
export const savedFacetsQueryKey = () => [...SAVED_QUERY_KEY, 'facets'] as const;

/** What the review reads to draw its stars — one read per sitting, not one per question. */
export const bookmarksInAttemptQueryKey = (attemptId: string) =>
  [...SAVED_QUERY_KEY, 'attempts', attemptId] as const;

const attemptQueryKey = (attemptId: string) => [ME, 'attempts', attemptId] as const;

export const scoreCardQueryKey = (attemptId: string) =>
  [...attemptQueryKey(attemptId), 'score-card'] as const;

export const solutionsQueryKey = (attemptId: string) =>
  [...attemptQueryKey(attemptId), 'solutions'] as const;

export const questionReportQueryKey = (attemptId: string) =>
  [...attemptQueryKey(attemptId), 'question-report'] as const;

/** Every test this student has sat. */
export const PERFORMANCE_QUERY_KEY = [ME, 'performance'] as const;

/** The whole career off the two rollup tables — what Performance opens on. */
export const OVERVIEW_QUERY_KEY = [ME, 'overview'] as const;

/** The series the SERIES board may be asked about, which only a sitting puts on the list. */
export const PERFORMANCE_SERIES_QUERY_KEY = [...PERFORMANCE_QUERY_KEY, 'series'] as const;

export const leaderboardQueryKey = (scope: LeaderboardScope, scopeId: string) =>
  [ME, 'leaderboard', scope, scopeId] as const;

/** What a test covers, read before the clock starts. */
export const briefQueryKey = (testId: string) => [ME, 'tests', testId, 'brief'] as const;

/** The session call doubles as the reachability check — its success proves both facts at once. */
export const SYSTEM_CHECK_QUERY_KEY = [ME, 'system-check'] as const;

/** Where this account is signed in. */
export const ACTIVE_DEVICES_QUERY_KEY = [ME, 'sessions'] as const;

/** The sitting, keyed by TEST, so a refetch can never be a second start. */
export const startedAttemptQueryKey = (testId: string) => [ME, 'attempt', testId] as const;

/** The paper an attempt draws, stamped with when it landed. */
export const attemptPaperQueryKey = (attemptId: string) =>
  [ME, 'attempt-paper', attemptId] as const;

/** One test's shared paper, keyed by the resolved languages — it is held before any sitting exists. */
export const testPaperQueryKey = (testId: string, languages: readonly string[]) =>
  [ME, 'test-paper', testId, [...languages].sort((a, b) => a.localeCompare(b)).join(',')] as const;

/** The reads several screens share, over whichever client the app built; each screen draws its own expected refusal. */
export function createStudentQueries(api: AppApiClient) {
  return {
    catalogQuery: queryOptions({ queryKey: CATALOG_QUERY_KEY, queryFn: () => api.me.catalog() }),
    overviewQuery: queryOptions({ queryKey: OVERVIEW_QUERY_KEY, queryFn: () => api.me.overview() }),
    performanceQuery: queryOptions({
      queryKey: PERFORMANCE_QUERY_KEY,
      queryFn: () => api.me.performance(),
    }),
    testPaperQuery: (testId: string, languages: readonly LanguageCode[]) =>
      queryOptions({
        queryKey: testPaperQueryKey(testId, languages),
        queryFn: () => api.me.testPaper(testId, languages),
        // A sat paper cannot change, so what was held while they read is what they sit.
        staleTime: Infinity,
      }),
    briefQuery: (testId: string) =>
      queryOptions({
        queryKey: briefQueryKey(testId),
        queryFn: () => api.me.testBrief(testId),
        meta: { silent: isBriefRefused },
      }),
    scoreCardQuery: (attemptId: string) =>
      queryOptions({
        queryKey: scoreCardQueryKey(attemptId),
        queryFn: () => api.me.scoreCard(attemptId),
        meta: { silent: isMarkingPending },
      }),
    solutionsQuery: (attemptId: string) =>
      queryOptions({
        queryKey: solutionsQueryKey(attemptId),
        queryFn: () => api.me.solutions(attemptId),
        meta: { silent: isMarkingPending },
      }),
    questionReportQuery: (attemptId: string) =>
      queryOptions({
        queryKey: questionReportQueryKey(attemptId),
        queryFn: () => api.me.questionReport(attemptId),
        meta: { silent: isMarkingPending },
      }),
  };
}

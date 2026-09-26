import { type TourStep } from '@iace/app-kit';

/** One id per tour. It is what `seenTours` stores, so renaming one shows that tour again. */
export const TOUR_IDS = {
  TESTS: 'tests',
  TEST_ABOUT: 'test-about',
  PERFORMANCE: 'performance',
  REPORT: 'report',
  LEADERBOARD: 'leaderboard',
  SAVED: 'saved',
} as const;

/** The `data-tour` values each tour points at. A step and its attribute read the same constant, so they cannot drift. */
export const TOUR_TARGETS = {
  SERIES_SHELF: 'series-shelf',
  TEST_STATE: 'test-state',
  TEST_PATTERN: 'test-pattern',
  TEST_ACTION: 'test-action',
} as const;

export const TESTS_TOUR: readonly TourStep[] = [
  {
    target: TOUR_TARGETS.SERIES_SHELF,
    title: 'One shelf per series',
    body: 'Every test your branch has opened to you sits under the series it belongs to, and the name opens the whole series.',
  },
  {
    target: TOUR_TARGETS.TEST_STATE,
    title: 'Where a paper stands',
    body: 'Open now, In progress, Done or Scheduled — and once you have sat it, your percentile beside it.',
  },
  {
    target: TOUR_TARGETS.TEST_PATTERN,
    title: 'The pattern, before you start',
    body: 'Sections, questions and duration in minutes, exactly as the paper is built.',
  },
  {
    target: TOUR_TARGETS.TEST_ACTION,
    title: 'Starting, and coming back',
    body: 'Start test opens the instructions rather than the paper; Resume returns you to a sitting still running.',
  },
];

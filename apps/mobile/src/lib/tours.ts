import { type TourStep } from '@iace/app-kit';

/** One id per tour. It is what `seenTours` stores, so renaming one shows that tour again. */
export const TOUR_IDS = {
  TESTS: 'tests',
  TEST_ABOUT: 'test-about',
  PERFORMANCE: 'performance',
  REPORT: 'report',
  SAVED: 'saved',
} as const;

/** The keys `useTourTarget` registers under. A step and its target read the same constant, so they cannot drift. */
export const TOUR_TARGETS = {
  TESTS_FILTERS: 'tests-filters',
  SERIES_SHELF: 'series-shelf',
  ABOUT_BAND: 'about-band',
  ABOUT_SECTIONS: 'about-sections',
  ABOUT_PAPER: 'about-paper',
  PERFORMANCE_VIEWS: 'performance-views',
  PERFORMANCE_PANEL: 'performance-panel',
  REPORT_TABS: 'report-tabs',
  SAVED_FILTERS: 'saved-filters',
  SAVED_SUMMARY: 'saved-summary',
} as const;

export const TESTS_TOUR: readonly TourStep[] = [
  {
    target: TOUR_TARGETS.SERIES_SHELF,
    title: 'One shelf per series',
    body: 'Every test your branch has opened to you sits under its series, and each card says where that paper stands.',
  },
  {
    target: TOUR_TARGETS.TESTS_FILTERS,
    title: 'Finding one paper',
    body: 'Search by name, or narrow to a course, a series or the tests open right now.',
  },
];

export const TEST_ABOUT_TOUR: readonly TourStep[] = [
  {
    target: TOUR_TARGETS.ABOUT_BAND,
    title: 'What the paper costs you',
    body: 'Questions, duration in minutes and total marks, all before you commit to a sitting.',
  },
  {
    target: TOUR_TARGETS.ABOUT_SECTIONS,
    title: 'Section by section',
    body: 'Each section with its own question count, marks per question and negative marking.',
  },
  {
    target: TOUR_TARGETS.ABOUT_PAPER,
    title: 'Languages and sectional timing',
    body: 'Which languages the paper is offered in, and whether each section has a clock of its own.',
  },
];

export const PERFORMANCE_TOUR: readonly TourStep[] = [
  {
    target: TOUR_TARGETS.PERFORMANCE_VIEWS,
    title: 'Your record, and the board',
    body: 'Overview is your own career; Leaderboard is where it stands against everyone who sat the same paper.',
  },
  {
    target: TOUR_TARGETS.PERFORMANCE_PANEL,
    title: 'Where the marks went',
    body: 'Your standing, your weakest subjects and the trend across every sitting the institute has marked.',
  },
];

export const REPORT_TOUR: readonly TourStep[] = [
  {
    target: TOUR_TARGETS.REPORT_TABS,
    title: 'Views of one sitting',
    body: 'The score card, your answers against the solutions, and how this sitting compares with your others.',
  },
];

export const SAVED_TOUR: readonly TourStep[] = [
  {
    target: TOUR_TARGETS.SAVED_FILTERS,
    title: 'What lands here',
    body: 'Questions you starred while reading a solution, kept until you drop them.',
  },
  {
    target: TOUR_TARGETS.SAVED_SUMMARY,
    title: 'Narrowing the set',
    body: 'Subject and test offer only what your own saved questions span, so no choice here finds nothing.',
  },
];

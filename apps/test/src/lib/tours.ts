import { type TourStep } from '@iace/app-kit';
import { TOUR_ANCHORS } from '@iace/ui';

/** One id per tour. It is what `seenTours` stores, so renaming one shows that tour again. */
export const TOUR_IDS = {
  TESTS: 'tests',
  TEST_ABOUT: 'test-about',
  PERFORMANCE: 'performance',
  REPORT: 'report',
  LEADERBOARD: 'leaderboard',
  SAVED: 'saved',
} as const;

/** The `data-tour` values these tours point at. A step and its attribute read the same constant, so they cannot drift. */
export const TOUR_TARGETS = {
  SERIES_SHELF: 'series-shelf',
  TEST_STATE: 'test-state',
  TEST_PATTERN: 'test-pattern',
  TEST_ACTION: 'test-action',
  ABOUT_BAND: 'about-band',
  ABOUT_SECTIONS: 'about-sections',
  ABOUT_PAPER: 'about-paper',
  ABOUT_EXIT: 'about-exit',
  PERFORMANCE_PICKERS: 'performance-pickers',
  PERFORMANCE_HERO: 'performance-hero',
  PERFORMANCE_FIGURES: 'performance-figures',
  REPORT_PICKER: 'report-picker',
  LEADERBOARD_PODIUM: 'leaderboard-podium',
  LEADERBOARD_RANKS: 'leaderboard-ranks',
  SAVED_NOTE: 'saved-note',
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

export const TEST_ABOUT_TOUR: readonly TourStep[] = [
  {
    target: TOUR_TARGETS.ABOUT_BAND,
    title: 'What the paper costs you',
    body: 'Questions, duration in minutes, total marks and the negative marking, all before you commit to a sitting.',
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
  {
    target: TOUR_TARGETS.ABOUT_EXIT,
    title: 'Nothing here starts the clock',
    body: 'Proceed to test opens the instructions, and the last button there is what begins your sitting.',
  },
];

export const PERFORMANCE_TOUR: readonly TourStep[] = [
  {
    target: TOUR_TARGETS.PERFORMANCE_PICKERS,
    title: 'Scope, and one test',
    body: 'The left picker reads every figure below through one scope; the right one opens a single sitting.',
  },
  {
    target: TOUR_TARGETS.PERFORMANCE_HERO,
    title: 'Your standing',
    body: 'Your percentile across every sitting the institute has marked, beside the pace you set in them.',
  },
  {
    target: TOUR_TARGETS.PERFORMANCE_FIGURES,
    title: 'Where the marks went',
    body: 'Weakest subjects, your score trend and how your time returned marks — each reading the scope you chose above.',
  },
];

export const REPORT_TOUR: readonly TourStep[] = [
  {
    target: TOUR_ANCHORS.TABS,
    title: 'Five views of one sitting',
    body: 'Score card, Subject report, Solution report, Question report and Compare, all of the same paper.',
  },
  {
    target: TOUR_TARGETS.REPORT_PICKER,
    title: 'Another sitting, same view',
    body: 'Switching tests here keeps the tab you are reading, so you can compare the same view across papers.',
  },
];

export const LEADERBOARD_TOUR: readonly TourStep[] = [
  {
    target: TOUR_ANCHORS.FILTERS,
    title: 'Which board you are on',
    body: 'One test, a series or all time — and the board redraws for whichever you pick.',
  },
  {
    target: TOUR_TARGETS.LEADERBOARD_PODIUM,
    title: 'The top of the board',
    body: 'The three highest marks in the cohort that sat this, whether or not you are among them.',
  },
  {
    target: TOUR_TARGETS.LEADERBOARD_RANKS,
    title: 'Your own row',
    body: 'The full order, with your row marked wherever in it you fall.',
  },
];

export const SAVED_TOUR: readonly TourStep[] = [
  {
    target: TOUR_TARGETS.SAVED_NOTE,
    title: 'What lands here',
    body: 'Questions you starred while reading a solution, kept until you drop them.',
  },
  {
    target: TOUR_ANCHORS.FILTERS,
    title: 'Narrowing the set',
    body: 'Subject and test offer only what your own saved questions span, so no choice here finds nothing.',
  },
];

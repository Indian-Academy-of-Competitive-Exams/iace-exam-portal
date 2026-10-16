/**
 * A standing paper for the railway skin, so the screen can be looked at without a
 * sitting. Shape only — nothing here reaches the API, and it is imported by the
 * DEV-only preview route alone.
 */
import {
  ANSWER_STATE,
  EXAM_TEMPLATE,
  LANGUAGE_CODE,
  LANGUAGE_MODE,
  NAVIGATION_POLICY,
  SUPPORTED_LANGUAGES,
  QUESTION_TYPE,
  TEST_UI,
  paletteCounts,
  type ExamBrief,
  type ExamQuestion,
  type LiveAnswer,
} from '@iace/contracts';
import { TIMER_KIND, type ExamView } from '@iace/app-kit';

const PAPER_SEC = 90 * 60;
const SECTION_ID = 'sec-alp';
const QUESTION_COUNT = 70;
const SECTION = {
  id: SECTION_ID,
  name: 'ALP',
  order: 0,
  questionCount: QUESTION_COUNT,
  durationSec: null,
};

const STEMS: readonly string[] = [
  'Simplify: (√6 − 2√3)²',
  'Which agent produces a local or general loss of sensation?',
  'According to Mendeleev’s periodic law, the elements were arranged in the periodic table in the order of ________',
  'In the given figure, the circle represents educated, the rectangle represents unemployed and the square represents villagers. Which region represents villagers and educated but not an unemployed?',
  'Lactose is composed of _______ and glucose.',
  'What is the LCM of 6(xy − y), 8 (x²y−xy)?',
  'Find the smallest three-digit number that is exactly divisible by 12, 15 and 24.',
  'Simplify: cos (30°−A) − cos (30° + A)',
  'Sound travels in a medium as a _________',
  'The reaction of sodium sulphate and barium chloride solution is an example of _________',
  'Who was the Governor General of India during the Sepoy Mutiny?',
];

const OPTIONS: readonly (readonly string[])[] = [
  ['18 + 2√12', '18 − 2√12', '18 + 12√2', '18 − 12√2'],
  ['Analgesic', 'Anaesthetic', 'Antipyretic', 'Antibiotic'],
  [
    'Increasing atomic masses',
    'Decreasing atomic masses',
    'Decreasing atomic number',
    'Increasing atomic number',
  ],
  ['2', '3', '4', '1'],
  ['Galactose', 'Fructose', 'Maltose', 'Sucrose'],
  ['8xy(x − 1)', '24xy(x − 1)', '24y(x − 1)', '8y(x − 1)'],
  ['120', '180', '240', '360'],
  ['sin A', '2 sin A', 'cos A', '2 cos A'],
  ['Transverse wave', 'Longitudinal wave', 'Electromagnetic wave', 'Standing wave'],
  [
    'Displacement reaction',
    'Double displacement reaction',
    'Combination reaction',
    'Decomposition reaction',
  ],
  ['Lord Dalhousie', 'Lord Canning', 'Lord Ripon', 'Lord Curzon'],
];

const rich = (text: string) => [{ type: 'TEXT' as const, text }];

const PASSAGE_QUESTIONS = 3;
const PASSAGE =
  '<p>Directions: Read the passage and answer the questions that follow.</p>' +
  '<p>The Indian Railways carried its first passengers in April 1853, over thirty-four kilometres of track between Bombay and Thane. Within fifty years the network had grown past forty thousand kilometres, built largely by private companies working under a guarantee from the Crown, each of which chose its own gauge. The result was a country crossed by lines that could not exchange wagons: goods moving from the cotton districts to the ports were unloaded and reloaded wherever two gauges met, and every such break added a day and a share of the cargo lost to handling.</p>' +
  '<p>Project Unigauge, begun in 1992, set out to convert the metre and narrow gauge routes to broad gauge. It has been slow and costly work, but each converted section has brought through trains, heavier loads and higher speeds to districts that had been served for a century by a branch line and a change of train.</p>';

const PREVIEW_QUESTIONS: readonly ExamQuestion[] = Array.from(
  { length: QUESTION_COUNT },
  (_, index) => ({
    questionId: `q-${index + 1}`,
    order: index,
    baseConfigSectionId: SECTION_ID,
    type: QUESTION_TYPE.SINGLE_MCQ,
    marks: 1,
    negativeMarks: 0.33,
    content: {
      [SUPPORTED_LANGUAGES.EN]: {
        stem: rich(STEMS[index % STEMS.length] ?? ''),
        ...(index < PASSAGE_QUESTIONS ? { passage: rich(PASSAGE) } : {}),
      },
    },
    options: (OPTIONS[index % OPTIONS.length] ?? []).map((text, position) => ({
      id: `q-${index + 1}-o-${position}`,
      position,
      text: { [SUPPORTED_LANGUAGES.EN]: rich(text) },
    })),
  }),
);

const answer = (state: LiveAnswer['state'], selectedOptionId: string | null): LiveAnswer => ({
  state,
  selectedOptionId,
  typedAnswer: null,
  timeSpentSec: 12,
  answeredAt: null,
  firstActionAt: null,
});

/** One question in each state, so the palette shows all five without any clicking. */
const PREVIEW_ANSWERS: Readonly<Record<string, LiveAnswer>> = {
  'q-1': answer(ANSWER_STATE.ANSWERED, 'q-1-o-0'),
  'q-2': answer(ANSWER_STATE.MARKED_REVIEW, null),
  'q-3': answer(ANSWER_STATE.ANSWERED_MARKED, 'q-3-o-0'),
  'q-4': answer(ANSWER_STATE.NOT_ANSWERED, null),
};

export function previewView(): ExamView {
  const counts = paletteCounts(
    PREVIEW_QUESTIONS.map((row) => row.questionId),
    PREVIEW_ANSWERS,
  );
  const noop = () => undefined;

  return {
    title: 'RRB JE CBT I 26TH MAY 2019 SHIFT - 3',
    watermark: 'Developer IACE',
    languages: [LANGUAGE_CODE.EN],
    languageMode: LANGUAGE_MODE.SINGLE,
    testUi: TEST_UI.CBT,

    sections: [SECTION],
    sectionId: SECTION_ID,
    reachable: [SECTION_ID],
    forwardOnly: false,
    sectional: false,

    questions: PREVIEW_QUESTIONS,
    question: PREVIEW_QUESTIONS[1],
    questionIndex: 1,
    selectedOptionId: null,
    typedAnswer: '',
    answersLoaded: true,
    marked: false,
    answers: PREVIEW_ANSWERS,
    counts,
    sectionCounts: () => counts,

    timer: {
      kind: TIMER_KIND.PAPER,
      clock: {
        endsAt: new Date(Date.now() + PAPER_SEC * 1000).toISOString(),
        serverNow: new Date().toISOString(),
        arrivedAt: Date.now(),
      },
      onExpire: noop,
    },

    isSaving: false,
    hasUnsaved: false,
    hasUnsent: () => false,
    leave: noop,
    takenOver: false,
    setAside: false,
    ended: false,
    locked: null,

    openQuestion: noop,
    canOpen: () => true,
    nextQuestion: noop,
    chooseOption: noop,
    typeAnswer: noop,
    bubbleAnswer: noop,
    markAndNext: noop,
    toggleMark: noop,
    saveNow: () => Promise.resolve(true),
    clearResponse: noop,
    openSection: noop,
    submitSection: null,

    submit: {
      asking: false,
      isPending: false,
      failed: false,
      unanswered: QUESTION_COUNT - 2,
      markedForReview: 2,
      ask: noop,
      cancel: noop,
      confirm: noop,
      retry: noop,
    },
    fullscreen: {
      nagging: false,
      isFullscreen: false,
      isSupported: true,
      exits: 0,
      enter: noop,
      ignore: noop,
    },
  };
}

export function previewBrief(): ExamBrief {
  return {
    testId: 'preview',
    title: 'RRB JE CBT I 26TH MAY 2019 SHIFT - 3',
    examTemplate: EXAM_TEMPLATE.RAILWAYS,
    navigation: NAVIGATION_POLICY.FREE,
    durationSec: PAPER_SEC,
    totalQuestions: QUESTION_COUNT,
    languageMode: LANGUAGE_MODE.SINGLE,
    languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI],
    sections: [{ ...SECTION, marksPerQuestion: 1, negativeMarks: 0.33 }],
  };
}

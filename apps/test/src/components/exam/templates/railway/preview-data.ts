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
import { type ExamView } from '@iace/app-kit';

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

export const PREVIEW_QUESTIONS: readonly ExamQuestion[] = Array.from(
  { length: QUESTION_COUNT },
  (_, index) => ({
    questionId: `q-${index + 1}`,
    order: index,
    baseConfigSectionId: SECTION_ID,
    type: QUESTION_TYPE.SINGLE_MCQ,
    marks: 1,
    negativeMarks: 0.33,
    content: { [SUPPORTED_LANGUAGES.EN]: { stem: rich(STEMS[index % STEMS.length] ?? '') } },
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
export const PREVIEW_ANSWERS: Readonly<Record<string, LiveAnswer>> = {
  'q-1': answer(ANSWER_STATE.ANSWERED, 'q-1-o-0'),
  'q-2': answer(ANSWER_STATE.MARKED_REVIEW, null),
  'q-3': answer(ANSWER_STATE.ANSWERED_MARKED, 'q-3-o-0'),
  'q-4': answer(ANSWER_STATE.NOT_ANSWERED, null),
};

export function previewView(): ExamView {
  const questionIds = PREVIEW_QUESTIONS.map((row) => row.questionId);
  const noop = () => undefined;

  return {
    title: 'RRB JE CBT I 26TH MAY 2019 SHIFT - 3',
    watermark: 'Developer IACE',
    languages: [LANGUAGE_CODE.EN],
    languageMode: LANGUAGE_MODE.SINGLE,
    testUi: TEST_UI.CBT,

    sections: [SECTION],
    effort: [],
    sectionId: SECTION_ID,
    section: SECTION,
    reachable: [SECTION_ID],
    sectional: false,
    forwardOnly: false,

    questions: PREVIEW_QUESTIONS,
    question: PREVIEW_QUESTIONS[3],
    questionIndex: 3,
    selectedOptionId: null,
    marked: false,
    answers: PREVIEW_ANSWERS,
    counts: paletteCounts(questionIds, PREVIEW_ANSWERS),
    sectionCounts: { [SECTION_ID]: paletteCounts(questionIds, PREVIEW_ANSWERS) },

    clock: {
      endsAt: new Date(Date.now() + PAPER_SEC * 1000).toISOString(),
      serverNow: new Date().toISOString(),
      arrivedAt: Date.now(),
    },
    sectionSec: null,

    isSaving: false,
    hasUnsaved: false,
    takenOver: false,

    openQuestion: noop,
    canOpen: () => true,
    nextQuestion: noop,
    chooseOption: noop,
    bubbleAnswer: noop,
    markAndNext: noop,
    clearResponse: noop,
    openSection: noop,
    endSection: noop,
    outOfTime: noop,

    submit: {
      asking: false,
      isPending: false,
      unanswered: QUESTION_COUNT - 2,
      markedForReview: 2,
      ask: noop,
      cancel: noop,
      confirm: noop,
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
    examTemplate: EXAM_TEMPLATE.SSC_RAILWAYS,
    navigation: NAVIGATION_POLICY.FREE,
    durationSec: PAPER_SEC,
    totalQuestions: QUESTION_COUNT,
    languageMode: LANGUAGE_MODE.SINGLE,
    languages: [LANGUAGE_CODE.EN, LANGUAGE_CODE.HI],
    sections: [{ ...SECTION, marksPerQuestion: 1, negativeMarks: 0.33 }],
  };
}

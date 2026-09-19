import {
  ANSWER_MODE,
  type ANSWER_MODES,
  type DIFFICULTY_LEVELS,
  LANGUAGE_ORDER,
  MCQ_OPTION_COUNT,
  QUESTION_TYPE,
  type QUESTION_TYPES,
  TAG_SEPARATOR,
  hasText,
  plainTextOf,
  type QuestionDetail,
  type QuestionDraftInput,
  type QuestionLanguage,
} from '@iace/contracts';

/** One question as the boxes hold it, and the draft the API takes, in both directions. */

type LanguageMap = Record<QuestionLanguage, string>;

export interface QuestionFormValues {
  type: (typeof QUESTION_TYPES)[number];
  subjectId: string;
  topicId: string;
  difficulty: (typeof DIFFICULTY_LEVELS)[number];
  questionCode: string;
  tags: string;
  correctOption: string;
  stem: LanguageMap;
  solution: LanguageMap;
  options: { text: LanguageMap }[];
  answerMode: (typeof ANSWER_MODES)[number];
  answers: LanguageMap;
  tolerance: string;
}

const emptyLanguages = (): LanguageMap => ({ en: '', hi: '', te: '' });

export function emptyValues(): QuestionFormValues {
  return {
    type: QUESTION_TYPE.SINGLE_MCQ,
    subjectId: '',
    topicId: '',
    difficulty: 'MEDIUM',
    questionCode: '',
    tags: '',
    correctOption: '1',
    stem: emptyLanguages(),
    solution: emptyLanguages(),
    options: Array.from({ length: MCQ_OPTION_COUNT }, () => ({ text: emptyLanguages() })),
    answerMode: ANSWER_MODE.EXACT,
    answers: emptyLanguages(),
    tolerance: '',
  };
}

/** Reads a saved question back into the boxes it was typed in. */
export function valuesOf(question: QuestionDetail): QuestionFormValues {
  const stem = emptyLanguages();
  const solution = emptyLanguages();
  for (const language of LANGUAGE_ORDER) {
    stem[language] = plainTextOf(question.content[language]?.stem);
    solution[language] = plainTextOf(question.content[language]?.solution);
  }

  const slots = Math.max(question.options.length, MCQ_OPTION_COUNT);
  const options = Array.from({ length: slots }, (_, index) => {
    const saved = question.options.find((option) => option.position === index + 1);
    const text = emptyLanguages();
    for (const language of LANGUAGE_ORDER) text[language] = plainTextOf(saved?.text[language]);
    return { text };
  });

  const answers = emptyLanguages();
  for (const language of LANGUAGE_ORDER) {
    answers[language] = question.answerKey?.answers[language] ?? '';
  }

  return {
    type: question.type,
    subjectId: question.subject.id,
    topicId: question.topic?.id ?? '',
    difficulty: question.difficulty,
    questionCode: question.questionCode ?? '',
    tags: question.tags.join(`${TAG_SEPARATOR} `),
    correctOption: String(question.options.find((option) => option.isCorrect)?.position ?? 1),
    stem,
    solution,
    options,
    answerMode: question.answerKey?.mode ?? ANSWER_MODE.EXACT,
    answers,
    tolerance: question.answerKey?.tolerance == null ? '' : String(question.answerKey.tolerance),
  };
}

/** Blank boxes are absent: an emptied editor still holds `<p></p>`, which says nothing. */
function filled(map: LanguageMap): Partial<LanguageMap> {
  const out: Partial<LanguageMap> = {};
  for (const language of LANGUAGE_ORDER) {
    if (hasText(map[language])) out[language] = map[language].trim();
  }
  return out;
}

export function toDraft(values: QuestionFormValues, saved?: QuestionDetail): QuestionDraftInput {
  const isMcq = values.type === QUESTION_TYPE.SINGLE_MCQ;

  return {
    // What this screen was built from, so a save over somebody else's is refused rather than applied.
    expectedUpdatedAt: saved?.updatedAt,
    type: values.type,
    subjectId: values.subjectId,
    topicId: values.topicId || null,
    difficulty: values.difficulty,
    questionCode: values.questionCode.trim() || null,
    stem: filled(values.stem),
    solution: filled(values.solution),
    options: isMcq
      ? values.options
          .map((option, index) => ({
            position: index + 1,
            isCorrect: String(index + 1) === values.correctOption,
            text: filled(option.text),
          }))
          .filter((option) => Object.keys(option.text).length > 0)
      : [],
    answerKey: isMcq
      ? null
      : {
          mode: values.answerMode,
          answers: filled(values.answers),
          ...(values.answerMode === ANSWER_MODE.NUMERIC && values.tolerance.trim() !== ''
            ? { tolerance: values.tolerance }
            : {}),
        },
    tags: values.tags
      .split(TAG_SEPARATOR)
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ''),
  };
}

/** Every path the server can name, so a failure lands on its own input. */
export const SERVER_FIELDS = [
  'subjectId',
  'topicId',
  'difficulty',
  'type',
  'questionCode',
  'tags',
  'options',
  ...LANGUAGE_ORDER.map((language) => `stem.${language}` as const),
  ...LANGUAGE_ORDER.map((language) => `solution.${language}` as const),
] as const;

import {
  ANSWER_MODE,
  DEFAULT_LANGUAGE,
  LANGUAGE_ORDER,
  MCQ_OPTION_COUNT,
  MCQ_OPTION_MAX,
  MCQ_OPTION_MIN,
  TAGS_MAX,
  QUESTION_TYPE,
  emptyTaxonomy,
  hasText,
  previewTextOf,
  type AnswerMode,
  type DifficultyLevel,
  type LocalizedText,
  type QuestionDetail,
  type QuestionDraft,
  type QuestionLanguage,
  type QuestionType,
  type TaxonomyContext,
} from '@iace/contracts';
import { type ScaffoldRegion, type ScaffoldRepeat } from '@iace/ui/scaffold-editor';
import { REGION_KIND } from '@iace/ui/scaffold-region';

/** The box read as slots, never as text between delimiters, into the draft the sheet also builds. */

export const REGION_KEYS = {
  STEM: 'stem',
  ANSWER: 'answer',
  SOLUTION: 'solution',
} as const;

export const OPTION_PREFIX = 'option:';

export const REGION_LABELS = {
  STEM: '',
  ANSWER: 'Answer',
  SOLUTION: 'Explanation',
} as const;

/** The one slot whose value is not what it looks like: the seat, not the text sitting in it. */
export const ANSWER_HINTS = {
  SINGLE_MCQ: 'Type the option, not its text — B',
  TEXT_FIELD: 'Type the value a student would enter',
} as const;

export const optionKey = (index: number) => `${OPTION_PREFIX}${index}`;
/** The seat, as a candidate reads it off the paper. */
export const optionLetter = (index: number) => String.fromCodePoint(A_CODE + index);

const A_CODE = 65;

export const OPTION_REPEAT: ScaffoldRepeat = {
  prefix: OPTION_PREFIX,
  keyOf: optionKey,
  labelAt: optionLetter,
  min: MCQ_OPTION_MIN,
  max: MCQ_OPTION_MAX,
};

/** What one language holds. Everything outside this is shared across all three. */
export interface LanguageContent {
  stem: string;
  options: string[];
  solution: string;
}

/** The question in the box: per-language content over a structure the languages share. */
export interface AuthoringState {
  type: QuestionType;
  optionCount: number;
  /** The letter or the number typed on the Answer line, exactly as the typist left it. */
  answer: string;
  answerMode: AnswerMode;
  tolerance: string;
  content: Record<QuestionLanguage, LanguageContent>;
}

/** Set once per batch and kept across saves — the whole reason the header is not in the box. */
export interface AuthoringHeader {
  subjectId: string;
  topicId: string;
  difficulty: DifficultyLevel;
  /** As typed: a comma-separated line, kept for every question saved from this session. */
  tags: string;
}

const emptyLanguage = (options: number): LanguageContent => ({
  stem: '',
  options: Array.from({ length: options }, () => ''),
  solution: '',
});

export function emptyState(type: QuestionType = QUESTION_TYPE.SINGLE_MCQ): AuthoringState {
  const optionCount = type === QUESTION_TYPE.SINGLE_MCQ ? MCQ_OPTION_COUNT : 0;
  return {
    type,
    optionCount,
    answer: '',
    answerMode: ANSWER_MODE.NUMERIC,
    tolerance: '',
    content: {
      en: emptyLanguage(optionCount),
      hi: emptyLanguage(optionCount),
      te: emptyLanguage(optionCount),
    },
  };
}

/** The slots one language shows. The shape is the same in every language; only the text moves. */
export function regionsFor(state: AuthoringState, language: QuestionLanguage): ScaffoldRegion[] {
  const content = state.content[language];
  const options =
    state.type === QUESTION_TYPE.SINGLE_MCQ
      ? Array.from({ length: state.optionCount }, (_, index) => ({
          key: optionKey(index),
          label: optionLetter(index),
          kind: REGION_KIND.SEAT,
          html: content.options[index] ?? '',
        }))
      : [];

  return [
    {
      key: REGION_KEYS.STEM,
      label: REGION_LABELS.STEM,
      kind: REGION_KIND.PLAIN,
      html: content.stem,
    },
    ...options,
    {
      key: REGION_KEYS.ANSWER,
      label: REGION_LABELS.ANSWER,
      kind: REGION_KIND.NAMED,
      hint: ANSWER_HINTS[state.type],
      html: state.answer,
    },
    {
      key: REGION_KEYS.SOLUTION,
      label: REGION_LABELS.SOLUTION,
      kind: REGION_KIND.NAMED,
      html: content.solution,
    },
  ];
}

/** What the box said, folded back in: the answer and the option count reach every language. */
export function stateFrom(
  state: AuthoringState,
  language: QuestionLanguage,
  regions: readonly ScaffoldRegion[],
): AuthoringState {
  const options = regions.filter((region) => region.key.startsWith(OPTION_PREFIX));
  const optionCount = state.type === QUESTION_TYPE.SINGLE_MCQ ? options.length : 0;
  const find = (key: string) => regions.find((region) => region.key === key)?.html ?? '';

  const content = { ...state.content };
  for (const code of LANGUAGE_ORDER) {
    const existing = content[code];
    const resized = Array.from(
      { length: optionCount },
      (_, index) => existing.options[index] ?? '',
    );
    content[code] =
      code === language
        ? {
            stem: find(REGION_KEYS.STEM),
            options: options.map((region) => region.html),
            solution: find(REGION_KEYS.SOLUTION),
          }
        : { ...existing, options: resized };
  }

  return { ...state, optionCount, answer: find(REGION_KEYS.ANSWER), content };
}

/** Which option the Answer line names. A letter and a number both mean the same seat. */
export function answerIndexOf(answer: string, optionCount: number): number | null {
  const typed = previewTextOf(answer)
    .replace(/[().\s]/g, '')
    .toLowerCase();
  if (typed.length === 0) return null;

  if (/^[a-z]$/.test(typed)) {
    const index = typed.codePointAt(0)! - A_CODE - 32;
    return index < optionCount ? index : null;
  }
  if (/^\d+$/.test(typed)) {
    const index = Number(typed) - 1;
    return index >= 0 && index < optionCount ? index : null;
  }
  return null;
}

/** Every seat a paper may print, so the header can offer the count as a choice. */
export const OPTION_COUNTS = Array.from(
  { length: MCQ_OPTION_MAX - MCQ_OPTION_MIN + 1 },
  (_, index) => MCQ_OPTION_MIN + index,
);

/** The highest seat that says something in any language. Nothing at or below it may be dropped. */
function lastFilledOption(state: AuthoringState): number {
  let last = -1;
  for (const language of LANGUAGE_ORDER) {
    state.content[language].options.forEach((html, index) => {
      if (hasText(html)) last = Math.max(last, index);
    });
  }
  return last;
}

/** Resizes every language at once, and never past an option that says something. */
export function withOptionCount(state: AuthoringState, count: number): AuthoringState {
  const floor = Math.max(MCQ_OPTION_MIN, lastFilledOption(state) + 1);
  const optionCount = Math.min(MCQ_OPTION_MAX, Math.max(floor, count));
  if (optionCount === state.optionCount) return state;

  const content = { ...state.content };
  for (const language of LANGUAGE_ORDER) {
    const existing = content[language];
    content[language] = {
      ...existing,
      options: Array.from({ length: optionCount }, (_, index) => existing.options[index] ?? ''),
    };
  }

  return { ...state, optionCount, content };
}

/** One line of commas into the tags a question carries. Normalising is the schema's job. */
export function tagsIn(line: string): string[] {
  return line
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '')
    .slice(0, TAGS_MAX);
}

/** Only the languages that say something. An empty Telugu box is not Telugu. */
function localized(pick: (language: QuestionLanguage) => string): LocalizedText {
  const out: LocalizedText = {};
  for (const language of LANGUAGE_ORDER) {
    const value = pick(language);
    if (hasText(value)) out[language] = value;
  }
  return out;
}

/** A typed answer belongs to every language the question has, and to no language it lacks. */
function typedAnswers(state: AuthoringState): LocalizedText {
  const answer = previewTextOf(state.answer).trim();
  if (answer === '') return {};
  return localized((language) => (hasText(state.content[language].stem) ? answer : ''));
}

export function toDraft(state: AuthoringState, header: AuthoringHeader): QuestionDraft {
  const isMcq = state.type === QUESTION_TYPE.SINGLE_MCQ;
  const correct = isMcq ? answerIndexOf(state.answer, state.optionCount) : null;
  const tolerance = state.tolerance.trim();

  return {
    type: state.type,
    subjectId: header.subjectId,
    topicId: header.topicId || null,
    difficulty: header.difficulty,
    tags: tagsIn(header.tags),
    stem: localized((language) => state.content[language].stem),
    solution: localized((language) => state.content[language].solution),
    options: isMcq
      ? Array.from({ length: state.optionCount }, (_, index) => ({
          position: index + 1,
          isCorrect: index === correct,
          text: localized((language) => state.content[language].options[index] ?? ''),
        }))
      : [],
    answerKey: isMcq
      ? null
      : {
          mode: state.answerMode,
          answers: typedAnswers(state),
          ...(state.answerMode === ANSWER_MODE.NUMERIC && tolerance !== ''
            ? { tolerance: Number(tolerance) }
            : {}),
        },
  };
}

/** A saved question, back in the box. The current version is what an edit starts from. */
export function stateOf(question: QuestionDetail): AuthoringState {
  const base = emptyState(question.type);
  const optionCount = question.options.length;
  const correct = question.options.findIndex((option) => option.isCorrect);

  const content = { ...base.content };
  for (const language of LANGUAGE_ORDER) {
    content[language] = {
      stem: htmlOf(question.content[language]?.stem),
      solution: htmlOf(question.content[language]?.solution),
      options: question.options.map((option) => htmlOf(option.text[language])),
    };
  }

  return {
    type: question.type,
    optionCount,
    answer: answerLineOf(question, correct),
    answerMode: question.answerKey?.mode ?? ANSWER_MODE.NUMERIC,
    tolerance: question.answerKey?.tolerance == null ? '' : String(question.answerKey.tolerance),
    content,
  };
}

/** What the Answer line said: the letter for a choice, the typed value for anything else. */
function answerLineOf(question: QuestionDetail, correct: number): string {
  if (question.type !== QUESTION_TYPE.SINGLE_MCQ) {
    return question.answerKey?.answers[DEFAULT_LANGUAGE] ?? '';
  }
  return correct >= 0 ? optionLetter(correct) : '';
}

const htmlOf = (nodes: { text: string }[] | undefined): string =>
  (nodes ?? []).map((node) => node.text).join('');

export function headerOf(question: QuestionDetail): AuthoringHeader {
  return {
    subjectId: question.subject.id,
    topicId: question.topic?.id ?? '',
    difficulty: question.difficulty,
    tags: question.tags.join(', '),
  };
}

/** Enough taxonomy to run the rules here; the picker cannot offer a topic outside the subject. */
export function taxonomyFor(header: AuthoringHeader): TaxonomyContext {
  const taxonomy = emptyTaxonomy();
  if (header.subjectId) taxonomy.subjects.set(header.subjectId, { id: header.subjectId, name: '' });
  if (header.topicId) {
    taxonomy.topics.set(header.topicId, {
      id: header.topicId,
      name: '',
      subjectId: header.subjectId,
    });
  }
  return taxonomy;
}

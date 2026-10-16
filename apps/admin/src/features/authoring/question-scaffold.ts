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
  WRITING_FORMAT,
  keyPointsOf,
  type WritingFormat,
  type WritingRubric,
} from '@iace/contracts';
import { INDIC_SCRIPTS, type IndicScript } from '@iace/ui';
import { type ScaffoldRegion } from '@iace/ui/scaffold-editor';
import { REGION_KIND } from '@iace/ui/scaffold-region';
import { subjectLanguageOf, subjectNameOf } from './subject-languages';

/** The box read as slots, never as text between delimiters, into the draft the sheet also builds. */

export const REGION_KEYS = {
  PASSAGE: 'passage',
  STEM: 'stem',
  ANSWER: 'answer',
  SOLUTION: 'solution',
} as const;

export const OPTION_PREFIX = 'option:';

export const REGION_LABELS = {
  PASSAGE: 'Passage',
  STEM: '',
  ANSWER: 'Answer',
  KEY_POINTS: 'Key points',
  SOLUTION: 'Explanation',
} as const;

/** The one slot whose value is not what it looks like: the seat, not the text sitting in it. */
export const PASSAGE_HINT = 'Optional';

export const ANSWER_HINTS = {
  SINGLE_MCQ: 'Type the option, not its text: B',
  TEXT_FIELD: 'Type the value a student would enter',
  DESCRIPTIVE: 'The key points an answer should make, one a line',
} as const;

export const optionKey = (index: number) => `${OPTION_PREFIX}${index}`;
/** The seat, as a candidate reads it off the paper. */
export const optionLetter = (index: number) => String.fromCodePoint(A_CODE + index);

const A_CODE = 65;

/** What one language holds. Everything outside this is shared across all three. */
export interface LanguageContent {
  /** What the question is asked about; empty when it stands alone. */
  passage: string;
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
  /** DESCRIPTIVE only: what the writing is, and the word limits as typed. Its key points are the Answer box. */
  format: WritingFormat;
  minWords: string;
  maxWords: string;
  content: Record<QuestionLanguage, LanguageContent>;
}

/** Set once per batch and kept across saves — the whole reason the header is not in the box. */
export interface AuthoringHeader {
  subjectId: string;
  topicId: string;
  difficulty: DifficultyLevel;
  /** As typed: a comma-separated line, kept for every question saved from this session. */
  tags: string;
  /** Only the bank editor holds one; absent, an editor neither shows a code nor sends it. */
  questionCode?: string;
}

const emptyLanguage = (options: number): LanguageContent => ({
  passage: '',
  stem: '',
  options: Array.from({ length: options }, () => ''),
  solution: '',
});

const NO_RUBRIC = { format: WRITING_FORMAT.ESSAY, minWords: '', maxWords: '' } as const;

export function emptyState(type: QuestionType = QUESTION_TYPE.SINGLE_MCQ): AuthoringState {
  const optionCount = type === QUESTION_TYPE.SINGLE_MCQ ? MCQ_OPTION_COUNT : 0;
  return {
    type,
    optionCount,
    answer: '',
    answerMode: ANSWER_MODE.NUMERIC,
    tolerance: '',
    ...NO_RUBRIC,
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
  const stem = {
    key: REGION_KEYS.STEM,
    label: REGION_LABELS.STEM,
    kind: REGION_KIND.PLAIN,
    html: content.stem,
  };
  if (state.type === QUESTION_TYPE.TYPING) return [stem];

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
      key: REGION_KEYS.PASSAGE,
      label: REGION_LABELS.PASSAGE,
      kind: REGION_KIND.NAMED,
      hint: PASSAGE_HINT,
      html: content.passage,
    },
    stem,
    ...options,
    {
      key: REGION_KEYS.ANSWER,
      label:
        state.type === QUESTION_TYPE.DESCRIPTIVE ? REGION_LABELS.KEY_POINTS : REGION_LABELS.ANSWER,
      kind: REGION_KIND.NAMED,
      hint: ANSWER_HINTS[state.type],
      roman: true,
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
  const isMcq = state.type === QUESTION_TYPE.SINGLE_MCQ;
  const options = regions.filter((region) => region.key.startsWith(OPTION_PREFIX));
  const optionCount = isMcq ? options.length : 0;
  // A slot this type does not draw keeps what it held, so a switch of type and back loses nothing.
  const find = (key: string, held: string) =>
    regions.find((region) => region.key === key)?.html ?? held;

  const content = { ...state.content };
  for (const code of LANGUAGE_ORDER) {
    const existing = content[code];
    const resized = Array.from(
      { length: optionCount },
      (_, index) => existing.options[index] ?? '',
    );
    const shown = code === language ? options.map((region) => region.html) : resized;
    // A typed answer shows no options: what a switch of type left behind waits for the switch back.
    const kept = { ...existing, options: isMcq ? shown : existing.options };
    content[code] =
      code === language
        ? {
            ...kept,
            passage: find(REGION_KEYS.PASSAGE, existing.passage),
            stem: find(REGION_KEYS.STEM, existing.stem),
            solution: find(REGION_KEYS.SOLUTION, existing.solution),
          }
        : kept;
  }

  return { ...state, optionCount, answer: find(REGION_KEYS.ANSWER, state.answer), content };
}

/** Which option the Answer line names. A letter and a number both mean the same seat. */
export function answerIndexOf(answer: string, optionCount: number): number | null {
  const typed = previewTextOf(answer)
    .replace(/[().\s]/g, '')
    .toLowerCase();
  if (typed.length === 0) return null;

  if (/^[a-z]$/.test(typed)) {
    const index = (typed.codePointAt(0) ?? 0) - A_CODE - 32;
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

function draftHeaderOf(header: AuthoringHeader) {
  return {
    subjectId: header.subjectId,
    topicId: header.topicId || null,
    difficulty: header.difficulty,
    ...(header.questionCode === undefined
      ? {}
      : { questionCode: header.questionCode.trim() || null }),
    tags: tagsIn(header.tags),
  };
}

export function toDraft(state: AuthoringState, header: AuthoringHeader): QuestionDraft {
  const isMcq = state.type === QUESTION_TYPE.SINGLE_MCQ;
  const correct = isMcq ? answerIndexOf(state.answer, state.optionCount) : null;
  const tolerance = state.tolerance.trim();
  const passage = localized((language) => state.content[language].passage);

  if (state.type === QUESTION_TYPE.TYPING) {
    return {
      type: state.type,
      ...draftHeaderOf(header),
      stem: localized((language) => state.content[language].stem),
      options: [],
      answerKey: null,
    };
  }

  return {
    type: state.type,
    ...draftHeaderOf(header),
    stem: localized((language) => state.content[language].stem),
    ...(Object.keys(passage).length > 0 ? { passage } : {}),
    solution: localized((language) => state.content[language].solution),
    options: isMcq
      ? Array.from({ length: state.optionCount }, (_, index) => ({
          position: index + 1,
          isCorrect: index === correct,
          text: localized((language) => state.content[language].options[index] ?? ''),
        }))
      : [],
    answerKey: answerKeyOf(state, isMcq, tolerance),
  };
}

/** Blank is no limit; letters stay NaN so the rules refuse them rather than read them as none. */
const wordLimitOf = (typed: string): number | null => (typed.trim() === '' ? null : Number(typed));

function answerKeyOf(
  state: AuthoringState,
  isMcq: boolean,
  tolerance: string,
): QuestionDraft['answerKey'] {
  if (isMcq) return null;
  if (state.type === QUESTION_TYPE.DESCRIPTIVE) {
    const points = keyPointsOf(state.answer).join('\n');
    return {
      mode: ANSWER_MODE.EXACT,
      // Every language the question has is marked against the same points.
      answers: localized((language) => (hasText(state.content[language].stem) ? points : '')),
      rubric: {
        format: state.format,
        minWords: wordLimitOf(state.minWords),
        maxWords: wordLimitOf(state.maxWords),
      },
    };
  }
  return {
    mode: state.answerMode,
    answers: typedAnswers(state),
    ...(state.answerMode === ANSWER_MODE.NUMERIC && tolerance !== ''
      ? { tolerance: Number(tolerance) }
      : {}),
  };
}

/** A stored key's rubric back as the three fields the bar edits. */
function rubricState(rubric: WritingRubric | undefined) {
  if (!rubric) return NO_RUBRIC;
  return {
    format: rubric.format,
    minWords: rubric.minWords == null ? '' : String(rubric.minWords),
    maxWords: rubric.maxWords == null ? '' : String(rubric.maxWords),
  };
}

/** Key points are stored one a line; the box shows each as its own paragraph. */
const asAnswerBox = (type: QuestionType, line: string): string =>
  type === QUESTION_TYPE.DESCRIPTIVE
    ? keyPointsOf(line)
        .map((point) => `<p>${point}</p>`)
        .join('')
    : line;

/** A saved question, back in the box. The current version is what an edit starts from. */
export function stateOf(question: QuestionDetail): AuthoringState {
  const base = emptyState(question.type);
  const optionCount = question.options.length;
  const correct = question.options.findIndex((option) => option.isCorrect);

  const content = { ...base.content };
  for (const language of LANGUAGE_ORDER) {
    content[language] = {
      passage: htmlOf(question.content[language]?.passage),
      stem: htmlOf(question.content[language]?.stem),
      solution: htmlOf(question.content[language]?.solution),
      options: question.options.map((option) => htmlOf(option.text[language])),
    };
  }

  return {
    type: question.type,
    optionCount,
    answer: asAnswerBox(question.type, answerLineOf(question, correct)),
    answerMode: question.answerKey?.mode ?? ANSWER_MODE.NUMERIC,
    tolerance: question.answerKey?.tolerance == null ? '' : String(question.answerKey.tolerance),
    ...rubricState(question.answerKey?.rubric),
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

/** What the next question of a batch starts with: the settings stay, a question's own code does not. */
export function carriedHeader(header: AuthoringHeader): AuthoringHeader {
  return header.questionCode === undefined ? header : { ...header, questionCode: '' };
}

export function headerOf(question: QuestionDetail): AuthoringHeader {
  return {
    subjectId: question.subject.id,
    topicId: question.topic?.id ?? '',
    difficulty: question.difficulty,
    tags: question.tags.join(', '),
  };
}

/** A draft that never reached the bank — a previewed import row — back in the box, its options by seat. */
export function stateOfDraft(draft: QuestionDraft): AuthoringState {
  const isMcq = draft.type === QUESTION_TYPE.SINGLE_MCQ;
  const seats = isMcq
    ? Math.max(MCQ_OPTION_MIN, ...draft.options.map((option) => option.position))
    : 0;
  const textAt = (seat: number, language: QuestionLanguage) =>
    draft.options.find((option) => option.position === seat)?.text[language] ?? '';

  const content = emptyState(draft.type).content;
  for (const language of LANGUAGE_ORDER) {
    content[language] = {
      passage: draft.passage?.[language] ?? '',
      stem: draft.stem[language] ?? '',
      solution: draft.solution?.[language] ?? '',
      options: Array.from({ length: seats }, (_, index) => textAt(index + 1, language)),
    };
  }

  return {
    type: draft.type,
    optionCount: seats,
    answer: asAnswerBox(draft.type, draftAnswerLine(draft)),
    answerMode: draft.answerKey?.mode ?? ANSWER_MODE.NUMERIC,
    tolerance: draft.answerKey?.tolerance == null ? '' : String(draft.answerKey.tolerance),
    ...rubricState(draft.answerKey?.rubric),
    content,
  };
}

/** What the Answer line says for a draft: the correct seat's letter, or the typed English answer. */
function draftAnswerLine(draft: QuestionDraft): string {
  if (draft.type !== QUESTION_TYPE.SINGLE_MCQ)
    return draft.answerKey?.answers[DEFAULT_LANGUAGE] ?? '';
  const correct = draft.options.find((option) => option.isCorrect)?.position;
  return correct ? optionLetter(correct - 1) : '';
}

export function headerOfDraft(draft: QuestionDraft): AuthoringHeader {
  return {
    subjectId: draft.subjectId,
    topicId: draft.topicId ?? '',
    difficulty: draft.difficulty,
    tags: draft.tags.join(', '),
  };
}

/** Enough taxonomy to run the rules here; the picker cannot offer a topic outside the subject. */
export function taxonomyFor(header: AuthoringHeader): TaxonomyContext {
  const taxonomy = emptyTaxonomy();
  if (header.subjectId) {
    taxonomy.subjects.set(header.subjectId, {
      id: header.subjectId,
      name: subjectNameOf(header.subjectId) ?? 'This subject',
      language: subjectLanguageOf(header.subjectId),
    });
  }
  if (header.topicId) {
    taxonomy.topics.set(header.topicId, {
      id: header.topicId,
      name: '',
      subjectId: header.subjectId,
    });
  }
  return taxonomy;
}

/** Which script a language is written in. English is typed as it is read. */
export const SCRIPT_OF: Readonly<Partial<Record<QuestionLanguage, IndicScript>>> = {
  hi: INDIC_SCRIPTS.DEVANAGARI,
  te: INDIC_SCRIPTS.TELUGU,
};

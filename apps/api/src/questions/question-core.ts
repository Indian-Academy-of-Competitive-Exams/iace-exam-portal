import { createHash } from 'node:crypto';
import {
  ANSWER_MODE,
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  MCQ_OPTION_COUNT,
  QUESTION_TYPE,
  QUESTION_VALIDATION_CODE,
  plainTextOf,
  type AnswerKeyDraft,
  type LocalizedContent,
  type LocalizedRich,
  type LocalizedText,
  type QuestionDraft,
  type QuestionLanguage,
  type RichContent,
  type ValidationIssue,
} from '@iace/contracts';
import { stripImageSrc } from './question-images';
import { firstMathError } from './question-math';

/**
 * The rules a question is judged by, and the shape it is stored in. Both ways a
 * question arrives — the form and the sheet — build a `QuestionDraft` and come
 * through here, so there is one definition of valid and one of what gets written.
 * Pure: no Nest, no Prisma, no I/O. The taxonomy arrives as a context the caller
 * has already read.
 */

/** What the draft's ids must resolve against. Read once per request or per file. */
export interface TaxonomyContext {
  subjects: Map<string, { id: string; name: string }>;
  topics: Map<string, { id: string; name: string; subjectId: string }>;
}

export const emptyTaxonomy = (): TaxonomyContext => ({
  subjects: new Map(),
  topics: new Map(),
});

/** What `buildContent` produces: exactly the columns a Question row holds. */
export interface BuiltQuestion {
  content: LocalizedContent;
  options: { position: number; isCorrect: boolean; text: LocalizedRich }[];
  answerKey: AnswerKeyDraft | null;
  /** The languages this question was really authored in, in `LANGUAGE_ORDER`. */
  languages: QuestionLanguage[];
  stemHash: string;
}

const blank = (value: string | undefined): boolean => !value || value.trim() === '';

/** The one place content is written, so the transient image src is stripped here and only here. */
const textNode = (value: string | undefined): RichContent =>
  blank(value) ? [] : [{ type: 'TEXT', text: stripImageSrc(value!.trim()) }];

/** The languages a stem was written in — the only thing that makes a language present. */
export function languagesIn(stem: LocalizedText): QuestionLanguage[] {
  return LANGUAGE_ORDER.filter((language) => !blank(stem[language]));
}

/**
 * Text cells to content nodes. A language reaches the row only if it has a stem:
 * a lone translated option would render as a question with no question.
 */
export function buildContent(draft: QuestionDraft): BuiltQuestion {
  const languages = languagesIn(draft.stem);

  const content: LocalizedContent = {};
  for (const language of languages) {
    const solution = textNode(draft.solution?.[language]);
    content[language] = {
      stem: textNode(draft.stem[language]),
      ...(solution.length > 0 ? { solution } : {}),
    };
  }

  const options = draft.options.map((option) => {
    const text: LocalizedRich = {};
    for (const language of languages) {
      const node = textNode(option.text[language]);
      if (node.length > 0) text[language] = node;
    }
    return { position: option.position, isCorrect: option.isCorrect, text };
  });

  const answerKey = draft.answerKey ? normaliseAnswerKey(draft.answerKey, languages) : null;

  return { content, options, answerKey, languages, stemHash: computeStemHash(draft) };
}

function normaliseAnswerKey(
  answerKey: AnswerKeyDraft,
  languages: QuestionLanguage[],
): AnswerKeyDraft {
  const answers: LocalizedText = {};
  for (const language of languages) {
    const answer = answerKey.answers[language];
    if (!blank(answer)) answers[language] = answer!.trim();
  }

  return {
    mode: answerKey.mode,
    answers,
    ...(answerKey.mode === ANSWER_MODE.NUMERIC && answerKey.tolerance !== undefined
      ? { tolerance: answerKey.tolerance }
      : {}),
  };
}

// ============================================================================
// Dedup
// ============================================================================

/**
 * Everything that makes two questions the same question, in one string: the
 * English stem, the options as a SET, and which one is right. Order-independent
 * because a paper that shuffles its options is not a second question, and the
 * correct text rather than its position because that is what survives a reorder.
 */
export function canonicalStemKey(draft: QuestionDraft): string {
  const stem = fold(draft.stem[DEFAULT_LANGUAGE]);

  if (draft.type === QUESTION_TYPE.TEXT_FIELD) {
    return [stem, '', fold(draft.answerKey?.answers[DEFAULT_LANGUAGE])].join('||');
  }

  const options = draft.options
    .map((option) => fold(option.text[DEFAULT_LANGUAGE]))
    .filter((text) => text !== '')
    .sort((a, b) => a.localeCompare(b));
  const correct = draft.options.find((option) => option.isCorrect);

  return [stem, options.join('|'), fold(correct?.text[DEFAULT_LANGUAGE])].join('||');
}

export function computeStemHash(draft: QuestionDraft): string {
  return createHash('sha256').update(canonicalStemKey(draft)).digest('hex');
}

/**
 * Case, spacing and punctuation are not what makes a question different. Unicode
 * classes, not [a-z0-9]: folding Hindi or Telugu to nothing would hash every
 * translated question to the same value.
 */
function fold(value: string | undefined): string {
  if (!value) return '';
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// Validation
// ============================================================================

const CODE = QUESTION_VALIDATION_CODE;

const stemField = (language: QuestionLanguage) => ({
  field: `stem.${language}`,
  column: `stem_${language}`,
});

const optionField = (position: number, language: QuestionLanguage) => ({
  field: `options.${position - 1}.text.${language}`,
  column: `option${position}_${language}`,
});

/**
 * Every rule a question must satisfy, reported rather than thrown: the form maps
 * a code to a field and the import preview prints it against a line, so a bad
 * row never stops the good ones.
 */
export function validateQuestion(
  draft: QuestionDraft,
  taxonomy: TaxonomyContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  checkLanguages(draft, issues);
  checkStems(draft, issues);
  if (draft.type === QUESTION_TYPE.SINGLE_MCQ) checkOptions(draft, issues);
  else checkTypedAnswer(draft, issues);
  checkTaxonomy(draft, taxonomy, issues);
  checkMath(draft, issues);

  return issues;
}

/** Both intake paths meet here: the importer writes formulas no dialog ever previewed. */
function checkMath(draft: QuestionDraft, issues: ValidationIssue[]): void {
  const fields: readonly (readonly [string, string | undefined])[] = [
    ...Object.entries(draft.stem).map(([language, text]) => [`stem.${language}`, text] as const),
    ...Object.entries(draft.solution ?? {}).map(
      ([language, text]) => [`solution.${language}`, text] as const,
    ),
    ...draft.options.flatMap((option, index) =>
      Object.entries(option.text).map(
        ([language, text]) => [`options.${index}.text.${language}`, text] as const,
      ),
    ),
  ];

  for (const [field, text] of fields) {
    const failure = text ? firstMathError(text) : null;
    if (!failure) continue;

    issues.push({
      code: CODE.MATH_INVALID,
      message: `The formula "${failure.latex}" will not render — ${failure.message}`,
      field,
    });
  }
}

/** A key outside the supported set would be stored as JSON nothing renders. */
function checkLanguages(draft: QuestionDraft, issues: ValidationIssue[]): void {
  const supported = new Set<string>(LANGUAGE_ORDER);
  const seen = new Set<string>([
    ...Object.keys(draft.stem),
    ...Object.keys(draft.solution ?? {}),
    ...Object.keys(draft.answerKey?.answers ?? {}),
    ...draft.options.flatMap((option) => Object.keys(option.text)),
  ]);

  for (const key of seen) {
    if (supported.has(key)) continue;
    issues.push({
      code: CODE.UNSUPPORTED_LANGUAGE,
      message: `"${key}" is not a language this platform holds questions in`,
      field: `stem.${key}`,
    });
  }
}

function checkStems(draft: QuestionDraft, issues: ValidationIssue[]): void {
  if (blank(draft.stem[DEFAULT_LANGUAGE])) {
    issues.push({
      code: CODE.ENGLISH_STEM_REQUIRED,
      message: 'Every question needs its English question text',
      ...stemField(DEFAULT_LANGUAGE),
    });
  }

  const authored = new Set(languagesIn(draft.stem));

  for (const language of LANGUAGE_ORDER) {
    if (authored.has(language)) continue;

    const translated =
      !blank(draft.solution?.[language]) ||
      !blank(draft.answerKey?.answers[language]) ||
      draft.options.some((option) => !blank(option.text[language]));

    if (translated) {
      issues.push({
        code: CODE.TRANSLATION_WITHOUT_STEM,
        message: `There is ${LANGUAGE_LABELS[language]} here but no ${LANGUAGE_LABELS[language]} question text`,
        ...stemField(language),
      });
    }
  }
}

function checkOptions(draft: QuestionDraft, issues: ValidationIssue[]): void {
  if (draft.answerKey) {
    issues.push({
      code: CODE.ANSWER_NOT_ALLOWED,
      message: 'A multiple-choice question is answered by an option, not a typed answer',
      field: 'answerKey',
      column: 'answer_en',
    });
  }

  if (draft.options.length !== MCQ_OPTION_COUNT) {
    issues.push({
      code: CODE.OPTION_COUNT_INVALID,
      message: `A multiple-choice question needs exactly ${MCQ_OPTION_COUNT} options`,
      field: 'options',
      column: 'option1_en',
    });
  }

  // Only the languages the question really has: an option is required in every
  // one of them, because a half-translated paper is unusable in that language.
  for (const language of languagesIn(draft.stem)) {
    for (const option of draft.options) {
      if (blank(option.text[language])) {
        issues.push({
          code: CODE.OPTION_TEXT_REQUIRED,
          message: `Option ${option.position} has no ${LANGUAGE_LABELS[language]} text`,
          ...optionField(option.position, language),
        });
      }
    }
  }

  const englishTexts = draft.options
    .map((option) => fold(option.text[DEFAULT_LANGUAGE]))
    .filter((text) => text !== '');
  if (new Set(englishTexts).size !== englishTexts.length) {
    issues.push({
      code: CODE.OPTION_TEXT_DUPLICATE,
      message: 'Two options say the same thing',
      field: 'options',
      column: 'option1_en',
    });
  }

  const correct = draft.options.filter((option) => option.isCorrect);
  if (correct.length === 0) {
    issues.push({
      code: CODE.CORRECT_OPTION_REQUIRED,
      message: 'Mark which option is correct',
      field: 'options',
      column: 'correct_option',
    });
  } else if (correct.length > 1) {
    issues.push({
      code: CODE.CORRECT_OPTION_INVALID,
      message: 'Exactly one option can be correct',
      field: 'options',
      column: 'correct_option',
    });
  }

  const positions = draft.options.map((option) => option.position);
  if (new Set(positions).size !== positions.length) {
    issues.push({
      code: CODE.CORRECT_OPTION_INVALID,
      message: 'Two options claim the same slot',
      field: 'options',
      column: 'option1_en',
    });
  }
}

function checkTypedAnswer(draft: QuestionDraft, issues: ValidationIssue[]): void {
  if (draft.options.length > 0) {
    issues.push({
      code: CODE.OPTIONS_NOT_ALLOWED,
      message: 'A typed-answer question has no options',
      field: 'options',
      column: 'option1_en',
    });
  }

  const answerKey = draft.answerKey;
  if (!answerKey || blank(answerKey.answers[DEFAULT_LANGUAGE])) {
    issues.push({
      code: CODE.ANSWER_REQUIRED,
      message: 'A typed-answer question needs its English answer',
      field: 'answerKey.answers.en',
      column: 'answer_en',
    });
    return;
  }

  if (answerKey.mode === ANSWER_MODE.NUMERIC) {
    for (const language of LANGUAGE_ORDER) {
      const answer = answerKey.answers[language];
      if (blank(answer) || Number.isFinite(Number(answer!.trim()))) continue;
      issues.push({
        code: CODE.ANSWER_NOT_NUMERIC,
        message: `"${answer!.trim()}" is not a number, and this answer is compared as one`,
        field: `answerKey.answers.${language}`,
        column: `answer_${language}`,
      });
    }
    return;
  }

  if (answerKey.tolerance !== undefined) {
    issues.push({
      code: CODE.TOLERANCE_NOT_ALLOWED,
      message: 'A tolerance only means something for a numeric answer',
      field: 'answerKey.tolerance',
      column: 'answer_tolerance',
    });
  }
}

/**
 * The "topic belongs to that subject" check is the one no foreign key can make: the question
 * carries both ids, and nothing in the schema says they have to agree.
 */
function checkTaxonomy(
  draft: QuestionDraft,
  taxonomy: TaxonomyContext,
  issues: ValidationIssue[],
): void {
  if (!draft.subjectId) {
    issues.push({
      code: CODE.SUBJECT_REQUIRED,
      message: 'Choose a subject',
      field: 'subjectId',
      column: 'subject',
    });
    return;
  }

  const subject = taxonomy.subjects.get(draft.subjectId);
  if (!subject) {
    issues.push({
      code: CODE.SUBJECT_UNKNOWN,
      message: 'That subject is not in the question bank',
      field: 'subjectId',
      column: 'subject',
    });
  }

  const topic = draft.topicId ? taxonomy.topics.get(draft.topicId) : undefined;
  if (draft.topicId && !topic) {
    issues.push({
      code: CODE.TOPIC_UNKNOWN,
      message: 'That topic is not in the question bank',
      field: 'topicId',
      column: 'topic',
    });
  }
  if (subject && topic && topic.subjectId !== subject.id) {
    issues.push({
      code: CODE.TOPIC_NOT_IN_SUBJECT,
      message: `"${topic.name}" is not a topic of "${subject.name}"`,
      field: 'topicId',
      column: 'topic',
    });
  }
}

/** The English stem, shortened — what a list row and an import preview show. */
export function stemPreviewOf(content: LocalizedContent, limit = 140): string {
  const stem = plainTextOf(content[DEFAULT_LANGUAGE]?.stem);
  return stem.length > limit ? `${stem.slice(0, limit - 1)}…` : stem;
}

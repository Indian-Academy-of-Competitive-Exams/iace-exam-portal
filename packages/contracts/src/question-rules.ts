import {
  ANSWER_MODE,
  DEFAULT_LANGUAGE,
  LANGUAGE_LABELS,
  LANGUAGE_ORDER,
  MCQ_OPTION_MAX,
  MCQ_OPTION_MIN,
  QUESTION_TYPE,
  QUESTION_VALIDATION_CODE,
  hasText,
  imageKeysIn,
  latexIn,
  previewTextOf,
  type LocalizedText,
  type QuestionDraft,
  type QuestionLanguage,
  type ValidationIssue,
} from './questions';

/** The one definition of valid, browser-safe so the editor and the server judge alike. */

/** What the draft's ids must resolve against. Read once per request, per file, or per screen. */
export interface TaxonomyContext {
  subjects: Map<string, { id: string; name: string }>;
  topics: Map<string, { id: string; name: string; subjectId: string }>;
}

export const emptyTaxonomy = (): TaxonomyContext => ({
  subjects: new Map(),
  topics: new Map(),
});

/** Whether KaTeX will render this formula, and why not. Injected: KaTeX is not a contracts dependency. */
export type MathChecker = (latex: string) => string | null;

const CODE = QUESTION_VALIDATION_CODE;

/** Markup is not content: the `<p></p>` an emptied editor box posts is an unanswered field. */
const blank = (value: string | undefined): boolean => !hasText(value);

/** Only the languages the author really filled in — an empty Telugu column is not Telugu. */
export function languagesIn(stem: LocalizedText): QuestionLanguage[] {
  return LANGUAGE_ORDER.filter((language) => !blank(stem[language]));
}

/** Case, spacing, punctuation and markup do not make a question different — but its figures do. */
export function foldForCompare(value: string | undefined): string {
  if (!value) return '';
  return [previewTextOf(value), ...imageKeysIn(value)]
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const stemField = (language: QuestionLanguage) => ({
  field: `stem.${language}`,
  column: `stem_${language}`,
});

const optionField = (position: number, language: QuestionLanguage) => ({
  field: `options.${position - 1}.text.${language}`,
  column: `option${position}_${language}`,
});

/** Reported rather than thrown, so a bad row never stops the good ones beside it. */
export function validateQuestion(
  draft: QuestionDraft,
  taxonomy: TaxonomyContext,
  mathError?: MathChecker,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  checkLanguages(draft, issues);
  checkStems(draft, issues);
  if (draft.type === QUESTION_TYPE.SINGLE_MCQ) checkOptions(draft, issues);
  else checkTypedAnswer(draft, issues);
  checkTaxonomy(draft, taxonomy, issues);
  if (mathError) checkMath(draft, issues, mathError);

  return issues;
}

/** The screen can be bypassed: a draft posted straight at the API carries whatever LaTeX it likes. */
function checkMath(draft: QuestionDraft, issues: ValidationIssue[], mathError: MathChecker): void {
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
    const failure = text ? firstMathFailure(text, mathError) : null;
    if (!failure) continue;

    issues.push({
      code: CODE.MATH_INVALID,
      message: `The formula "${failure.latex}" will not render — ${failure.message}`,
      field,
    });
  }
}

/** The first formula in this content that will not render, if there is one. */
export function firstMathFailure(
  html: string,
  mathError: MathChecker,
): { latex: string; message: string } | null {
  for (const latex of latexIn(html)) {
    const message = mathError(latex);
    if (message) return { latex, message };
  }
  return null;
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

  if (draft.options.length < MCQ_OPTION_MIN || draft.options.length > MCQ_OPTION_MAX) {
    issues.push({
      code: CODE.OPTION_COUNT_INVALID,
      message: `A multiple-choice question needs ${MCQ_OPTION_MIN} to ${MCQ_OPTION_MAX} options`,
      field: 'options',
      column: 'option1_en',
    });
  }

  // Only the languages it really has: a half-translated paper is unusable in that language.
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
    .map((option) => foldForCompare(option.text[DEFAULT_LANGUAGE]))
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

  // Seats, not names: a paper draws them in order, so 1, 2, 4 would move an option up a letter.
  const seated = draft.options.map((option) => option.position).sort((a, b) => a - b);
  if (seated.some((position, index) => position !== index + 1)) {
    issues.push({
      code: CODE.OPTION_COUNT_INVALID,
      message: 'The options skip a slot — number them from 1 with no gaps',
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
      if (answer === undefined || blank(answer)) continue;
      const typed = answer.trim();
      if (Number.isFinite(Number(typed))) continue;
      issues.push({
        code: CODE.ANSWER_NOT_NUMERIC,
        message: `"${typed}" is not a number, and this answer is compared as one`,
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

/** The topic-under-its-subject check no foreign key can make: the question carries both ids. */
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

/** Two questions in one string: the stem, the options as a SET, and the correct one's text. */
export function canonicalStemKey(draft: QuestionDraft): string {
  const stem = foldForCompare(draft.stem[DEFAULT_LANGUAGE]);

  if (draft.type === QUESTION_TYPE.TEXT_FIELD) {
    return [stem, '', foldForCompare(draft.answerKey?.answers[DEFAULT_LANGUAGE])].join('||');
  }

  const options = draft.options
    .map((option) => foldForCompare(option.text[DEFAULT_LANGUAGE]))
    .filter((text) => text !== '')
    .sort((a, b) => a.localeCompare(b));
  const correct = draft.options.find((option) => option.isCorrect);

  return [stem, options.join('|'), foldForCompare(correct?.text[DEFAULT_LANGUAGE])].join('||');
}
